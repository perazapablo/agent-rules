#!/usr/bin/env node
// PostToolUse adapter: classifies each tool call and updates SessionStats.
// Silent on all errors. Matches all tools; the classifier decides what counts.

const path = require('node:path');
const os = require('node:os');

// Rutas derivadas de $HOME: el mismo archivo corre en Windows y en Linux.
const HARNESS = path.join(os.homedir(), '.config/mcp-learning/harness');

const { recordToolUse } = require(path.join(HARNESS, 'stats.cjs'));

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
  try {
    const raw = await readStdin();
    const payload = raw ? JSON.parse(raw) : {};
    const sid = payload?.session_id;
    if (sid) recordToolUse(sid, payload);
  } catch { /* silent */ }
  process.exit(0);
})();
