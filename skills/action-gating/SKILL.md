---
name: action-gating
description: Gating de acciones con efecto persistente. Requiere OK explícito por turno.
trigger: antes de Write/Edit/Bash con efectos/git/MCP writes/cambios de config
agents: [claude, codex, opencode]
enforced_by:
  - hooks/claude-pre-tool.cjs (PreToolUse: Write|Edit|Bash, Claude Code)
  - ../../../opencode/plugins/guard.ts (tool.execute.before, opencode)
depends_on: [behavior-core]
---

## Propósito

Las acciones reversibles las ejecuto sin preguntar. Las persistentes requieren OK explícito de Pablo **en este turno**. Aprobar una vez no autoriza turnos futuros.

## Reglas

### Ejecuto sin preguntar (reversibles, locales, read-only)

1. Read, Grep, Glob, lectura de MCP.
2. Comandos shell de solo lectura (`ls`, `cat`, `git status`, `git log`, `git diff`, `git show`, `git branch -l`, `git remote -v`).

### Requiere OK explícito (persistentes, difíciles de revertir)

1. Write de archivos nuevos o sobrescritura.
2. Edit fuera del alcance estricto pedido en el turno.
3. Bash con efectos: instalar, mover, borrar, build, ejecutar servicios, levantar puertos.
4. Todo comando git con efecto: `commit`, `push`, `pull`, `fetch`, `merge`, `rebase`, `reset`, `add`, `stash`, `checkout`, `switch`, `restore`, `clean`, `cherry-pick`, `revert`, `tag` (crear/borrar), `branch` (crear/borrar). En opencode: bloqueado por `guard.ts`. En Claude: bloqueado por `claude-pre-tool.cjs`. En Codex: advisorio.
5. MCP memory writes: `add_*`, `update_*`, `delete_*`, `mark_obsolete`, `checkpoint`, `set_working_state`, `upsert_project`, `save_session`, `update_session`, `update_project_context_summary`.
6. Cambios de configuración: `settings.json`, `config.toml`, `opencode.json`, hooks, permisos, MCP servers.

### Bloqueo duro (sin override posible, devuelve `deny` / `throw`)

1. `rm -rf /`, `rm -rf /*`, `rm -rf ~`, `rm -rf $HOME`, `rm -rf C:\`.
2. `git push --force` (con o sin `-with-lease`) a `main` / `master` / `production`.
3. `git push -f` a `main` / `master` / `production`.
4. `git reset --hard origin/main` (o master/production).
5. `drop database`, `truncate table` — **salvo que todo el comando sea una búsqueda pura**
   (`grep`/`rg`/`cat`/`sed -n`/`git log`, sin redirección y sin `find`, que acepta `-exec`).
6. Fork bomb: `:(){ :|:& };:`.
7. `mkfs`. `dd if=... of=/dev/sd*`.

Los ítems 1-4, 6 y 7 son **verbos del shell**: aparecen en el comando porque se van a
ejecutar. El 5 es **texto que viaja como argumento**, así que aparece igual cuando alguien
lo busca. Por eso es el único con excepción — un `grep -n "TRUNCATE TABLE" migrations/`
no ejecuta SQL, y bloquearlo duro entrena a aprobar sin leer, que es precisamente cómo se
pierde una base de datos.

### Alcance

"Dentro del alcance" = Pablo lo pidió **explícitamente en este turno** o en instrucción duradera (este archivo, profile, otro SKILL.md). Aprobar una acción una vez **no** autoriza futuros turnos del mismo tipo.

## Por qué

- Acciones reversibles no necesitan gate — pedir permiso para `ls` es ruido.
- Acciones persistentes con costo de revertir alto: el costo de pausar es bajo, el de pisar trabajo es alto.
- Catastróficas: no hay razón legítima para que un agente las ejecute. El bloqueo es código, no confianza en el modelo.

## Excepciones

- Si Pablo dice "operá autónomo en este task", el gating de "OK por turno" se relaja **para ese task específico**. El bloqueo duro sigue activo siempre.
- Si una herramienta de write ya tiene permission allow-listed en `settings.json` para casos triviales, el hook lo respeta (no gatea lo ya autorizado).
