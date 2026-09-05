#!/usr/bin/env node
// action-gating: PreToolUse hook for Claude Code.
// - Hard `deny` for catastrophic commands (no override).
// - `ask` for Write/Edit/Bash with effects.
// - Pass-through for read-only Bash.
//
// The read-only judgement is a FUNCTION, not a bare list match, because a
// prefix match is not enough: `cat a > b` writes, and `grep x | tee f` writes.
// isReadOnlyBash() splits the command on shell operators and requires EVERY
// segment to be read-only, plus the absence of any output redirection.
// Getting this wrong in the permissive direction lets a write through; getting
// it wrong in the strict direction blocks plain reading — which is what the
// old prefix list did to `sed -n`, `grep` and `find`.

// Tier 1: se evalúa SIEMPRE. Son verbos del shell — aparecen porque se van a
// ejecutar, no porque alguien los esté buscando.
const CATASTROPHIC_ALWAYS = [
  /\brm\s+-rf\s+\/(?:\s|$)/,
  /\brm\s+-rf\s+\/\*/,
  /\brm\s+-rf\s+~\/?(?:\s|$)/,
  /\brm\s+-rf\s+\$HOME/,
  /\brm\s+-rf\s+C:\?\s*$/i,
  /\bgit\s+push\s+(?:.*\s)?--force(?:-with-lease)?\s+.*\b(main|master|production)\b/,
  /\bgit\s+push\s+(?:.*\s)?-f\s+.*\b(main|master|production)\b/,
  /\bgit\s+reset\s+--hard\s+(?:origin\/)?(?:main|master|production)\b/,
  /:\s*\(\s*\)\s*\{\s*:\|:&\s*\}\s*;:/,
  /\bmkfs\b/,
  /\bdd\s+if=.*of=\/dev\/(sd|hd|nvme)/,
];

// Tier 2: SQL. Estos no son verbos del shell, son texto que viaja como
// argumento — y por lo tanto aparecen igual cuando alguien los BUSCA.
// `grep -n "TRUNCATE TABLE" migrations/*.sql` no ejecuta nada, y bloquearlo
// duro entrena a aprobar sin leer, que es como se pierde una base de datos.
// Se saltean solo si TODO el comando es una búsqueda (isSearchOnly), no si es
// "read-only" en sentido amplio: `find` acepta -exec y ahí sí se ejecuta.
const CATASTROPHIC_SQL = [
  /\bdrop\s+database\b/i,
  /\btruncate\s+table\b/i,
];

const CATASTROPHIC = [...CATASTROPHIC_ALWAYS, ...CATASTROPHIC_SQL];

// Per-SEGMENT patterns. A segment is one command between shell operators.
const READ_ONLY_BASH = [
  // navegación / listado
  /^ls(\s|$)/, /^dir(\s|$)/, /^pwd$/, /^whoami$/, /^hostname$/, /^uname(\s|$)/,
  /^tree(\s|$)/, /^stat\s/, /^file\s/, /^du\s/, /^df(\s|$)/, /^date(\s|$)/,
  /^basename\s/, /^dirname\s/, /^realpath\s/,
  // lectura de contenido
  /^cat\s/, /^type\s/, /^head\s/, /^tail\s/, /^wc\s/, /^echo\s/,
  /^sed\s+-n\s/,                       // -n = print selectivo; -i queda afuera
  /^awk\s/, /^cut\s/, /^sort(\s|$)/, /^uniq(\s|$)/, /^column\s/, /^diff\s/,
  /^jq\s/, /^xxd\s/, /^od\s/,
  // búsqueda
  /^grep\s/, /^egrep\s/, /^fgrep\s/, /^rg\s/, /^ag\s/, /^find\s/, /^fd\s/,
  // git de solo lectura
  /^git\s+(status|log|diff|show|branch(\s+-l)?|remote(\s+-v)?|config\s+--get|rev-parse|rev-list|describe|blame|shortlog|ls-files|ls-tree|cat-file|for-each-ref|count-objects|tag\s*$|tag\s+-l|stash\s+list)/,
  // toolchain: solo consultas de versión/listado
  /^node\s+--version$/, /^npm\s+(list|ls|view|outdated)/, /^npx\s+--version$/,
  /^cargo\s+(--version|tree|metadata)/, /^rustc\s+--version$/,
  /^tsc\s+--version$/, /^python3?\s+--version$/, /^go\s+version$/,
  /^which\s/, /^where\s/, /^env$/, /^printenv(\s|$)/,
  // PowerShell read-only
  /^Get-/i, /^Select-/i, /^Measure-/i, /^Test-Path\s/i, /^Resolve-Path\s/i,
  /^\$PSVersionTable/i,
];

// Redirección de salida: convierte cualquier lectura en escritura.
// Se excluye `2>&1`, `>&2` y `<` (entrada) — esos no escriben archivos.
const WRITE_REDIRECT = /(?<![0-9&])>>?(?!\s*&\s*[12])/;

// Comandos que consumen un pipe y ESCRIBEN. `grep x | tee f` no es lectura.
const SINK_WRITES = /^(tee|dd|sponge|xargs)\b/;

