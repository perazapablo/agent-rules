---
name: testing
description: Cómo elegir, escribir y correr tests reales en cualquier proyecto de Pablo. Trigger: se implementa lógica nueva, se toca código de features, se corrige bug, o el user pide "testeá"/"QA"/"cobertura". Cubre integration, e2e, mutation y DAST. Reglas universales + tools por stack + patterns por categoría.
enforced_by:
  - hooks/test-db-gate.cjs (PreToolUse: Write|Edit|Bash, Claude Code)
depends_on: [behavior-core, action-gating]
---

## Propósito

Que los tests que se escriben tengan valor real: atrapen bugs, no rompan por refactor, corran rápido, prueben seguridad. No cargo-cult de coverage %. No mocks de DB. No E2E para todo. Elección basada en el proyecto detectado, no en preferencia genérica.

## Orden de trabajo

Nunca proponer tools ni escribir tests sin haber ejecutado estos 3 pasos en orden:

### 1. Detectar el stack (obligatorio antes de tocar nada)

Leer del root del proyecto:

- `package.json` → `dependencies`+`devDependencies`+`scripts`. Detecta: Node/TS, framework (Angular, React, Next, Nest, Express, Fastify), test runner ya presente, gestor (npm/pnpm/yarn/bun).
- `composer.json` → detecta PHP y framework (Laravel, Symfony).
- `angular.json` / `next.config.*` / `vite.config.*` → framework frontend confirmado.
- `Dockerfile` / `docker-compose.yml` → servicios que hay que levantar en tests.
- `railway.json` / `railway.toml` → confirma deploy Railway (aplica a DAST fase 4).
- `.env.example` → qué variables externas se necesitan (DB, APIs).
- `README.md` sección "Testing" o "Development".
- `tsconfig.json` → ESM vs CJS, target.

Si algo no está claro (monorepo, workspaces, múltiples apps), preguntar antes de asumir.

### 2. Detectar qué tests ya existen

- Buscar: `*.test.*`, `*.spec.*`, `tests/`, `__tests__/`, `e2e/`, `cypress/`, `playwright.config.*`, `phpunit.xml*`, `vitest.config.*`, `jest.config.*`, `stryker.conf.*`, `infection.json*`, `.zap/`.
- Correr el runner existente (`npm test`, `composer test`) y ver output. Si falla ya de entrada, ese es el primer problema — no encima más suites rotas.
- Leer 2-3 tests existentes para entender **convención del proyecto** (nombres, estructura, mocks, fixtures).

**Regla dura:** si el proyecto ya tiene una tool funcional para una categoría (ej. Jest en vez de Vitest), **usarla**. No reescribir. Migrar tools es otro task, no parte de agregar tests.

### 3. Elegir tools y categorías

Consultar [`tools-matrix.md`](tools-matrix.md) para el mapa `stack × categoría → tool recomendada`.

Aplicar la pirámide de tests:

```
       /\
      /E2E\      pocos (5%)   — golden path, flujos críticos
     /------\
    /  INT   \   medios (20%) — endpoints, contratos DB
   /----------\
  /   UNIT     \ muchos (75%) — lógica pura
```

No invertir la pirámide. Si el proyecto está sin tests, arrancar por unit + integration. E2E último.

## Categorías cubiertas

Cada una tiene su archivo con reglas específicas:

- [`patterns/unit.md`](patterns/unit.md) — Vitest/PHPUnit, lógica pura sin I/O, 75% del volumen.
- [`patterns/integration.md`](patterns/integration.md) — DB real con testcontainers, endpoints, contratos.
- [`patterns/e2e.md`](patterns/e2e.md) — Playwright, golden path, no todo el árbol.
- [`patterns/property.md`](patterns/property.md) — fast-check/Eris, invariantes que siempre se cumplen.
- [`patterns/fuzzing.md`](patterns/fuzzing.md) — jazzer.js, bombardeo coverage-guided a parsers y handlers.
- [`patterns/mutation.md`](patterns/mutation.md) — Stryker/Infection, medir calidad de la suite existente.
- [`patterns/sast.md`](patterns/sast.md) — Semgrep, patrones vulnerables en el código fuente.
- [`patterns/dast.md`](patterns/dast.md) — ZAP contra preview envs, bombardeo a API corriendo.
- [`patterns/sca.md`](patterns/sca.md) — `npm audit`/`composer audit`/Snyk, CVEs en dependencias.

## Reglas universales (aplican a toda categoría)

### Un test solo toca infraestructura que él mismo creó (regla dura)

Enforzada por `hooks/test-db-gate.cjs`: un runner de tests no arranca si el `.env`
del repo resuelve a un host de base que no es local. El único escape es que Pablo
cree `<repo>/.harness/allow-remote-test-db` — a propósito no es una variable de
entorno, para que el modelo no pueda auto-concederse el permiso.

Lo que el hook **no** puede ver, y por eso va acá:

