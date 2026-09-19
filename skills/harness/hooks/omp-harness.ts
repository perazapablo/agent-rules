// Adapter de omp (oh-my-pi) para el harness. Traduce protocolo, no decide.
//
// Todas las decisiones viven en mcp-learning/harness/*.cjs, compartidas con
// los adapters de Claude Code y opencode. Este archivo hace tres cosas:
//
//   1. Normaliza el vocabulario de omp al del core:
//        write|edit|bash|eval|ast_edit|lsp  →  Write|Edit|Bash
//        mcp__memory_<tool>                 →  mcp__memory__<tool>
//   2. Colapsa las sesiones de subagente sobre la sesión raíz. omp le da a
//      cada subagente un session_id propio; sin esto cada uno arrancaría sin
//      focus (el gate le bloquearía todo) y sus ediciones caerían fuera del
//      timeline de la sesión que las pidió.
//   3. Mapea eventos y nunca deja escapar una excepción: omp es fail-closed
//      (un handler que tira BLOQUEA el tool), el core es fail-open. El
//      try/catch de cada handler es lo que preserva la filosofía del core.

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

const HARNESS = join(homedir(), ".config/mcp-learning/harness");

// El core es CommonJS con `node:sqlite`. Bun 1.4.2 (el que embebe omp 18.x)
// lo soporta, así que carga in-process: sin spawn por tool call.
const req = createRequire(import.meta.url);
const { resolveCwd } = req(join(HARNESS, "mapper.cjs"));
const { evaluate } = req(join(HARNESS, "mutation-gate.cjs"));
const { checkFocusForSession, requiresFocus, setProvisionalFocus } = req(
	join(HARNESS, "focus-gate.cjs"),
);
const { recordToolUse, incrementTurns } = req(join(HARNESS, "stats.cjs"));
const { buildSessionContext } = req(join(HARNESS, "session-context.cjs"));
const { autoSave } = req(join(HARNESS, "session-end.cjs"));
const { decide, decideAmbiguous, findHarness, resolveTask } = req(
	join(HARNESS, "phase-gate.cjs"),
);

// ── tipos mínimos ───────────────────────────────────────────────────────────
// omp no publica sus tipos fuera del binario; se declara lo que se consume.

interface SessionManagerLike {
	getSessionId?: () => string | undefined;
	getSessionFile?: () => string | undefined;
}

interface UiLike {
	confirm?: (title: string, message: string) => Promise<boolean>;
}

interface Ctx {
	cwd?: string;
	hasUI?: boolean;
	ui?: UiLike;
	sessionManager?: SessionManagerLike;
}

interface InjectedMessage {
	message: {
		customType: string;
		content: string;
		display: boolean;
	};
}

interface BlockResult {
	block: true;
	reason: string;
}

type Handler = (
	event: unknown,
	ctx: Ctx,
) => unknown | Promise<unknown>;

interface PiLike {
	on(event: string, handler: Handler): void;
	setLabel?: (label: string) => void;
	logger?: { error?: (...args: unknown[]) => void };
}

interface Normalized {
	tool_name: string;
	tool_input: Record<string, unknown>;
}

interface PhaseVerdict {
	allow: boolean;
	mode?: "ask" | "deny";
	reason?: string;
}

// ── helpers de payload ──────────────────────────────────────────────────────

function prop(source: unknown, key: string): unknown {
	if (source && typeof source === "object" && key in source) {
		return (source as Record<string, unknown>)[key];
	}
	return undefined;
}

function str(source: unknown, key: string): string {
	const value = prop(source, key);
	return typeof value === "string" ? value : "";
}

function inputOf(event: unknown): Record<string, unknown> {
	const raw = prop(event, "input");
	return raw && typeof raw === "object"
		? (raw as Record<string, unknown>)
		: {};
}

