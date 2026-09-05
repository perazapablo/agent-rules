---
name: harness
description: Resuelve CWD → project_id al arrancar la sesión, exige focus antes de mutar, garantiza que toda sesión quede persistida, y gobierna las tareas bajo contrato de fases (exploration→planning→implementation→verification) con gates verificables.
trigger: SessionStart / equivalente (cualquier cliente que soporte hooks)
agents: [claude, opencode]
enforced_by:
  - hooks/claude-session-start.cjs (SessionStart, Claude Code)
  - hooks/claude-focus-gate.cjs (PreToolUse mcp__memory__*, Claude Code)
  - hooks/claude-edit-focus-gate.cjs (PreToolUse Write|Edit|Bash, Claude Code)
  - hooks/claude-user-prompt.cjs (UserPromptSubmit, Claude Code)
  - hooks/claude-post-tool.cjs (PostToolUse .*, Claude Code)
  - C:/Users/Desarrollos/.config/mcp-learning/harness/phase-gate.cjs (PreToolUse Write|Edit|NotebookEdit|mcp__memory__decision_record, Claude Code)
  - C:/Users/Desarrollos/.config/mcp-learning/harness/session-end.cjs (SessionEnd, Claude Code)
  - ../../../opencode/plugins/harness.ts (opencode, todos los eventos)
depends_on: [memory-protocol, action-gating]
---

## Propósito

El harness resuelve CWD → project_id sin depender del criterio del modelo, obliga a declarar focus antes de mutar nada, y garantiza que ninguna sesión con actividad real desaparezca del timeline.

Consecuencia: el modelo arranca sabiendo su scope, no puede tocar código sin dejar rastro, y el viewer nunca tiene huecos por olvidos de checkpoint.

## Arquitectura

Core agnóstico en `mcp-learning/harness/` (lee la DB del MCP con `node:sqlite`, sin dependencias externas). Los adapters por cliente **sólo traducen protocolo** — ninguna decisión vive en ellos.

| Core | Interfaz | Qué hace |
|---|---|---|
| `mapper.cjs` | `resolveCwd(cwd, dbPath?)` | CWD canonicalizado → `{matched, project_id?, project_name?, message}` vía `project_paths`. |
| `focus-gate.cjs` | `checkFocusForSession(project_id, session_id)`, `checkFocus(project_id)`, `requiresFocus(tool)`, `setProvisionalFocus(session_id, project_id, prompt)` | ¿Esta sesión declaró focus para este proyecto? La ALLOWLIST cubre reads, scope-creation (`upsert_project`, `add_project_path`) y el propio `set_focus`. `setProvisionalFocus` escribe el focus derivado del prompt: inserta si no hay, pisa si es provisional, **nunca degrada uno declarado**. |
| `mutation-gate.cjs` | `evaluate({tool_name, tool_input, cwd, session_id})` | ¿Este tool call muta el workspace y falta focus? Devuelve `{gated, reason}`. Fail-open ante cwd sin mapear, sin session_id o error de infra. |
| `session-context.cjs` | `buildSessionContext({cwd, session_id, drain?})` | Bloque de texto de arranque: scope + `context_summary` + últimas 3 sesiones + threads abiertos + avisos de checkpoints perdidos. |
| `phase-post.cjs` | PostToolUse sobre `Write|Edit|NotebookEdit` | Graba en `scope_amendments[]` las ampliaciones que el humano concedió. Reejecuta `decide()`: si el veredicto era `ask` y el tool corrió igual, hubo aprobación humana. Es la única señal de aprobación que el harness tiene — un PreToolUse que devuelve `ask` emite la pregunta y muere sin ver la respuesta. |
| `stats.cjs` | `recordToolUse`, `incrementTurns`, `readSnapshot` | SessionStats en state files JSON por sesión. |
| `session-end.cjs` | `autoSave(session_id, {quiet})` | Red de seguridad: si el modelo no hizo checkpoint y hubo señal real, persiste un summary mecánico. Idempotente. |

**`checkFocusForSession` vs `checkFocus`**: el primero es el que gatea. El segundo (project-scoped) sólo sirve para enriquecer snapshots — usarlo como gate reintroduce el bug de focus stale, donde una sesión vieja dejaba `has_focus=true` para siempre.

## Paridad de adapters

| Responsabilidad | Claude Code | opencode |
|---|---|---|
| Inyectar contexto de arranque | `claude-session-start.cjs` (SessionStart) | `experimental.chat.system.transform` |
| Contar turnos + focus provisional | `claude-user-prompt.cjs` (UserPromptSubmit) | `chat.message` |
| Registrar enmiendas de scope | `phase-post.cjs` (PostToolUse) | — (pendiente de portar) |
| Focus-gate sobre writes de MCP | `claude-focus-gate.cjs` (PreToolUse `mcp__memory__.*`) → `deny` | `tool.execute.before` → `throw` |
| Mutation-gate sobre Edit/Write/Bash | `claude-edit-focus-gate.cjs` (PreToolUse) → `deny` | `tool.execute.before` → `throw` |
| SessionStats | `claude-post-tool.cjs` (PostToolUse `.*`) | `tool.execute.after` |
| Auto-save de la sesión | `session-end.cjs` (SessionEnd) | `event: session.idle`, `autoSave({quiet:true})` |

Diferencias irreducibles:

- opencode no expone fin de sesión, sólo `session.idle`. El auto-save corre en cada idle: es idempotente (saltea si hay narrativa del modelo, saltea si no hay señal) y llena el timeline progresivamente. Los markers `.missed-checkpoint` que quedan obsoletos porque el modelo cerró después los retira `session-context.cjs` al drenar.
- opencode no reporta errores de tool en `tool.execute.after`, así que `tool_errors` no se incrementa ahí.
- opencode normaliza nombres en la frontera: `bash|edit|write|patch` → `Bash|Edit|Write`, `memory_<tool>` → `mcp__memory__<tool>`, `filePath` → `file_path`. En el SDK 1.4.x los args de `tool.execute.before` llegan en `output.args`, no en `input`.