/**
 * Parte el comando en segmentos por operadores de shell, RESPETANDO comillas.
 *
 * Un split con regex sobre `|` rompe `grep "a\|b" f` en dos pedazos y el
 * segundo deja de parecer una lectura. El síntoma era un `deny` sobre un grep;
 * la causa es tratar el contenido de una comilla como si fuera sintaxis.
 *
 * @param {string} cmd
 * @returns {string[]}
 */
function splitSegments(cmd) {
  const s = String(cmd || "");
  const out = [];
  let buf = "";
  let quote = null;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      buf += c;
      if (c === quote && s[i - 1] !== "\\") quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; buf += c; continue; }
    if ((c === "&" && s[i + 1] === "&") || (c === "|" && s[i + 1] === "|")) {
      out.push(buf); buf = ""; i++; continue;
    }
    if (c === "|" || c === ";") { out.push(buf); buf = ""; continue; }
    buf += c;
  }
  out.push(buf);
  return out.map((x) => x.trim()).filter(Boolean);
}

/** Vacía el contenido de las comillas: `grep "a > b" f` no redirige nada. */
function stripQuoted(cmd) {
  return String(cmd || "").replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
}

/**
 * @param {string} cmd
 * @param {RegExp[]} allowlist
 * @returns {boolean} true solo si TODOS los segmentos están en la allowlist y no
 *                    hay redirección de salida fuera de comillas.
 */
function everySegmentIn(cmd, allowlist) {
  const s = String(cmd || "").trim();
  if (!s) return false;
  const bare = stripQuoted(s);
  if (WRITE_REDIRECT.test(bare)) return false;
  if (/\$\(|\bexec\b|\beval\b/.test(bare)) return false; // sustitución/exec: no auditable acá

  const segments = splitSegments(s);
  if (segments.length === 0) return false;
  return segments.every((seg) => {
    if (SINK_WRITES.test(seg)) return false;
    return allowlist.some((re) => re.test(seg));
  });
}

function isReadOnlyBash(cmd) {
  return everySegmentIn(cmd, READ_ONLY_BASH);
}

// Búsqueda pura: comandos que solo pueden leer y filtrar texto. Es una lista
// MÁS ANGOSTA que READ_ONLY_BASH a propósito — no incluye `find` (acepta
// -exec/-delete) ni `xargs`. Solo se usa para eximir el tier SQL.
const SEARCH_ONLY = [
  /^grep\s/, /^egrep\s/, /^fgrep\s/, /^rg\s/, /^ag\s/,
  /^cat\s/, /^head\s/, /^tail\s/, /^wc\s/, /^echo\s/, /^sed\s+-n\s/,
  /^awk\s/, /^cut\s/, /^sort(\s|$)/, /^uniq(\s|$)/, /^jq\s/,
  /^git\s+(log|show|diff|grep|blame)\b/,
  /^Select-String\s/i, /^Get-Content\s/i,
];

function isSearchOnly(cmd) {
  return everySegmentIn(cmd, SEARCH_ONLY);
}

/**
 * @param {string} cmd
 * @returns {string|null} el patrón catastrófico que disparó, o null.
 */
function catastrophicHit(cmd) {
  const s = String(cmd || "");
  for (const re of CATASTROPHIC_ALWAYS) if (re.test(s)) return String(re);
  if (!isSearchOnly(s)) {
    for (const re of CATASTROPHIC_SQL) if (re.test(s)) return String(re);
  }
  return null;
}

module.exports = {
  CATASTROPHIC, CATASTROPHIC_ALWAYS, CATASTROPHIC_SQL,
  READ_ONLY_BASH, SEARCH_ONLY,
  isReadOnlyBash, isSearchOnly, catastrophicHit, splitSegments, stripQuoted,
};

if (require.main === module) main();

function main() {
let raw = "";
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  let payload;
  try { payload = JSON.parse(raw || "{}"); } catch { payload = {}; }

  const toolName = payload?.tool_name || "";
  const toolInput = payload?.tool_input || {};

  const decide = (decision, reason) => {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision,
        permissionDecisionReason: reason,
      },
    }));
    process.exit(0);
  };

  const pass = () => { process.stdout.write(""); process.exit(0); };

  if (toolName === "Write") {
    return decide("ask", `Write archivo: ${toolInput.file_path || "(sin path)"}. Confirma path y razón.`);
  }

  if (toolName === "Edit") {
    return decide("ask", `Edit archivo: ${toolInput.file_path || "(sin path)"}. Confirma intención y alcance.`);
  }

  if (toolName === "Bash") {
    const cmd = (toolInput.command || "").trim();

    if (catastrophicHit(cmd)) {
      return decide("deny", `BLOQUEO DURO (action-gating): comando catastrófico detectado: \`${cmd.slice(0, 200)}\`. Sin override.`);
    }

    if (isReadOnlyBash(cmd)) {
      return pass();
    }

    return decide("ask", `Bash con posibles efectos: \`${cmd.slice(0, 200)}\`. Confirma intención.`);
  }

  return pass();
});
}
