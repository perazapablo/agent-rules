---
name: forge-protocol
description: Protocolo de coordinación Forge — estructura .forge/, archivo por agente, sin archivo el trabajo está incompleto.
trigger: siempre activa para los 4 subagentes Forge (Orchestrator/Executor/Mapper/Auditor)
agents: [opencode]
enforced_by: []
depends_on: []
---

## Propósito

Los subagentes Forge coordinan a través del filesystem en `.forge/<agente>/`. Cada agente que trabaje DEBE dejar un archivo de evidencia. Sin archivo, el trabajo está incompleto: el siguiente agente no puede leer el resultado, el Orchestrator no puede validar, y el ciclo se rompe.

## Reglas

### Estructura `.forge/`

Cada subagente escribe a su carpeta:

| Agente | Archivo |
|---|---|
| Orchestrator | `.forge/orchestrator/plan.md` (cuando hay plan formal) |
| Executor | `.forge/executor/session-YYYY-MM-DD-N.md` |
| Mapper | `.forge/mapper/project-context.md` |
| Auditor | `.forge/auditor/audit-YYYY-MM-DD-N.md` |

Carpetas deprecadas (no escribir más): `.forge/scout/`, `.forge/backend/`, `.forge/frontend/`, `.forge/integrator/`. Históricos se preservan tal cual.

### Numeración de archivos por sesión

`N` arranca en 1 por día y se incrementa por cada sesión del mismo agente en el mismo día.

### Lectura previa antes de empezar

1. Si existe `.forge/orchestrator/plan.md`, leelo primero.
2. Si existe `.forge/mapper/project-context.md`, úsalo como referencia de stack/convenciones.
3. Si auditás o integrás cambios, leé las sesiones relevantes en `.forge/executor/`.

### Estructura común de output

Todo archivo de sesión/audit/plan lleva:
- Fecha (YYYY-MM-DD HH:MM)
- Referencia (plan o sesión auditada)
- Cuerpo (Implementado / Auditado / Mapeado según rol)
- Estado (Completo / Parcial / Bloqueado | APROBADO / RECHAZADO)
- Pendiente (Nada o lista concreta)

### Sin archivo = trabajo incompleto

Si terminás sin escribir el archivo, el Orchestrator debe tratar el resultado como inválido. No hay excepciones por "el cambio fue trivial": el archivo de evidencia es parte del entregable.

## Por qué

- `.forge/` es cat-friendly y revisable por humanos sin tooling extra.
- Filesystem es contrato simple entre agentes sin estado MCP compartido.
- Archivos persistentes permiten retomar tasks en sesiones siguientes y auditar el histórico.

## Excepciones

- Ninguna. El archivo siempre se escribe, aunque el contenido sea mínimo ("nada que reportar" cuenta como contenido válido).
