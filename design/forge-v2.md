# Forge v2 — rediseño del sistema de subagentes opencode

Estado: **diseño**, no implementado.
Reemplaza: el sistema actual de 6 subagentes en `opencode/agents/`.

## Por qué

Tres problemas del Forge actual:

1. **Flujo lento**: `orchestrator → backend|frontend → integrator → auditor` tiene demasiados handoffs serie. Integrator agrega latencia sin valor proporcional en casos comunes.
2. **Roles rígidos**: 6 subagentes hardcodeados con prompt fijo. Cuando un task no encaja limpio en un rol, hay fricción. Mantener 6 prompts paralelos es costoso.
3. **Modelos/permisos mal calibrados**: catálogo opencode-go cambió, costos cambiaron. Tools por subagente son gruesos (`bash:true` global, sin allowlist).

## Principio del rediseño

**Roles dinámicos compuestos por skills.** En lugar de hardcodear "backend agent" con prompt fijo, hay un `executor` polivalente que recibe del orchestrator las skills aplicables al task. Las skills son la unidad de composición.

## Arquitectura

### 4 subagentes (vs 6 actuales)

| Subagente | Rol | Modelo (propuesta) | Permisos |
|---|---|---|---|
| **Orchestrator** | Decide, compone skills, delega | Anthropic Sonnet 4.7 | bash(no-fx), read, write, delegate |
| **Executor** | Ejecuta TODO según skills inyectadas | opencode-go capaz (deepseek-v4-pro o kimi-k2.6) | bash, read, write, edit |
| **Mapper** | Read-only. Mapea estructura, stack, convenciones | opencode-go barato/rápido (glm-5.1 o minimax) | read, bash(read-only) |
| **Auditor** | Read-only. Revisa cambios contra plan y busca regresiones | opencode-go medio (qwen3.6-plus o deepseek) | read, bash(read-only) |

### Cambios respecto al actual

| Forge actual | Forge v2 |
|---|---|
| `backend` (subagente) | Absorbido por Executor con skill `backend-execution` |
| `frontend` (subagente) | Absorbido por Executor con skill `frontend-execution` |
| `integrator` (subagente) | Absorbido por Executor con skill `integration-check` |
| `scout` (subagente) | Renombrado a `Mapper` (alinear con Auditor como par read-only) |
| `auditor` (subagente) | Mantenido como `Auditor` |
| `orchestrator` (subagente) | Mantenido como `Orchestrator` |

## Skills

Catálogo de skills nuevas para Forge v2. Viven en `agent-rules/skills/<slug>/SKILL.md` siguiendo el formato V1.

| Skill | Consumidor | Carga | Función |
|---|---|---|---|
| `forge-protocol` | Todos los Forge | Always-on (declarada en agent.md) | Estructura `.forge/`, archivo por agente, "sin archivo el trabajo está incompleto" |
| `scope-discipline` | Executor, Auditor | Always-on | No rediseñás, no contratos sin OK, no libs sin instrucción, bloqueás si falta info |
| `read-only-mode` | Mapper, Auditor | Always-on | No modifico código, "no detectado" antes que inventar, reporte sin opiniones |
| `backend-execution` | Executor | **Inyectada** por Orchestrator en delegación | APIs, DBs, validaciones, migraciones, tests backend |
| `frontend-execution` | Executor | **Inyectada** | Componentes, estado, rutas, estilos, consumo API |
| `integration-check` | Executor | **Inyectada** | Verificación contratos FE↔BE, build, tests, tipos |
| `project-mapping` | Mapper | Always-on | Detección stack/convenciones/arquitectura/entrypoints (ex-scout) |
| `audit-review` | Auditor | Always-on | Revisión de bugs/desvíos/regresiones (ex-auditor) |

### Always-on vs inyectada

- **Always-on**: declarada en el frontmatter del `agent.md` con `skills: [...]`. Cargada al inicio.
- **Inyectada**: el Orchestrator decide qué skills aplican al task y las pega inline en el mensaje de delegación. El Executor las lee del mensaje. Permite composición sin hardcodear roles ejecutores.

## Mensaje de delegación (composición dinámica)

Cuando el Orchestrator delega al Executor, el mensaje tiene esta forma:

```markdown
# Skills aplicables a este task

@C:/.../skills/backend-execution/SKILL.md
@C:/.../skills/integration-check/SKILL.md

# Task

[descripción concreta del task, referencias a .forge/orchestrator/plan.md si existe]

# Criterio de éxito

[específico]
```

El Executor lee las skills primero, entiende su rol para este task, y procede. Las skills always-on (`forge-protocol`, `scope-discipline`) ya están en su prompt base.

## Coordinación: `.forge/` se mantiene

Decisión cerrada: seguir con archivos `.md` en `.forge/<agente>/`. No migrar reports a MCP memory en V2-B.

### Mapeo nuevo de carpetas

