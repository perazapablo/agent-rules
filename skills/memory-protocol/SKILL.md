---
name: memory-protocol
description: Disciplina de uso del MCP memory como verdad persistente entre sesiones.
trigger: antes de citar memoria, después de decisiones/creaciones, cuando Pablo pide cerrar/checkpoint
agents: [claude, codex, opencode]
enforced_by:
  - hooks/memory-writes.cjs (PreToolUse: mcp__memory__delete_*|mark_obsolete → ask, Claude Code)
depends_on: [behavior-core]
---

## Propósito

La BD del MCP `memory` es la verdad persistente entre sesiones. El código vigente es la verdad técnica inmediata. Si hay conflicto, el código gana — corrijo memoria.

El MCP `memory` es una BD, no un agente. La única safety real es que todas las tools requieren `project_id` explícito como parámetro — si vas a escribir tenés que haber identificado el proyecto. No hay hard-deny técnico sobre `add_*`/`update_*`/`checkpoint`; el único gate del harness es `ask` sobre operaciones destructivas (`delete_*`, `mark_obsolete`).

## Reglas

### Identificar el proyecto (una sola vez)

Todas las tools reciben `project_id` explícito. La primera vez que trabajás sobre un checkout y no sabés su id:

1. `list_projects` — índice compacto. Match por nombre/tags/path contra el checkout actual.
2. Match real → `get_project(id)` y usás ese id de acá en adelante.
3. Sin match real → `upsert_project`. Respetar `outcome`:
   - `created` → id nuevo, usar.
   - `auto_merged` → matcheó por nombre normalizado; usar el id devuelto, NO crear otro.
   - `ambiguous` → el server rechazó por solapamiento. No pasar `confirm_new=true` sin confirmación humana explícita.

Una vez identificado el proyecto, el resto de las tools reciben `project_id` directo. No hay secuencia de arranque impuesta.

### Focus semántico por sesión

Antes del primer write MCP de la sesión (`add_*` / `update_*` / `checkpoint`), llamar `set_focus(session_id, project_id, focus)` con descripción concreta del trabajo del turno. El focus NO es metadata mecánica (branch/sha) — describe **qué se está haciendo** ahora.

- Si Pablo declara el tema explícito, uso su descripción tal cual.
- Si Pablo pivotea en medio de la sesión (ej: pasa de "arreglar focus" a "rediseño viewer" o "refactor rust"), `set_focus` de nuevo con el nuevo tema.
- Si el turno es exploratorio/lectura pura (sin writes), no hace falta setear focus — el gate no dispara en reads.
- El focus previo del proyecto (visible en viewer y en `get_latest_focus_for_project`) es referencia, no default. Cada sesión merece su propio focus si el tema cambió.

### Durante el trabajo

- `decision_record` / `add_artifact` / `add_code_entity` / `add_note` al momento de decidir/crear, no al final.
- **Decisiones = cadenas append-only** (`decision_record`, reemplazó a `add_decision` en v12): `topic_key` identifica la cadena, no la fila. Campos: `statement` (1 frase imperativa), `forces[]` (restricciones vigentes AL MOMENTO), `alternatives[{option, rejected_because|null}]`, `consequences[]`, `origin`, `confidence`.
  - Revisar una decisión: `supersedes=<tip_id>`. Sin eso, grabar sobre una cadena con tip activo **falla y devuelve el tip** — no podés pisar lo que no leíste.
  - `origin` es obligatorio: `user_explicit`/`user_implicit` hay que afirmarlos; si no estás seguro, `agent_inferred`. Es la única defensa contra rationale fabricado.
  - `rejected_because: null` es estado válido (se descartó pero nadie registró por qué). **Nunca inventarlo** — preguntar o dejarlo null.
  - No hay update/delete. `decision_revert(id, reason, session_id)` si la decisión se deshizo sin reemplazo.
- `set_working_state` cuando el foco pivotea, no por mensaje.
- `search_all(query, project_id)` cuando necesitás recuperar y no sabés el tipo — devuelve snippets ~200 chars, no payload.
- `context_for_topic(project_id, topic_key)` para retomar un tema en frío: devuelve la cadena tip-first (qué se decidió y cómo se llegó).
- `get_note` / `get_artifact` / `get_code_entity` por id cuando el snippet no alcanza.
- `build_context(project_id, token_budget)` cuando arrancás a trabajar sobre el proyecto y querés cargar contexto durable.
- `get_sessions(project_id)` cuando necesitás detectar continuidad — devuelve las últimas 5 del proyecto.

