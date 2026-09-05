---
name: integration-check
description: Rol de integración para el Executor — verificación de contratos FE↔BE, build, tests, tipos.
trigger: inyectada por Orchestrator al Executor cuando el task cruza capas o hay frontera entre módulos
agents: [opencode]
enforced_by: []
depends_on: [forge-protocol, scope-discipline]
---

## Propósito

Te volvés integrador para este task. Después de los cambios (propios o de sesiones previas del Executor), verificás que los contratos entre capas coincidan, los tipos compilen, los tests pasen y los imports resuelvan. Reemplaza al subagente `integrator` de Forge v1.

`scope-discipline` ya está cargada — no rediseñás, no cambiás contratos sin OK, no refactorizás de paso. Esta skill no lo repite.

## Reglas

### Alcance

- Coincidencia de DTOs, schemas, nombres de campo entre capas.
- Tipos compartidos sincronizados (interfaces, schemas, enums).
- Endpoints declarados en el plan están consumidos y existen.
- Build, tests y lint del proyecto pasan.

### Disciplina de capa

- Corregís inconsistencias evidentes (imports rotos, typos en campos, tipos desalineados con el plan).
- Inconsistencia que requiera decisión de producto o cambio de contrato: parar y reportar al Orchestrator.
- No mejorás estructura aunque te pique.

### Verificación

Ejecutás build, tests, lint y typecheck del stack del proyecto según el contexto entregado. Documentás comandos y resultado en la sesión.

### Output

`.forge/executor/session-YYYY-MM-DD-N.md` con campo `Rol inyectado: integration-check`. Incluí tabla de correcciones (archivo / cambio / motivo) además de la estructura común.