/**
 * session_id de la sesión RAÍZ.
 *
 * Una sesión raíz de omp tiene id UUID y transcript propio:
 *   .../sessions/<slug>/<ts>_<uuid>.jsonl
 * Un subagente cuelga del directorio del padre, y su id puede ser un UUID
 * o el AdjectiveNoun que genera omp:
 *   .../sessions/<slug>/<ts>_<uuid>/<Nombre>.jsonl
 *
 * Cuando los artefactos del subagente van a un temp dir no hay transcript
 * del que deducir el padre. Por eso la raíz se identifica en POSITIVO y se
 * recuerda por proceso: un subagente corre en el mismo pid que su padre.
 * Reconocerla por descarte dejaba al subagente pasando por sesión raíz, con
 * state file propio y bloque de arranque completo.
 */
const UUID_SUFFIX =
	/_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let processRoot: string | null = null;

function rootSessionId(ctx: Ctx): string | null {
	const own = ctx.sessionManager?.getSessionId?.() ?? null;
	const file = ctx.sessionManager?.getSessionFile?.();

	if (file) {
		const nested = UUID_SUFFIX.exec(basename(dirname(file)));
		if (nested) return nested[1]; // subagente con transcript anidado
		if (own && UUID.test(own)) {
			processRoot = own; // raíz: id UUID + transcript propio
			return own;
		}
	}
	// Sin transcript o con id no-UUID: es un subagente. Cae en la raíz del
	// proceso; si todavía no se vio ninguna, null → los handlers no hacen nada.
	return processRoot;
}

function isSubagent(ctx: Ctx): boolean {
	const own = ctx.sessionManager?.getSessionId?.() ?? null;
	return rootSessionId(ctx) !== own;
}

// ── normalización de vocabulario ────────────────────────────────────────────

/** Paths de las secciones de un patch hashline: `[ruta/al/archivo#A1B2]`. */
const HASHLINE_SECTION = /^\[([^\]\n]+)#[0-9A-Za-z]{4}\]$/gm;

function hashlinePaths(patch: string): string[] {
	const paths: string[] = [];
	HASHLINE_SECTION.lastIndex = 0;
	for (const m of patch.matchAll(HASHLINE_SECTION)) paths.push(m[1]);
	return paths;
}

