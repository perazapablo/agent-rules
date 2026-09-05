#!/usr/bin/env node
// UserPromptSubmit adapter. Dos responsabilidades, ambas silenciosas:
//
//   1. Cuenta el turno para SessionStats.
//   2. Deja un FOCUS PROVISIONAL derivado del prompt del usuario.
//
// El (2) existe porque el gate que exigía `set_focus` antes de tocar código
// cobraba un turno entero por cada cambio chico: para arreglar un typo había
// que parar, declarar un focus y recién ahí editar. La trazabilidad estaba
// bien; el precio no.
//
// El arreglo no es aflojar el gate sino quitarle el trabajo: el prompt del
// usuario YA dice qué se está haciendo. Derivarlo de ahí cuesta cero turnos y
// además produce un focus más honesto — sale de las palabras del usuario, no
// de la paráfrasis del modelo. Cuando el trabajo lo amerita, el agente llama
// `set_focus` y lo asciende a declarado (provisional = 0); un prompt posterior
// nunca lo degrada.
//
// Nunca bloquea ni escribe en stdout: un error acá no puede costarle un turno
// al usuario. Si algo falla, queda el gate de respaldo pidiendo el focus a mano.

const path = require('node:path');
const os = require('node:os');

// Rutas derivadas de $HOME: el mismo archivo corre en Windows y en Linux.
const HARNESS = path.join(os.homedir(), '.config/mcp-learning/harness');

const {
  setProvisionalFocus,
} = require(path.join(HARNESS, 'focus-gate.cjs'));
const { incrementTurns } = require(path.join(HARNESS, 'stats.cjs'));
const { resolveCwd } = require(path.join(HARNESS, 'mapper.cjs'));

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
    if (!sid) return;

    incrementTurns(sid);

    const prompt = payload?.prompt;
    if (!prompt) return;
    const r = resolveCwd(payload?.cwd || process.cwd());
    if (!r.matched) return; // sin proyecto al que anclar el focus
    setProvisionalFocus(sid, r.project_id, prompt);
  } catch {
    /* silencioso por diseño */
  } finally {
    process.exit(0);
  }
})();
