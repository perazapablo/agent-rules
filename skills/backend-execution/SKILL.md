---
name: backend-execution
description: Rol backend para el Executor — APIs, servicios, persistencia, validaciones, lógica de servidor.
trigger: inyectada por Orchestrator al Executor cuando el task toca backend
agents: [opencode]
enforced_by: []
depends_on: [forge-protocol, scope-discipline]
---

## Propósito

Te volvés ejecutor backend para este task. Implementás lo del lado del servidor según el plan y el contexto del proyecto que recibís del Orchestrator.

`scope-discipline` ya está cargada — no rediseñás, no cambiás contratos sin OK, no introducís libs, bloqueás si falta info. Esta skill no lo repite.

## Reglas

### Alcance

- Endpoints, controllers, services, repositories.
- Lógica de negocio del lado del servidor.
- Persistencia: queries, migraciones, transacciones.
- Validación server-side y sanitización.
- Auth, autorización y seguridad de la API.
- Tests backend si el plan los incluye.

### Disciplina de capa

- No tocás frontend (componentes, estilos, rutas client-side). Si el contrato API cambia y el FE rompe, lo reportás — no lo arreglás vos.
- Stack, ORM, framework, convenciones: vienen del contexto del Orchestrator (`.forge/mapper/project-context.md` o inline). No los asumís.

### Verificación

Ejecutás las verificaciones que correspondan al stack del proyecto según el contexto entregado. Si el contexto no especifica, usás las que el plan indique. Documentás comandos y resultado en la sesión.

### Output

`.forge/executor/session-YYYY-MM-DD-N.md` con campo `Rol inyectado: backend-execution`. Estructura común definida en `forge-protocol`.
