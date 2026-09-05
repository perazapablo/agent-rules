# Catálogo de skills — agent-rules

Índice maestro. Cada línea: `slug — trigger — enforcement`.

## Core (always-on para todos los agentes)

- `behavior-core` — siempre activa — sin hook
- `action-gating` — antes de Write/Edit/Bash/git/MCP writes/config — hook (claude, opencode)
- `memory-protocol` — MCP memory tools — hook (claude, opencode)
- `harness` — SessionStart+PreToolUse+PostToolUse+UserPromptSubmit: mapper CWD→project_id, focus-gate, SessionStats — hook (claude, opencode)

## Producto / interfaz

- `interfaz-iterativa` — al diseñar, construir o modificar una pantalla que usa una persona — sin hook

## Testing (on-demand)

- `testing` — model-invoked al implementar features / fixear bugs / user pide "testeá"/"QA"/"cobertura". Procedural (detecta stack → elige tools desde `tools-matrix.md` → aplica reglas universales + `patterns/*.md`). Cubre integration, e2e, mutation, DAST — hook (claude: `test-db-gate.cjs`, bloquea runners de test cuando el `.env` del repo apunta a un host de DB no local)

## Forge (subagentes opencode)

Always-on (declaradas en frontmatter `skills:` del agent.md):

- `forge-protocol` — los 4 subagentes Forge — sin hook
- `scope-discipline` — Executor, Auditor — sin hook
- `read-only-mode` — Mapper, Auditor — hook (opencode)
- `project-mapping` — Mapper — sin hook
- `audit-review` — Auditor — sin hook

Inyectadas por el Orchestrator en el mensaje de delegación al Executor:

- `backend-execution` — Executor cuando el task toca backend — sin hook
- `frontend-execution` — Executor cuando el task toca frontend — sin hook
- `integration-check` — Executor cuando el task cruza capas — sin hook

## Vendor: mattpocock-skills

Fuente: `vendor/mattpocock-skills/` (junctions en `skills/`). Update con `git pull` en el vendor.

Always-on (importados en `RULES.md`):

- `grill-me` — user escribe `/grill-me` o "grill me" — sin hook
- `grilling` — target de grill-me — sin hook
- `codebase-design` — al diseñar módulos/interfaces/seams — sin hook

On-demand (no importados, se cargan al invocarse):

- `to-spec` — user escribe `/to-spec` para convertir conversación en PRD — sin hook
  - Override MCP: `skills/to-spec.override.md` (persiste en MCP memory además del tracker)
- `diagnosing-bugs` — model-invoked ante "debug"/"diagnose"/"no anda"/"está lento" — sin hook
- `tdd` — model-invoked ante "test-first"/"red-green-refactor" — sin hook
- `handoff` — user escribe `/handoff` para compactar sesión — sin hook
  - Override MCP: `skills/handoff.override.md` (dispara checkpoint MCP en paralelo)

Skipped del bundle: `code-review`, `ask-matt`, `setup-matt-pocock-skills`, `improve-codebase-architecture`, `research`, `grill-with-docs`, `teach`, `implement`, `wayfinder`, `triage`, `prototype`, `domain-modeling`, `resolving-merge-conflicts`, `writing-great-skills`.

## Convenciones

- **Slug**: kebab-case, único en el catálogo.
- **Trigger**: cuándo aplica. Texto libre.
- **Enforcement**: `sin hook` (texto) o `hook (<agentes>)` (código). El detalle exacto vive en el frontmatter `enforced_by` de cada `SKILL.md`.

## Perfiles

Qué skills carga cada agente vive en `profiles/<agente>.md`. El catálogo no decide carga — declara existencia.
