# Profile: Claude Code

Skills always-on para Claude Code, en orden de carga.

## Skills

- behavior-core
- action-gating
- memory-protocol

## Notas de integración

- Entrypoint: `~/.claude/CLAUDE.md` importa este archivo o concatena los SKILL.md listados arriba.
- Hooks declarados en `enforced_by` de cada skill se registran manualmente en `~/.claude/settings.json` (eventos: SessionStart, PreToolUse, PostToolUse).
- Permisos de tools (allow/deny) viven en `~/.claude/settings.json` — no son skill.