### Cierre (solo cuando Pablo lo pide)

No autónomo. Solo si Pablo dice "cerrá", "checkpoint", "guardá la sesión" o equivalente:

- `checkpoint(SessionSummary)` — persiste summary + actualiza `context_summary` del proyecto.
- `get_pending_judgments(project_id)` → `judge_relation(sync_id, status)` en batch.

El agente no decide cerrar por su cuenta. Nada de "detecté fin de etapa lógica".

### Anti-duplicado (a nivel proyecto)

1. Confirmar el proyecto UNA vez al inicio: `list_projects` → match por nombre/tags/path → `get_project(id)`. Si no hay match real → `upsert_project`.
2. Identificado el proyecto, avanzar directo con `add_*`. **No** hacer `search_*` defensivo antes de cada `add_*`.
3. Usar `topic_key` consistente — el MCP deduplica por slug normalizado.

### Cuándo SÍ buscar antes

- Sospecha real de duplicado (mismo topic recién creado, edición sobre algo viejo).
- Update intencional de una entrada existente.

### Cuándo NO buscar

- Cada `add_*` "por las dudas". Eso es paranoia y gasta tokens.

### Summaries estructurados

Rellenar campos, no inventar:

- `SessionSummary { goal, outcome, decisions_ref[], artifacts_ref[], pending[], blockers[], threads_closed[], stats?, notes? }`
- `ContextSummary { capabilities[], architecture, constraints[], pending_work[], notes? }`

### Pendientes: global (thread) vs sesión (pending)

Dos ejes distintos, no mezclar:

- **`project_threads`** — TODO **global del proyecto**. Sobrevive entre sesiones hasta que se cierra explícito (`close_thread`). Es la fuente de verdad de "trabajo abierto en el proyecto". Usar cuando aparece un followup nuevo, una idea para después, un pendiente que trasciende esta sesión. Ejemplo: "auditar viewer para que no muestre estado stale".

- **`SessionSummary.pending`** — trabajo que **intenté resolver en esta sesión y no pude terminar**. Registro histórico inmutable: describe cómo cerró esta sesión específica, no lo que hay que hacer después. Si en próximas sesiones se resuelve, esta entrada no se actualiza — sigue siendo verdad de esa sesión. Ejemplo válido: "el fix del bug X quedó a medias por falta de repro". Ejemplo INVÁLIDO (va a thread): "próxima sesión revisar viewer", "chequear si X queda obsoleto".

- **`SessionSummary.blockers`** — lo que trabó el goal **en esta sesión**. Mismo criterio que pending: registro histórico. Si Pablo aprobó/canceló algo mid-session, es blocker. Si es una limitación técnica del proyecto que aparece todo el tiempo → nota o thread, no blocker.

Regla operativa: antes de meter algo en `pending` o `blockers`, preguntar: "¿esto describe cómo cerró esta sesión, o es trabajo futuro?". Si es futuro → `open_thread`, no `pending`.

`stats` NO se rellena por el modelo — el server lo auto-completa desde harness/state + git + DB. Si el caller manda `stats:null`, `checkpoint` lo llena solo (`repo::stats_derivation::derive`).

### Conflicto memoria vs código

1. El código gana siempre.
2. Si memoria contradice el repo: `update_*` con la verdad actual, o `mark_obsolete(reason="superseded by <code ref>")`.
3. Nunca bloquear en la discrepancia — corregir y seguir.

### No guardar

- Transcript.
- Código crudo.
- Decisiones triviales.
- Info derivable del repo (estructura, paths, git log, blame).

## Por qué

- MCP es una BD, no un agente. Se consulta y escribe on-demand con `project_id` explícito. No hay secuencia obligatoria de arranque.
- `search_*` defensivo antes de cada `add_*` gasta tokens sin beneficio: el MCP ya deduplica por `topic_key`.
- Memoria stale es peor que sin memoria — actúa como ruido. Mejor obsoletar o actualizar.
- Summaries con campos rellenados (no narrativa libre) permiten recuperación estructurada en futuras sesiones.
- El cierre lo dispara Pablo porque el modelo no sabe cuándo una etapa es realmente cerrable — checkpoints prematuros dejan summaries incompletos que después ensucian `build_context`.

## Referencias

- Protocolo extendido y casos borde: `C:/Users/Desarrollos/.config/mcp-learning/MEMORY_PROTOCOL.md`.
- Reglas operativas complementarias: `C:/Users/Desarrollos/.config/mcp-learning/MEMORY_RULES.md`.
