# Vendor — skills externos

Skills clonados de repos upstream, expuestos vía junctions.

## Estructura

```
vendor/
└── mattpocock-skills/       ← git clone de github.com/mattpocock/skills
```

## Cómo se exponen

Junctions (`mklink /J`) en:

- `~/.config/agent-rules/skills/<slug>` — para RULES.md + opencode
- `~/.claude/skills/<slug>` — para Claude Code (auto-descubre)

## Skills integrados de mattpocock-skills

| Slug | Origen | Uso |
|---|---|---|
| `grill-me` | productivity | user-invoked `/grill-me` |
| `grilling` | productivity | target de grill-me |
| `handoff` | productivity | user-invoked `/handoff` (+ override MCP) |
| `to-spec` | engineering | user-invoked `/to-spec` (+ override MCP) |
| `diagnosing-bugs` | engineering | model-invoked |
| `tdd` | engineering | model-invoked |
| `codebase-design` | engineering | always-on |

## Overrides locales

Archivos `<slug>.override.md` en `~/.config/agent-rules/skills/` que extienden skills sin tocar el vendor (para preservar `git pull`).

- `to-spec.override.md` — persiste spec en MCP memory además del tracker
- `handoff.override.md` — dispara `checkpoint` MCP en paralelo al `.md`

## Actualizar upstream

```bash
cd ~/.config/agent-rules/vendor/mattpocock-skills
git pull
```

Los junctions se resuelven al vendor, así que los skills se actualizan automáticamente. Los overrides quedan intactos.

## Agregar/quitar un skill del bundle

Junction nueva:
```
mklink /J C:\Users\Desarrollos\.config\agent-rules\skills\<slug> C:\Users\Desarrollos\.config\agent-rules\vendor\mattpocock-skills\skills\<cat>\<slug>
mklink /J C:\Users\Desarrollos\.claude\skills\<slug> C:\Users\Desarrollos\.config\agent-rules\vendor\mattpocock-skills\skills\<cat>\<slug>
```

Borrar junction (⚠️ NUNCA con `/S` — borraría el vendor):
```
rmdir C:\Users\Desarrollos\.config\agent-rules\skills\<slug>
rmdir C:\Users\Desarrollos\.claude\skills\<slug>
```

## Nota sobre `agent-rules verify`

Warnings tipo "skills/<slug>/ no existe" para skills junctioned son **falsos positivos**. El script Rust usa `entry.file_type()?.is_dir()` que devuelve false para junctions (no sigue links). Los archivos son legibles funcionalmente. Fix pendiente en `mcp-learning/rust/src/bin/verify_rules.rs` línea ~255.
