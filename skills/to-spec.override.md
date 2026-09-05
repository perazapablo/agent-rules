---
name: to-spec-mcp-override
description: Extensión local de `to-spec` — persiste el spec en MCP memory del proyecto además del issue tracker.
metadata:
  type: override
  extends: to-spec
---

## Override MCP — persistencia en memoria del proyecto

Cuando ejecutes `to-spec`, además de publicar al issue tracker:

1. **Identificar el proyecto MCP** una sola vez por sesión (`list_projects` → `get_project(id)` o `upsert_project` si no existe). Si ya lo hiciste antes en la sesión, reusar el `project_id`.

2. **Persistir el spec completo** como artifact en MCP memory:
   - `add_artifact(project_id, kind="spec", title=<título del spec>, body=<contenido completo del spec>, topic_key=<slug del feature>)`
   - Usar `topic_key` consistente para deduplicar en re-runs.

3. **Persistir las decisiones clave** por separado. De la sección "Implementation Decisions" del spec, cada decisión no-trivial va como:
   - `decision_record(project_id, session_id, topic_key=<slug>, statement=<la decisión en 1 frase>, forces=[<restricciones vigentes>], alternatives=[{option, rejected_because|null}], consequences=[...], origin, confidence)`
   - `origin`: `user_explicit` si la decisión está afirmada en el spec por el usuario; `agent_inferred` si la dedujiste vos. Nunca inventes un `rejected_because` — null es válido.
   - No inundes con triviales. Solo lo que un futuro agente necesitaría recordar.

4. **Confirmar al usuario** al terminar: "Spec publicado en <tracker> + persistido en MCP memory (artifact + N decisiones)."

## Por qué

- El issue tracker es efímero para el agente (requiere fetch cada vez).
- MCP memory es searchable via `search_all` / `build_context` en futuras sesiones sin salir del proyecto.
- Duplicación intencional: tracker sirve al humano, MCP sirve al agente.

## Cuándo NO hacer esto

- Si el usuario dice "solo tracker" o equivalente.
- Si no hay proyecto MCP identificable y el usuario no quiere crear uno ahora.
