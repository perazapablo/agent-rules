#!/usr/bin/env node
// testing: PreToolUse gate contra tests que alcanzan bases que no son suyas.
//
// Origen: 2026-09-04. Un test de integración importó `functions/post.query` en
// el tope del archivo. Ese módulo crea el pool al cargarse, con el `.env` real,
// y los imports estáticos se evalúan ANTES de beforeAll. El `await import()`
// posterior devolvió el pool cacheado —apuntando al servidor remoto— y la
// limpieza defensiva del test dropeó las tablas de purifreze_pruebas: 321
// contratos y 7.745 cobros.
//
// El harness estuvo presente en los dos momentos (el Write del test y el Bash
// que lo corrió) y en ambos preguntó lo mismo que pregunta para cualquier cosa.
// No tenía con qué distinguirlos. Este hook le da ese "con qué".
//
// Dos chequeos, deliberadamente asimétricos:
//
//   (1) Bash + runner de tests  -> DENY si el entorno del repo resuelve a un
//       host de DB no local. Es un hecho binario, no una heurística: o el host
//       es local o no lo es. Se puede afirmar sin leer el código del test.
//
//   (2) Write/Edit de un archivo de test con DDL destructivo -> ASK enriquecido.
//       Acá sí es heurística —un `DELETE FROM` armado por concatenación no lo
//       atrapa ningún regex— así que no bloquea: convierte el "Write archivo:
//       foo.ts" genérico en uno que dice qué sentencia se está por escribir.
//       Un ask que se lee igual que el ruido de fondo se aprueba sin leer, y
//       así fue como pasó.
//
// El único escape de (1) es un archivo que crea el humano:
// `<repo>/.harness/allow-remote-test-db`. A propósito no es una variable de
// entorno ni un flag: el modelo no puede auto-concederse el permiso sin que el
// Write de ese archivo pase por su propio gate y quede a la vista.

const fs = require("fs");
const path = require("path");

const OPT_OUT_REL = path.join(".harness", "allow-remote-test-db");
const MAX_WALK_UP = 6;

// Segmentos que lanzan una suite. `npm test`, `npm run test:integration`,
// `npx vitest run --config ...`, `cargo test`, `pytest`, etc.
const TEST_RUNNERS = [
  /^(?:npx\s+|pnpm\s+(?:dlx\s+)?|yarn\s+(?:dlx\s+)?|bunx\s+)?vitest\b/,
  /^(?:npx\s+|pnpm\s+(?:dlx\s+)?|yarn\s+(?:dlx\s+)?|bunx\s+)?jest\b/,
  /^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test(?::[\w-]+)?\b/,
  /^(?:npx\s+)?stryker\s+run\b/,
  /^(?:php\s+)?(?:vendor\/bin\/)?phpunit\b/,
  /^composer\s+(?:run-script\s+)?test\b/,
  /^(?:php\s+)?artisan\s+test\b/,
  /^cargo\s+(?:test|nextest)\b/,
  /^(?:python3?\s+-m\s+)?pytest\b/,
  /^go\s+test\b/,
];

// Archivos de entorno por convención. `env/.env` está porque server-admin-purifreze
// lo usa así — si un proyecto inventa otra ruta, este gate no lo ve y hay que
// agregarla acá.
const ENV_FILES = [
  ".env",
  ".env.local",
  ".env.test",
  ".env.development",
  path.join("env", ".env"),
  path.join("env", ".env.local"),
  path.join("config", ".env"),
];

const HOST_KEYS = [
  "DB_HOST", "DATABASE_HOST", "DB_HOSTNAME", "MYSQL_HOST",
  "PGHOST", "POSTGRES_HOST", "MONGO_HOST", "REDIS_HOST",
];

const URL_KEYS = [
  "DATABASE_URL", "DB_URL", "MYSQL_URL", "POSTGRES_URL", "POSTGRESQL_URL",
  "MONGO_URL", "MONGODB_URI", "REDIS_URL",
];