| Agente | Archivo |
|---|---|
| Orchestrator | `.forge/orchestrator/plan.md` (cuando hay plan formal) |
| Executor | `.forge/executor/session-YYYY-MM-DD-N.md` |
| Mapper | `.forge/mapper/project-context.md` |
| Auditor | `.forge/auditor/audit-YYYY-MM-DD-N.md` |

### Carpetas deprecadas

`.forge/scout/`, `.forge/backend/`, `.forge/frontend/`, `.forge/integrator/` quedan **deprecadas**. No escribir más ahí. Históricos se preservan tal cual.

## Flujos

```
Trivial:     Orchestrator -> Executor
Normal:      Orchestrator -> Executor -> Auditor
Complejo:    Orchestrator -> Mapper -> Executor -> Auditor
Loop fix:    Auditor -> Executor -> Auditor  (hasta APROBADO)
```

### Cuándo usar cada flujo

- **Trivial**: typo, rename, import roto, ajuste de una línea. Sin Auditor.
- **Normal**: feature pequeño/medio, fix con lógica. Auditor al final.
- **Complejo**: proyecto nuevo o cambio estructural. Mapper primero para contexto, Auditor al final.
- **Loop fix**: si Auditor rechaza, Executor corrige, Auditor revalida.

## Cada agent.md queda thin

Frontmatter con `skills[]` + solo contenido único:

```yaml
---
name: forge-executor
description: Ejecutor polivalente. Recibe skills inyectadas por Orchestrator.
skills: [forge-protocol, scope-discipline]
mode: subagent
---

## Rol
Ejecutor. Las skills aplicables vienen en el mensaje de delegación.

## Específico
- Si hay `.forge/orchestrator/plan.md`, lo leés primero.
- Si hay `.forge/mapper/project-context.md`, lo usás como referencia de convenciones.
- Implementás solo lo declarado por las skills inyectadas + el task.

## Output
`.forge/executor/session-YYYY-MM-DD-N.md` con: Implementado / Archivos modificados / Verificación / Estado / Pendiente.
```

Contenido común (qué es `.forge/`, qué significa scope-discipline) NO se duplica — vive en las skills.

## opencode.json: cambios

```json
{
  "agent": {
    "orchestrator": { ... },         // mantener, ajustar prompt
    "executor":   { ... },           // NUEVO
    "mapper":     { ... },           // ex-scout renombrado
    "auditor":    { ... }            // mantener, ajustar prompt
  }
}
```

Eliminar: `backend`, `frontend`, `integrator`.

### Permisos granulares por subagente

```json
"executor": {
  "tools": {
    "bash": true,
    "read": true,
    "write": true,
    "edit": true
  }
},
"mapper": {
  "tools": {
    "bash": true,        // solo allowlist read-only — definir en plugin/guard
    "read": true,
    "write": false,
    "edit": false
  }
},
"auditor": {
  "tools": {
    "bash": true,        // idem mapper, solo allowlist read-only
    "read": true,
    "write": false,
    "edit": false
  }
}
```

El `bash` read-only para Mapper/Auditor se enforza vía `plugins/guard.ts` (matchea allowlist tipo `ls|cat|git log|git status|...`).

## Trade-offs honestos

| A favor | En contra |
|---|---|
| Composición dinámica: 1 executor sirve para backend/frontend/integration | Tokens extra por delegación (skills inline) |
| Menos handoffs serie → flujo más rápido | Executor menos predecible que un backend.md fijo: orchestrator carga responsabilidad de componer bien |
| Modelos/permisos recalibrados explícitamente | Necesita validación real con tasks variados antes de borrar el sistema actual |
| `.forge/` se mantiene → cat-friendly inspección | Nada cambia ahí, no aprovechamos persistencia MCP |
| Menos archivos `agent.md` que mantener | Riesgo si el `executor` falla en componer rol — no hay fallback como hoy |

## Pendiente para implementación (V2-B-impl)

Esto es solo diseño. La implementación es trabajo separado.

1. Crear 8 skills nuevas en `agent-rules/skills/`.
2. Actualizar `agent-rules/catalog.md`.
3. Reescribir `opencode/agents/{orchestrator,executor,mapper,auditor}.md`.
4. Eliminar `opencode/agents/{backend,frontend,integrator,scout}.md` (o moverlos a `agents/_deprecated/`).
5. Actualizar `opencode.json`: eliminar agentes viejos, agregar nuevos con modelos/permisos definidos.
6. Extender `verify-rules` para validar frontmatter `skills[]` de `opencode/agents/*.md`.
7. Validar con tasks reales antes de descartar el sistema actual del todo.

## Referencias

- V1 design (skills + perfiles + hooks): decision `5f942163` + artifact `9bf223ff` en MCP project `mcp_memory`.
- V2-A (verify-rules): decision `ac9a2c8d` en MCP project `mcp_memory`.
- Sistema actual: `opencode/agents/{orchestrator,scout,backend,frontend,integrator,auditor}.md`.
