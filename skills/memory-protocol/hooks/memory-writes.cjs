#!/usr/bin/env node
// memory-protocol: PreToolUse hook para MCP memory.
// Solo interviene en operaciones destructivas irreversibles: delete_* y mark_obsolete.
// Todo lo demás (add_, update_, checkpoint, etc.) pasa sin gate — la BD no es un
// agente al que haya que disciplinar, y todas las tools ya requieren project_id
// explícito como parámetro.

let raw = "";
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  let payload;
  try { payload = JSON.parse(raw || "{}"); } catch { payload = {}; }

  const toolName = payload?.tool_name || "";

  if (/^mcp__memory__delete_|^mcp__memory__mark_obsolete$/.test(toolName)) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: "Operación destructiva sobre memoria. Confirma id, tipo y razón.",
      },
    }));
    process.exit(0);
  }

  process.stdout.write("");
  process.exit(0);
});
