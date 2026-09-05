# Profile: Codex CLI

Skills always-on para Codex CLI, en orden de carga.

## Skills

- behavior-core
- action-gating
- memory-protocol

## Notas de integración

- Entrypoint: `~/.config/AGENTS.md` (Codex CLI) importa este archivo o concatena los SKILL.md listados arriba.
- Codex CLI no soporta hooks runtime tipo Claude. Las skills con `enforced_by` quedan **advisorias** en Codex — el texto se carga, el bloqueo de código no aplica.
- Si Codex agrega soporte de hooks en el futuro, los `.cjs` co-ubicados se pueden reutilizar.
