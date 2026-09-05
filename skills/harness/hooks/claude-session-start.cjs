#!/usr/bin/env node
// SessionStart adapter for Claude Code. Thin translation layer: reads the hook
// stdin, delegates to the harness core, emits additionalContext.
//
// All the logic (CWD -> project_id, project context load, missed-checkpoint
// drain, formatting) lives in harness/session-context.cjs so the opencode
// adapter gets the exact same context block.

const path = require('node:path');
const os = require('node:os');

// Rutas derivadas de $HOME: el mismo archivo corre en Windows y en Linux.
const HARNESS = path.join(os.homedir(), '.config/mcp-learning/harness');

const { buildSessionContext } = require(path.join(HARNESS, 'session-context.cjs'));

function readStdin() {
  return new Promise((resolve) => {
    let buf = '';
    if (process.stdin.isTTY) return resolve('');
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (buf += c));
    process.stdin.on('end', () => resolve(buf));
  });
}

(async () => {
  let cwd = process.cwd();
  let session_id = null;
  try {
    const raw = await readStdin();
    if (raw) {
      const payload = JSON.parse(raw);
      if (payload && typeof payload.cwd === 'string') cwd = payload.cwd;
      if (payload && typeof payload.session_id === 'string') session_id = payload.session_id;
    }
  } catch { /* ignore malformed stdin, fall back to process.cwd() */ }

  const { text } = buildSessionContext({ cwd, session_id });

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: text,
    },
  }));
  process.exit(0);
})();