/** Args de un device xd://: JSON en el `content` del write. */
function parseArgs(input: Record<string, unknown>): Record<string, unknown> {
	try {
		const parsed: unknown = JSON.parse(str(input, "content"));
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

/**
 * Traduce (tool, input) de omp al vocabulario del core. `null` = el core no
 * gobierna esta tool.
 *
 * Un tool puede tocar varios archivos (hashline multi-sección, codemod), así
 * que devuelve una lista: el gate corre sobre la primera y las stats sobre
 * todas.
 */
function normalize(name: string, input: Record<string, unknown>): Normalized[] {
	// Tools MCP: omp genera `mcp__<server>_<tool>` (UN underscore); el core
	// habla el dialecto de Claude Code, `mcp__<server>__<tool>`.
	if (name.startsWith("mcp__")) {
		return [
			{ tool_name: name.replace(/^mcp__memory_/, "mcp__memory__"), tool_input: input },
		];
	}

	switch (name) {
		case "write": {
			const path = str(input, "path");
			// Un `write` a xd:// no escribe un archivo: INVOCA otra tool, con los
			// args como JSON en `content`. Incluidas las tools MCP —
			// `xd://mcp__memory_add_note` es una escritura en memoria con otra
			// cara. Sin desenvolverlo, el focus-gate nunca la ve.
			if (path.startsWith("xd://")) {
				const device = path.slice("xd://".length);
				const unwrapped = device === "write" ? [] : normalize(device, parseArgs(input));
				// Device desconocido: se asume con efecto, no inocuo.
				return unwrapped.length
					? unwrapped
					: [{ tool_name: "Bash", tool_input: { command: `omp-xd ${device}` } }];
			}
			return [{ tool_name: "Write", tool_input: { file_path: path } }];
		}

		case "edit": {
			const paths = hashlinePaths(str(input, "input"));
			if (!paths.length) return [{ tool_name: "Edit", tool_input: {} }];
			return paths.map((p) => ({ tool_name: "Edit", tool_input: { file_path: p } }));
		}

		case "ast_edit": {
			const raw = prop(input, "paths");
			const paths = Array.isArray(raw) ? raw.filter((p) => typeof p === "string") : [];
			if (!paths.length) return [{ tool_name: "Edit", tool_input: {} }];
			return paths.map((p) => ({ tool_name: "Edit", tool_input: { file_path: p } }));
		}

		case "lsp": {
			// `rename`, `rename_file` y `code_actions` aplican al disco salvo que
			// se pida lo contrario. El resto es navegación.
			const action = str(input, "action");
			const mutates =
				action === "rename" || action === "rename_file" || action === "code_actions";
			if (!mutates || prop(input, "apply") === false) return [];
			return [{ tool_name: "Edit", tool_input: { file_path: str(input, "file") } }];
		}

		case "bash":
			return [{ tool_name: "Bash", tool_input: { command: str(input, "command") } }];

		case "eval":
			// El código de `eval` no es clasificable por el regex de shell, y
			// además puede escribir sin pasar por ninguna tool. El prefijo
			// garantiza que `isReadOnlyBash` lo rechace: ningún patrón del
			// allowlist arranca con "omp-eval".
			return [
				{
					tool_name: "Bash",
					tool_input: { command: `omp-eval ${str(input, "language")}` },
				},
			];

		// `task` no se mapea: el subagente carga esta misma extensión y emite
		// sus propios tool_call, ya colapsados sobre la sesión raíz.
		default:
			return [];
	}
}

// ── phase gate ──────────────────────────────────────────────────────────────

function phaseVerdict(
	cwd: string,
	sessionId: string | null,
	call: Normalized,
): PhaseVerdict | null {
	const root = findHarness(cwd);
	if (!root) return null;
	const resolved = resolveTask(join(root, ".harness"), sessionId);
	if (resolved.kind === "none") return null;
	return resolved.kind === "ambiguous"
		? decideAmbiguous(resolved.candidates, call.tool_name)
		: decide(resolved.state, root, call.tool_name, call.tool_input, resolved.dir);
}

/**
 * Registra la enmienda de scope reejecutando el hook PostToolUse original.
 *
 * No se reimplementa acá a propósito: `phase-post.cjs` reejecuta `decide()` y
 * decide el `kind` (out_of_scope | early_write | plan_amend). Duplicar eso en
 * el adapter sería mover una decisión fuera del core.
 */
function recordAmendment(cwd: string, sessionId: string | null, call: Normalized): void {
	execFileSync("node", [join(HARNESS, "phase-post.cjs")], {
		input: JSON.stringify({
			tool_name: call.tool_name,
			tool_input: call.tool_input,
			cwd,
			session_id: sessionId,
			tool_response: { success: true },
		}),
		encoding: "utf8",
		timeout: 5000,
		stdio: ["pipe", "pipe", "ignore"],
	});
}

// ── extensión ───────────────────────────────────────────────────────────────

export default function harness(pi: PiLike): void {
	pi.setLabel?.("harness");

	// Sesiones raíz que ya recibieron el bloque de arranque. `before_agent_start`
	// dispara una vez por prompt; el contexto va una sola vez por sesión.
	const bootstrapped = new Set<string>();
	// Tool calls donde el humano aprobó un `ask` de fase, por toolCallId.
	const approvedAsk = new Map<string, Normalized>();

	pi.on("before_agent_start", (event: unknown, ctx: Ctx): InjectedMessage | undefined => {
		try {
			// El prompt de un subagente lo escribió el modelo padre, no el humano:
			// ni cuenta turno ni describe el foco del usuario.
			if (isSubagent(ctx)) return undefined;
			const sessionId = rootSessionId(ctx);
			if (!sessionId) return undefined;
			const cwd = ctx.cwd ?? process.cwd();

			incrementTurns(sessionId);

			const prompt = str(event, "prompt");
			if (prompt) {
				const resolved = resolveCwd(cwd);
				if (resolved.matched) {
					setProvisionalFocus(sessionId, resolved.project_id, prompt);
				}
			}

			if (bootstrapped.has(sessionId)) return undefined;
			bootstrapped.add(sessionId);
			const { text } = buildSessionContext({ cwd, session_id: sessionId });
			return {
				message: { customType: "harness-scope", content: text, display: true },
			};
		} catch (e) {
			pi.logger?.error?.("[harness] before_agent_start", e);
			return undefined;
		}
	});

	pi.on("tool_call", async (event: unknown, ctx: Ctx): Promise<BlockResult | undefined> => {
		try {
			const sessionId = rootSessionId(ctx);
			const cwd = ctx.cwd ?? process.cwd();
			const calls = normalize(str(event, "toolName"), inputOf(event));
			if (!calls.length) return undefined;
			const call = calls[0];

			// 1. focus-gate: escrituras en memoria sin focus de ESTA sesión.
			if (requiresFocus(call.tool_name)) {
				const projectId = prop(call.tool_input, "project_id");
				if (typeof projectId === "string" && projectId && sessionId) {
					const focus = checkFocusForSession(projectId, sessionId);
					if (!focus.error && !focus.has_focus) {
						return {
							block: true,
							reason:
								`[harness] BLOQUEO: esta sesión (${sessionId.slice(0, 8)}) no llamó ` +
								`set_focus para project_id ${projectId}. Antes de escribir en memoria, ` +
								`llamá set_focus({ session_id: "${sessionId}", project_id: "${projectId}", ` +
								`focus: "<qué estás haciendo ahora>" }). Tool bloqueada: ${call.tool_name}.`,
						};
					}
				}
			}

			// 2. mutation-gate: tocar el workspace sin focus declarado.
			const mutation = evaluate({
				tool_name: call.tool_name,
				tool_input: call.tool_input,
				cwd,
				session_id: sessionId,
			});
			if (mutation.gated) return { block: true, reason: mutation.reason };

			// 3. phase-gate: contrato de fases de la tarea activa.
			const verdict = phaseVerdict(cwd, sessionId, call);
			if (!verdict || verdict.allow) return undefined;

			if (verdict.mode === "deny") {
				return { block: true, reason: `[harness/fase] ${verdict.reason}` };
			}

			// `ask`: a diferencia de Claude Code —donde el hook emite la pregunta y
			// muere sin ver la respuesta— acá la respuesta vuelve al handler.
			const confirm = ctx.hasUI ? ctx.ui?.confirm : undefined;
			if (!confirm) return undefined; // headless: fail-open, como el core.
			const ok = await confirm("[harness/fase] ampliar scope", String(verdict.reason));
			if (!ok) {
				return { block: true, reason: `[harness/fase] rechazado: ${verdict.reason}` };
			}
			const callId = str(event, "toolCallId");
			if (callId) approvedAsk.set(callId, call);
			return undefined;
		} catch (e) {
			pi.logger?.error?.("[harness] tool_call", e);
			return undefined; // omp es fail-closed; el core es fail-open.
		}
	});

	pi.on("tool_result", (event: unknown, ctx: Ctx): undefined => {
		try {
			const sessionId = rootSessionId(ctx);
			if (!sessionId) return undefined;
			const cwd = ctx.cwd ?? process.cwd();
			const rawName = str(event, "toolName");
			const isError = prop(event, "isError") === true;
			const calls = normalize(rawName, inputOf(event));

			// Sin mapeo, igual se cuenta el error: classify() lo hace para cualquier tool.
			if (!calls.length) {
				recordToolUse(sessionId, {
					tool_name: rawName,
					tool_input: {},
					cwd,
					tool_response: { is_error: isError },
				});
				return undefined;
			}

			for (const call of calls) {
				recordToolUse(sessionId, {
					tool_name: call.tool_name,
					tool_input: call.tool_input,
					cwd,
					tool_response: { is_error: isError },
				});
			}

			const callId = str(event, "toolCallId");
			const approved = callId ? approvedAsk.get(callId) : undefined;
			if (approved && !isError) {
				approvedAsk.delete(callId);
				recordAmendment(cwd, sessionId, approved);
			}
		} catch (e) {
			pi.logger?.error?.("[harness] tool_result", e);
		}
		return undefined;
	});

	pi.on("session_shutdown", (_event: unknown, ctx: Ctx): undefined => {
		try {
			// El subagente cierra antes que el padre; la sesión se guarda una vez.
			if (isSubagent(ctx)) return undefined;
			const sessionId = rootSessionId(ctx);
			if (sessionId) autoSave(sessionId, { quiet: true });
		} catch (e) {
			pi.logger?.error?.("[harness] session_shutdown", e);
		}
		return undefined;
	});
}
