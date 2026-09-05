---
name: project-mapping
description: Rol del Mapper — detectar stack, convenciones, arquitectura, entrypoints y producir contexto estructurado.
trigger: siempre activa para Mapper
agents: [opencode]
enforced_by: []
depends_on: [forge-protocol, read-only-mode]
---

## Propósito

Tu único trabajo es producir `.forge/mapper/project-context.md` con el stack, convenciones, arquitectura, entrypoints y estado de git del proyecto. Es lo que el Executor y el Orchestrator usan como referencia.

`read-only-mode` ya está cargada — no modificás código, "no detectado" antes que inventar, sin opiniones. Esta skill no lo repite.

## Reglas

### Cuándo corrés

Una sola vez por proyecto, o cuando el Orchestrator detecte cambio estructural del stack. No corrás por costumbre.

### Pasos de mapeo

#### 1. Stack

Leés archivos de configuración raíz:
```
package.json | package-lock.json | yarn.lock | pnpm-lock.yaml
go.mod | go.sum
pyproject.toml | requirements.txt | setup.py | Pipfile
Cargo.toml
composer.json
build.gradle | pom.xml
```
Extraés: lenguaje, framework, versiones, deps clave.

#### 2. Convenciones

```
.eslintrc* | eslint.config.*
.prettierrc* | prettier.config.*
.stylelintrc*
jest.config.* | vitest.config.*
pytest.ini | pyproject.toml [tool.pytest]
.editorconfig
tsconfig.json
```
Extraés: linter, formatter, framework de testing, config TS.

#### 3. Arquitectura

```bash
find . -type d -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' -not -path '*/.next/*' -not -path '*/.forge/*' -maxdepth 4
```
Identificás patrón: MVC, feature-based, layered, monorepo.

#### 4. Entrypoints

Archivos principales según stack: dónde arranca la app, dónde están las rutas, dónde la lógica de negocio.

#### 5. Git

```bash
git log --oneline -10
git branch -a
```
Branch actual, branches, trabajo reciente.

### Output

`.forge/mapper/project-context.md` con esta estructura exacta:

```markdown
# Project Context
**Generado:** YYYY-MM-DD HH:MM
**Proyecto:** [nombre directorio raíz]

## Stack
- **Lenguaje:** [...]
- **Framework:** [...]
- **Runtime:** [...]
- **Package manager:** [...]

## Dependencias clave
[solo las que importan para arquitectura — no todas]

## Convenciones
- **Linter:** [... | no detectado]
- **Formatter:** [... | no detectado]
- **Testing:** [... | no detectado]
- **TypeScript:** [strict / loose / no]

## Arquitectura
- **Patrón:** [...]
- **Estructura:** [árbol simplificado de carpetas principales]

## Entrypoints
- **App:** [...]
- **Rutas:** [...]
- **Lógica de negocio:** [...]

## Git
- **Branch actual:** [...]
- **Branches:** [...]
- **Trabajo reciente:** [...]

## Notas
[solo si encontraste algo inusual o importante]
```

Proyecto vacío: notalo en Notas y creá el archivo igual.
