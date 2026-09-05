---
name: handoff-mcp-override
description: Extensión local de `handoff` — además del .md portable, dispara checkpoint MCP para el proyecto activo.
metadata:
  type: override
  extends: handoff
---

## Override MCP — checkpoint estructurado en paralelo

Cuando ejecutes `handoff`, además de escribir el `.md` al temp dir:

1. **Identificar el proyecto MCP** (`list_projects` → `get_project(id)`). Si no hay proyecto MCP para este checkout, seguir solo con el `.md` y avisar al usuario.

2. **Ejecutar `checkpoint`** con `SessionSummary` estructurado:
   - `goal`: qué se estaba intentando lograr (misma info del handoff)
   - `outcome`: estado actual (hecho / parcial / bloqueado)
   - `decisions_ref[]`: ids de decisiones creadas/tocadas en la sesión (si las hay)
   - `artifacts_ref[]`: ids de artifacts creados (specs, docs, etc.)
   - `pending[]`: pasos siguientes concretos
   - `blockers[]`: bloqueos explícitos si los hay
   - `notes`: referencia al path del `.md` de handoff (para vincular ambos formatos)

3. **Incluir en el `.md`** una línea al principio:
   > MCP checkpoint: guardado en proyecto <nombre> (id: <project_id>) — recuperable con `build_context` o `get_sessions`.

4. **Confirmar al usuario**: "Handoff en <path.md> + checkpoint MCP en proyecto <nombre>."

## Por qué

- El `.md` es portable (Slack, email, otro agente en otra máquina).
- El MCP checkpoint es searchable/estructurado para retomar en la misma máquina/proyecto.
- Los dos formatos sirven audiencias distintas — no elegir uno.

## Cuándo NO hacer checkpoint

- El usuario dijo explícitamente "solo handoff, sin memoria".
- No hay proyecto MCP y el usuario no quiere crearlo ahora — seguir con `.md` solo.
