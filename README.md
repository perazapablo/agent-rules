# agent-rules

Reglas compartidas entre agentes (Claude Code, Codex CLI, opencode) y los hooks
que las hacen cumplir a nivel harness.

Vive en `~/.config/agent-rules/`. Los agentes lo importan desde su entrypoint:

| Agente | Entrypoint | Mecanismo |
|---|---|---|
| Claude Code | `~/.claude/CLAUDE.md` → `@RULES.md` | Resolución recursiva de `@imports` + hooks en `settings.json` |
| Codex CLI | `~/.codex/AGENTS.md` (sync desde `RULES.md`) | `@imports`, sin hooks |
| opencode | `opencode.json.instructions[]` | Lista cada `SKILL.md` explícitamente; hooks vía `plugins/guard.ts` |

## Instalación

```bash
git clone --recurse-submodules <url> ~/.config/agent-rules
```

El `--recurse-submodules` trae `vendor/mattpocock-skills`. Si ya clonaste sin él:

```bash
cd ~/.config/agent-rules && git submodule update --init --recursive
```

## Rutas portables

Los hooks `.cjs` **no llevan rutas absolutas**. Derivan todo de `os.homedir()`:

```js
const HARNESS = path.join(os.homedir(), '.config/mcp-learning/harness');
require(path.join(HARNESS, 'focus-gate.cjs'));
```

El mismo archivo corre en Windows y en Linux sin reescritura. `verify-on-edit.cjs`
agrega el `.exe` al binario solo cuando `process.platform === 'win32'`.

En `~/.claude/settings.json` los hooks se invocan con `$HOME`, que bash expande
(los hooks declaran `"shell": "bash"`):

```json
"command": "node $HOME/.config/agent-rules/skills/harness/hooks/claude-post-tool.cjs"
```

**La excepción:** el `command` de un MCP server no pasa por shell, así que ahí
la ruta sigue siendo absoluta y hay que ajustarla a mano en cada máquina:

```bash
grep -n 'mcp-memory' ~/.claude/settings.json ~/.claude.json
```

## Dependencia externa

Los hooks del harness requieren el repo `mcp-learning` en
`~/.config/mcp-learning/` — ahí vive el core (`harness/*.cjs`) y la BD SQLite del
MCP `memory`. Sin él, los hooks fallan al cargar.

## Estructura

```
RULES.md              # entrypoint: importa los SKILL.md activos
catalog.md            # catálogo de skills disponibles
profiles/             # qué skills carga cada agente (decisión humana)
skills/<slug>/
  SKILL.md            # la regla
  hooks/*.cjs         # enforcement (si `enforced_by` está poblado)
hooks/                # hooks que no pertenecen a un skill puntual
vendor/               # skills de terceros (submódulo)
```

## Enforcement vs texto

Cada `SKILL.md` declara `enforced_by` en frontmatter:

- **Vacío** → regla soft, depende del modelo.
- **Hook(s) listados** → regla hard, el harness intercepta a nivel código.

Las reglas críticas (acciones persistentes, comandos catastróficos, writes al MCP
memory) deben tener `enforced_by` poblado — si depende del criterio del modelo,
no es una garantía.

## Verificación

```bash
~/.config/mcp-learning/rust/target/release/verify-rules --quiet
```

Chequea que `catalog.md`, los `profiles/` y los `SKILL.md` no se contradigan.
Corre solo en cada edición vía el hook `PostToolUse` (`hooks/verify-on-edit.cjs`).