Tool MCP `get_session_stats(session_id, project_id?)` — lee el state file y devuelve snapshot enriquecido (`duration_min` desde `started_at_ms`, `last_focus` desde `session_focus`).

## Reglas para el agente (scope y focus)

1. Si el harness inyectó `project_id` al arranque, ese es el scope. Usalo directo en `mcp__memory__*` sin re-verificar.
2. Si avisó "not registered", antes del primer write: `list_projects` → `get_project`, o `upsert_project` + `add_project_path`.
3. Si un gate bloquea, la respuesta canónica es `set_focus({session_id, project_id, focus})` y reintentar — no buscar la forma de esquivarlo.
4. Usuario cambia scope explícitamente ("trabajemos sobre X") → ignorar injected id, resolver el nuevo.

## Harness de fases (tareas bajo contrato)

Capa distinta del focus-gate: gobierna **una tarea**, no la sesión. Store acumulable en `<repo>/.harness/tasks/<task_id>/` (state + artefactos) con `current.json` mapeando sesión → tarea; motor de estado en `mcp-learning/harness/dist/phase-cli.js`; enforcement en `phase-gate.cjs` (PreToolUse). Detalle operativo completo: skill `/harness-task`.

Varias tareas pueden estar activas a la vez. Cuál gobierna una sesión se resuelve por evidencia (puntero de `use` → única activa → tarea con esa `session_id`); ante varias candidatas el gate **bloquea los writes** en vez de elegir una — validar contra el `diff_scope` de la tarea equivocada es peor que frenar.

**Reglas duras — aplican sin que Pablo las recuerde:**

1. **Si hay una tarea `active` en `.harness/tasks/` del CWD o un ancestro, estás bajo contrato de fase.** Antes de tocar nada: `node <harness>/dist/phase-cli.js status` (o `list` si hay varias). La fase no está en el contexto, está en el archivo — una sesión nueva sobre una tarea viva no arranca de cero. Si el gate avisa que hay varias activas sin dueña, `use <task_id>` y seguir.
2. **Tarea que amerita rigor** (varios archivos, decisiones que tomar, o Pablo dice "por fases"/"con el harness") → proponer workflow (`directo` | `estandar`) y esperar su respuesta. Con su OK: `init`. **El workflow lo elige Pablo, nunca el modelo** — el estado que representa lo contrario no existe (`workflow_chosen_by: "human"` es literal).
3. **`advance` es una solicitud, no una transición.** El gate lee archivos y exit codes; si rechaza, la evidencia dice qué falta. Corregir y reintentar; nunca discutir con el gate ni buscar rodeos.
4. **`approve` SOLO con OK explícito de Pablo en ese turno.** Es el momento donde se autoriza el `diff_scope`. Aprobar en su nombre es la única regla del sistema que no está enforced por código — por eso es la que más importa.
5. **Retroceso (`rollback`) siempre lo decide Pablo.** Un agente que se auto-concede replanificar entra en loops.
6. **El `phase-gate` distingue `ask` de `deny`, y no son lo mismo.** Un `ask` (archivo fuera del `diff_scope`, código antes de su fase, enmienda al plan) es una pregunta con respuesta humana razonable: se aprueba en el momento, `phase-post.cjs` lo graba en `scope_amendments[]` y se sigue — **sin `rollback` y sin reescribir el plan**. Un `deny` (`state.json` a mano, artefactos de otra tarea, `decision_record` con payload inválido) es un error del modelo: se corrige, no se esquiva. Proponer un rollback para ampliar el scope es la respuesta equivocada desde que existe la enmienda.
7. **Registrar una decisión nunca se bloquea.** `decision_record` pasa en cualquier workflow y cualquier fase; lo único que el gate exige es que el `phase` declarado en el payload no mienta sobre la fase real (o que se omita). Si aparece una decisión en una tarea `directo`, la tarea estaba mal clasificada: eso se dice y se ofrece `escalate` — pero la decisión se graba igual. Bloquear el registro no deshace la decisión, solo la pierde, y deja la tarea igual de mal clasificada pero sin rastro de qué se decidió.

Comandos: `init | status | list | use | advance | approve | reject | rollback | escalate | done | tools`. Los ejecuta el modelo; las decisiones son de Pablo.

## Por qué

- Mapear CWD desde código elimina un vector clásico de error: el modelo eligiendo `project_id` por similitud de nombre.
- Un solo core, N adapters: cuando la lógica se queda dentro de un adapter, el otro cliente no la hereda. Toda decisión nueva baja al core primero.
- El focus es obligatorio pero **gratis**: lo deriva `claude-user-prompt.cjs` del prompt del usuario (provisional), y el agente lo asciende con `set_focus` cuando el trabajo lo amerita. Antes el gate lo exigía a mano y cobraba un turno entero por cada cambio chico — para arreglar un typo había que parar y declarar un focus. La trazabilidad estaba bien; el precio no. Un focus derivado del prompt es además más honesto que la paráfrasis del modelo. El gate sigue como respaldo para sesiones sin prompt aprovechable.
- El rigor se **opta hacia arriba**, no se sufre por defecto: sin tarea iniciada no hay contrato de fase, y un cambio chico no paga la ceremonia de uno grande. Es el mismo eje que ya distinguía `directo`/`estandar`/`libre`, extendido al piso.
- `readOnly` donde alcanza evita que un hook corrompa la DB.

## Pendiente

- Cleanup automático de state files viejos (`stats.cjs --gc` o cron).
