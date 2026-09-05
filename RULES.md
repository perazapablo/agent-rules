@C:/Users/Desarrollos/.config/agent-rules/skills/behavior-core/SKILL.md
@C:/Users/Desarrollos/.config/agent-rules/skills/action-gating/SKILL.md
@C:/Users/Desarrollos/.config/agent-rules/skills/memory-protocol/SKILL.md
@C:/Users/Desarrollos/.config/agent-rules/skills/harness/SKILL.md
@C:/Users/Desarrollos/.config/agent-rules/skills/interfaz-iterativa/SKILL.md

<!-- vendor: mattpocock-skills (always-on) -->
@C:/Users/Desarrollos/.config/agent-rules/skills/grill-me/SKILL.md
@C:/Users/Desarrollos/.config/agent-rules/skills/grilling/SKILL.md
@C:/Users/Desarrollos/.config/agent-rules/skills/codebase-design/SKILL.md

---

# Reglas compartidas — Pablo (meta)

Las reglas activas vienen de los `@imports` de arriba. Este bloque es documentación del sistema, no contiene reglas.

## Cómo funciona

1. Cada agente importa este archivo desde su entrypoint.
2. `RULES.md` recursivamente importa los `SKILL.md` listados.
3. Los `SKILL.md` viven en `skills/<slug>/SKILL.md`.
4. Qué skills carga cada agente: `profiles/<agente>.md` (decisión humana).
5. Catálogo de skills disponibles: `catalog.md`.

## Resolución por agente

| Agente | Entrypoint | Mecanismo de carga |
|---|---|---|
| Claude Code | `~/.claude/CLAUDE.md` → `@RULES.md` | Resolución recursiva de `@imports`. Hooks en `~/.claude/settings.json`. |
| Codex CLI | `~/.codex/AGENTS.md` (sincronizado desde `RULES.md`) | Resolución recursiva de `@imports`. Sin hooks runtime. |
| opencode | `opencode.json.instructions[]` | Lista cada `SKILL.md` explícitamente (no procesa `@`). Hooks vía `plugins/guard.ts`. |

## Enforcement vs texto

Cada `SKILL.md` declara `enforced_by` en frontmatter:
- **Vacío**: regla soft, depende del modelo.
- **Hook(s) listados**: regla hard, harness intercepta a nivel código.

Reglas críticas (acciones persistentes, comandos catastróficos, MCP memory writes) deben tener `enforced_by` poblado.

## Mantenimiento

- Agregar skill V2: crear `skills/<slug>/SKILL.md`, listar en `catalog.md`, agregar `@import` arriba (Claude/Codex), agregar path en `opencode.json.instructions[]` si aplica a opencode.
- Agregar hook: co-ubicar en `skills/<slug>/hooks/`, declarar en `enforced_by`, registrar en settings del agente.
- Verificar coherencia: V2 — comando `agent-rules verify`.

## Referencias

- Catálogo: `catalog.md`
- Perfiles: `profiles/`
- Skills: `skills/`
- Reglas anteriores monolíticas: `RULES.md.bak`
