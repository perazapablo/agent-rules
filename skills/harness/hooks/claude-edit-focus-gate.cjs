#!/usr/bin/env node
// PreToolUse gate: Edit/Write/Bash-with-effect require session_focus set for
// THIS session_id + project_id BEFORE the model can mutate anything.
//
// Purpose: make MCP use unavoidable at the start of any editing session.
// First Edit/Write/mutation-Bash is denied with instructions until the model
// calls mcp__memory__set_focus.
//
// The decision itself lives in harness/mutation-gate.cjs (shared with the
// opencode adapter). This file only translates payload <-> hook protocol.

const path = require('node:path');
const os = require('node:os');

// Rutas derivadas de $HOME: el mismo archivo corre en Windows y en Linux.
const HARNESS = path.join(os.homedir(), '.config/mcp-learning/harness');

const { evaluate } = require(path.join(HARNESS, 'mutation-gate.cjs'));

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

  const r = evaluate({
    tool_name: payload?.tool_name || '',
    tool_input: payload?.tool_input || {},
    cwd: payload?.cwd || process.cwd(),
    session_id: payload?.session_id,
  });

  if (!r.gated) allow();
  return decide('deny', r.reason);
})();
