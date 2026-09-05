# Profile: opencode

Skills always-on para opencode, en orden de carga.

## Skills

- behavior-core
- action-gating
- memory-protocol

## Notas de integración

- Entrypoint: `~/.config/opencode/opencode.json.instructions[]` referencia este archivo o los SKILL.md directos.
- Hooks declarados en `enforced_by` se cargan vía `~/.config/opencode/plugins/guard.ts`, que actúa como adapter: lee los `.cjs` del perfil y los registra en los eventos correspondientes (`tool.execute.before`, etc.).
- Subagentes Forge (orchestrator/scout/backend/frontend/integrator/auditor) heredan estas skills. V2 puede declarar perfiles por subagente si hace falta diferenciar.