1. **Un módulo que crea el pool al importarse envenena todo el archivo.** Los
   imports estáticos se evalúan antes que cualquier `beforeAll`. Si el tope del
   test arrastra —aunque sea transitivamente— un módulo que hace `createPool()`
   en su cuerpo, ese pool nace con el `.env` real, y el `await import()` posterior
   devuelve **ese mismo pool** desde la caché de Node. Setear `process.env` en
   `beforeAll` llega tarde.
2. **Por eso: en un archivo de test, ningún import del tope puede alcanzar el
   pool.** Los módulos de la app se cargan con `await import()` dentro de
   `beforeAll`, después de apuntar el entorno al container. Vale dejarlo escrito
   como comentario en el tope del archivo — el próximo que agregue un import
   necesita saber por qué.
3. **No hay limpieza defensiva.** Un container recién creado no tiene nada que
   limpiar. Un `DROP TABLE`/`TRUNCATE` "por las dudas" solo puede hacer daño si
   el destino no era el container — es decir, exactamente en el caso que se
   suponía que estaba cubriendo.
4. **Lo destructivo se verifica contra la conexión, no contra el entorno.** Antes
   de un `DROP`/`TRUNCATE`, chequear a dónde apunta el pool **ya construido**
   (en mysql2: `pool.pool.config.connectionConfig.host`). Una variable de entorno
   la pisa cualquiera en cualquier momento; un pool vivo no miente sobre su destino.

Precedente: 2026-09-04, `server-admin-purifreze`. Un `import { postData } from
'functions/post.query'` en la línea 4 se llevó puesta `purifreze_pruebas` —
321 contratos y 7.745 cobros— con la limpieza defensiva del propio test.

### Qué es un test bueno

- Verifica **comportamiento por interfaz pública**, no detalles internos.
- Se lee como una spec: `user_can_checkout_with_valid_cart`, no `test_1`.
- Sobrevive refactor: el código interno cambia, el test no.
- Falla por una sola razón. Si un test falla y no sabés por qué, está mal escrito.

### Anti-patterns prohibidos

- **Tautológico:** `expect(add(2,2)).toBe(2+2)`. La assertion recomputa lo mismo que el código. Los expected values vienen de fuente independiente (spec, valor conocido, worked example).
- **Implementación-acoplado:** mockea colaboradores internos, testea métodos privados, lee la DB directo en vez de usar la API. Se rompe con refactor sin bug real.
- **Snapshots gigantes:** `toMatchSnapshot()` de árboles UI enteros. Nadie los lee, se aprueban por default.
- **Horizontal slicing:** escribir todos los tests primero, después toda la implementación. Se testea el shape imaginado, no el real. Trabajar en **vertical slices**: 1 test → 1 implementación → repetir.
- **Mock de DB en integration:** anula el propósito. Ver `patterns/integration.md`.

### Nombres

- Formato: `<sujeto>_<acción>_<condición>` o `should <expected> when <condition>`.
- Idioma: el del proyecto. Si el resto de tests están en inglés, mantener inglés.
- Sin numerar (`test_1`, `test_2`). Sin `test`/`it` sin descripción.

### Ubicación

- **Side-by-side** (`foo.ts` + `foo.test.ts`) cuando la convención del proyecto es esa (Vitest/Jest en la mayoría de Node).
- **Folder separado** (`tests/Integration/FooTest.php`) cuando es la convención (PHPUnit, muchos proyectos Angular).
- Consultar [`tools-matrix.md`](tools-matrix.md) por stack.

### Fixtures y datos

- Datos de test **explícitos** en el test, no en fixtures compartidos que ocultan qué se prueba.
- Cuando el fixture es inevitable (integration con seed DB), documentar qué asume.
- Nunca usar datos de producción. Nunca commitear `.env` real.

## Cuándo NO escribir tests

- Prototipo exploratorio que se va a tirar en 2 días.
- Scripts one-shot (migración manual, dump).
- Código generado (types de OpenAPI, GraphQL codegen).
- POCs sin usuarios.

Si Pablo pide tests igual, escribirlos — es su decisión.

## Documentación

Cada proyecto donde se instala una suite → agregar/actualizar `TESTING.md` en el root con:

```markdown
# Testing

## Stack detectado
- Frontend: <framework versión>
- Backend: <framework versión>
- DB: <engine versión>

## Suites
- **Unit:** `<tool>` — `npm run test:unit` — cubre <qué>
- **Integration:** `<tool>` — `npm run test:integration` — cubre <qué>
- **E2E:** `<tool>` — `npm run test:e2e` — cubre <qué>
- **Mutation:** `<tool>` — `npm run test:mutation` — cuándo correr
- **DAST:** `<tool>` — `npm run test:dast` — target env

## Cómo correr localmente
[comandos concretos, requisitos Docker/etc]

## Cómo se ejecuta en CI
[link al workflow, cuándo bloquea merge]
```

Este archivo es la fuente de verdad del proyecto. Si contradice esta skill, gana el proyecto (contexto local > regla global). Actualizar la skill si el desvío es correcto.

## Referencias

- Matrix de tools: [`tools-matrix.md`](tools-matrix.md)
- Patterns por categoría: [`patterns/`](patterns/)
- Rules universales complementarias: `C:/Users/Desarrollos/.config/agent-rules/skills/behavior-core/SKILL.md`
