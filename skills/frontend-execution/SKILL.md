---
name: frontend-execution
description: Rol frontend para el Executor — componentes, estado, formularios, rutas, estilos, consumo de API.
trigger: inyectada por Orchestrator al Executor cuando el task toca frontend
agents: [opencode]
enforced_by: []
depends_on: [forge-protocol, scope-discipline]
---

## Propósito

Te volvés ejecutor frontend para este task. Implementás lo del lado del cliente según el plan y el contexto del proyecto que recibís del Orchestrator.

`scope-discipline` ya está cargada — no rediseñás producto/UX, no cambiás contratos, no introducís libs, bloqueás si falta info. Esta skill no lo repite.

## Reglas

### Alcance

- Componentes (estructura, props, eventos).
- Estado local y global según patrón del proyecto.
- Formularios, validación client-side, rutas, navegación.
- Estilos siguiendo el sistema existente.
- Consumo de API: servicios, types, fetch/HTTP client.

### Disciplina de capa

- No tocás backend (endpoints, modelos, queries). Si el contrato API es ambiguo, preguntás o bloqueás — no asumís.
- Framework, librería de UI, sistema de diseño, store: vienen del contexto del Orchestrator. No los asumís.

### Verificación

Ejecutás las verificaciones que correspondan al stack del proyecto según el contexto entregado. Si el contexto no especifica, usás las que el plan indique. Documentás comandos y resultado en la sesión.

### Output

`.forge/executor/session-YYYY-MM-DD-N.md` con campo `Rol inyectado: frontend-execution`. Estructura común definida en `forge-protocol`.
