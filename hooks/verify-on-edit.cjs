#!/usr/bin/env node
// PostToolUse(Write|Edit) hook: si el archivo editado está bajo agent-rules/,
// corre `verify-rules --quiet` y propaga warnings/fails como additionalContext.
// No-op si la edición no toca agent-rules/.

const { spawnSync } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");

// Rutas derivadas de $HOME: el mismo archivo corre en Windows y en Linux.
// El binario lleva .exe solo en Windows — cargo no lo agrega en Linux.
const HOME = os.homedir();
const EXE = process.platform === "win32" ? ".exe" : "";
const VERIFY_BIN = path.join(HOME, ".config/mcp-learning/rust/target/release/verify-rules" + EXE);
// Se compara contra file_path normalizado a forward-slash (ver `norm` abajo).
const AGENT_RULES_ROOT = path.join(HOME, ".config/agent-rules").replace(/\\/g, "/");

let raw = "";
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  let payload;
  try { payload = JSON.parse(raw || "{}"); } catch { payload = {}; }

  const file = payload?.tool_input?.file_path || "";
  if (!file) { process.exit(0); }

  const norm = file.replace(/\\/g, "/").toLowerCase();
  const rootNorm = AGENT_RULES_ROOT.toLowerCase();
  if (!norm.startsWith(rootNorm)) { process.exit(0); }

  // Solo correr para SKILL.md, catalog.md, profiles/*.md o RULES.md.
  if (!/(\/SKILL\.md|\/catalog\.md|\/profiles\/[^/]+\.md|\/RULES\.md)$/i.test(norm)) {
    process.exit(0);
  }

  const result = spawnSync(VERIFY_BIN, ["--quiet"], { encoding: "utf8" });
  if (result.status === 0) { process.exit(0); }

  const output = (result.stdout || "").trim() || "(verify-rules sin output)";
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: `agent-rules verify detectó inconsistencias tras editar ${file}:\n${output}`,
    },
  }));
  process.exit(0);
});