// DDL que borra datos. Para el ask de (2), no para el deny de (1).
const DESTRUCTIVE_SQL = [
  { re: /\bdrop\s+database\b/i, what: "DROP DATABASE" },
  { re: /\bdrop\s+schema\b/i, what: "DROP SCHEMA" },
  { re: /\bdrop\s+table\b/i, what: "DROP TABLE" },
  { re: /\btruncate\s+(?:table\s+)?[`"'\w]/i, what: "TRUNCATE" },
];

const TEST_PATH = [
  /[._-](?:test|spec)\.[cm]?[jt]sx?$/i,
  /Test\.php$/,
  /[\\/](?:tests?|__tests__|spec|test-helpers|fixtures)[\\/]/i,
  /conftest\.py$/,
];

/**
 * Un host es local si no hay forma de que sea la base de otro.
 *
 * Un hostname sin puntos ni dos puntos (`db`, `mysql`) es un servicio de
 * docker-compose: vive y muere con el compose. Cualquier cosa con un punto es
 * un FQDN o una IP ruteable —incluida una IP de LAN como 192.168.1.50, que es
 * exactamente la clase de base compartida que un test no debe tocar.
 */
function isLocalHost(host) {
  const s = String(host || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!s) return true;                                   // sin host no hay destino
  if (s === "localhost" || s === "::1") return true;
  if (s === "host.docker.internal" || s === "docker.for.mac.localhost") return true;
  if (/^127\./.test(s)) return true;
  if (!s.includes(".") && !s.includes(":")) return true;  // servicio de compose
  return false;
}

/**
 * Parte por operadores de shell RESPETANDO comillas. Un split con regex sobre
 * `|` rompe cualquier comando que lleve un pipe adentro de un argumento.
 * (Gemelo del de action-gating/hooks/claude-pre-tool.cjs — los hooks se
 * despliegan sueltos, así que cada uno se banca su propio parser.)
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

function isTestCommand(cmd) {
  return splitSegments(cmd).some((seg) => TEST_RUNNERS.some((re) => re.test(seg)));
}

/**
 * `cd <repo> && npm test` corre en <repo>, no en el cwd del payload. Se toma el
 * ÚLTIMO cd de la cadena: es el que está vigente cuando arranca el runner.
 */
function cdTargetOf(cmd, cwd) {
  let dir = cwd || process.cwd();
  for (const seg of splitSegments(cmd)) {
    const m = seg.match(/^cd\s+(?:"([^"]+)"|'([^']+)'|(\S+))/);
    if (m) {
      const target = m[1] || m[2] || m[3];
      dir = path.resolve(dir, target);   // resolve normaliza separadores mixtos de Windows
    }
  }
  return path.resolve(dir);
}

function parseEnvFile(file) {
  const out = {};
  let raw;
  try { raw = fs.readFileSync(file, "utf8"); } catch { return out; }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[m[1]] = value;
  }
  return out;
}

function hostFromUrl(value) {
  try { return new URL(String(value)).hostname; } catch { return ""; }
}

/**
 * Recorre hacia arriba desde `dir` juntando los hosts de DB declarados.
 *
 * PRIVADA a propósito: lo que sale de acá son valores de un `.env`. La única
 * salida pública es `hasRemoteDbHost()`, que devuelve un booleano. El proceso
 * del hook necesita leer el archivo para decidir; el agente no necesita —ni
 * debe— ver el contenido, y un `permissionDecisionReason` va derecho a su
 * contexto. Angostar la interfaz es lo que garantiza que no se filtre: no
 * alcanza con acordarse de no imprimirlo.
 */
function readDbHosts(dir) {
  const found = [];
  let current = path.resolve(dir);

  for (let i = 0; i < MAX_WALK_UP; i++) {
    for (const rel of ENV_FILES) {
      const file = path.join(current, rel);
      if (!fs.existsSync(file)) continue;
      const env = parseEnvFile(file);
      for (const key of HOST_KEYS) {
        if (env[key]) found.push({ source: path.join(path.basename(current), rel), key, host: env[key] });
      }
      for (const key of URL_KEYS) {
        if (!env[key]) continue;
        const host = hostFromUrl(env[key]);
        if (host) found.push({ source: path.join(path.basename(current), rel), key, host });
      }
    }
    if (fs.existsSync(path.join(current, ".git"))) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  // El entorno del propio shell cuenta igual: una var exportada llega al runner.
  for (const key of HOST_KEYS) {
    if (process.env[key]) found.push({ source: "process.env", key, host: process.env[key] });
  }
  for (const key of URL_KEYS) {
    if (!process.env[key]) continue;
    const host = hostFromUrl(process.env[key]);
    if (host) found.push({ source: "process.env", key, host });
  }

  return found;
}

/**
 * Única salida pública del chequeo de entorno: sí o no. Ni el host, ni la
 * clave, ni el archivo — nada de lo leído cruza esta interfaz.
 *
 * @param {string} dir
 * @returns {boolean} true si alguna variable de host de DB apunta fuera de local
 */
function hasRemoteDbHost(dir) {
  return readDbHosts(dir).some((h) => !isLocalHost(h.host));
}

function hasOptOut(dir) {
  let current = path.resolve(dir);
  for (let i = 0; i < MAX_WALK_UP; i++) {
    if (fs.existsSync(path.join(current, OPT_OUT_REL))) return true;
    if (fs.existsSync(path.join(current, ".git"))) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return false;
}

function isTestPath(p) {
  const s = String(p || "");
  return TEST_PATH.some((re) => re.test(s));
}

function destructiveSqlIn(content) {
  const text = String(content || "");
  const hits = [];
  for (const { re, what } of DESTRUCTIVE_SQL) {
    if (re.test(text) && !hits.includes(what)) hits.push(what);
  }
  // DELETE FROM sin WHERE en la misma sentencia.
  const deletes = text.match(/\bdelete\s+from\s+[^;`'"\n)]+/gi) || [];
  if (deletes.some((d) => !/\bwhere\b/i.test(d)) && !hits.includes("DELETE sin WHERE")) {
    hits.push("DELETE sin WHERE");
  }
  return hits;
}

// `readDbHosts` y `parseEnvFile` NO se exportan: devuelven contenido de `.env`.
module.exports = {
  isLocalHost, isTestCommand, cdTargetOf, hasRemoteDbHost,
  hasOptOut, isTestPath, destructiveSqlIn,
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
    const cwd = payload?.cwd || process.cwd();

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

    try {
      if (toolName === "Bash") {
        const cmd = String(toolInput.command || "").trim();
        if (!isTestCommand(cmd)) return pass();      // salida temprana: 0 I/O en el 99% de los Bash

        const repoDir = cdTargetOf(cmd, cwd);
        if (hasOptOut(repoDir)) return pass();

        if (!hasRemoteDbHost(repoDir)) return pass();

        // El mensaje NO nombra el archivo, la clave ni el host: va al contexto
        // del agente y el contenido de un .env no es asunto suyo. Pablo sabe
        // cuál es su entorno; el agente solo necesita saber que está frenado.
        return decide("deny",
          `BLOQUEO (testing/test-db-gate): el entorno de este repo apunta a una base de datos que no ` +
          `es local, así que no se corre un runner de tests acá.\n` +
          `\`${cmd.slice(0, 160)}\`\n\n` +
          `Un runner con credenciales remotas en el entorno puede escribir o borrar esa base, y no hay ` +
          `forma de verlo desde afuera del proceso. Ya pasó el 2026-09-04.\n` +
          `Esto lo resuelve Pablo, no el agente: (a) apuntar el entorno de tests a un container local, ` +
          `o (b) si el destino remoto es intencional, crear \`${OPT_OUT_REL}\` en el repo.\n` +
          `No leas ni cites el archivo de entorno para diagnosticar esto.`);
      }

      if (toolName === "Write" || toolName === "Edit") {
        const file = toolInput.file_path || "";
        if (!isTestPath(file)) return pass();

        const content = toolName === "Write" ? toolInput.content : toolInput.new_string;
        const hits = destructiveSqlIn(content);
        if (hits.length === 0) return pass();

        return decide("ask",
          `DDL destructivo en un archivo de test: ${hits.join(", ")}\n` +
          `  ${file}\n` +
          `Confirmá que el destino solo puede ser un container efímero. Un container recién creado ` +
          `no tiene nada que limpiar: si hay una limpieza "por las dudas", el que sobra es el DROP, ` +
          `no el container.`);
      }
    } catch {
      return pass();   // un bug acá no puede frenar el trabajo; el deny exige evidencia positiva
    }

    return pass();
  });
}
