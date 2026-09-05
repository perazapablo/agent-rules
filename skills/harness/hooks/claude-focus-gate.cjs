#!/usr/bin/env node
// PreToolUse adapter for Claude Code. For mcp__memory__* writes that require
// scope, checks whether session_focus has any focus for the tool's project_id.
// If not, returns permissionDecision=ask so the user confirms consciously.
//
// Uses stdout JSON hookSpecificOutput.permissionDecision as per Claude Code
// hook protocol. Silent (exit 0) when tool bypasses the gate or focus exists.

const path = require('node:path');
const os = require('node:os');

// Rutas derivadas de $HOME: el mismo archivo corre en Windows y en Linux.
const HARNESS = path.join(os.homedir(), '.config/mcp-learning/harness');

const {
  checkFocusForSession,
  requiresFocus,
} = require(path.join(HARNESS, 'focus-gate.cjs'));

function readStdin() {
  return new Promise((resolve) => {
    let buf = '';
    if (process.stdin.isTTY) return resolve('');
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (buf += c));
    process.stdin.on('end', () => resolve(buf));
  });
}

function allow() { process.exit(0); }

function decide(decision, reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
}

(async () => {
  let payload = {};
  try {
    const raw = await readStdin();
    payload = raw ? JSON.parse(raw) : {};
  } catch { allow(); }

  const tool_name = payload?.tool_name || '';
  if (!requiresFocus(tool_name)) allow();

  const project_id = payload?.tool_input?.project_id;
  if (!project_id) allow(); // server will reject; nothing to gate.

  const session_id = payload?.session_id;
  if (!session_id) {
    return decide('ask', `[harness] focus-gate: missing session_id in payload. Confirm write?`);
  }

  const r = checkFocusForSession(project_id, session_id);
  if (r.error) {
    return decide('ask', `[harness] focus-gate DB error: ${r.error}. Confirm write?`);
  }
  if (r.has_focus) allow();

  return decide('deny',
    `[harness] BLOQUEO: esta sesión (${session_id.slice(0, 8)}) no llamó set_focus para project_id ${project_id}. ` +
    `Antes de escribir en memoria, llamá mcp__memory__set_focus({ session_id: "${session_id}", project_id: "${project_id}", focus: "<qué estás haciendo ahora>" }). ` +
    `Tool bloqueada: ${tool_name}.`
  );
})();
