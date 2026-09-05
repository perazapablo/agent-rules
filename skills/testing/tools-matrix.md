# Tools Matrix — testing

Referencia. **No es ley** — si el proyecto ya usa una tool funcional para la categoría, respetarla.

## Por stack y categoría

| Categoría | Node/TypeScript | PHP | Angular | React |
|---|---|---|---|---|
| **Unit** | Vitest | PHPUnit (o Pest encima) | Vitest (Karma deprecado en v17+) | Vitest + React Testing Library |
| **Integration** | Vitest + supertest + `@testcontainers/mysql` | PHPUnit + `testcontainers-php` | Angular TestBed + HttpTestingController | RTL + MSW (unit-ish) o testcontainers si toca backend real |
| **E2E** | Playwright | Playwright | Playwright | Playwright |
| **Property** | fast-check | Eris | fast-check | fast-check |
| **Fuzzing** | jazzer.js | *(inmaduro — suplir con SAST + más property tests)* | fast-check property | fast-check property |
| **Mutation** | Stryker | Infection | Stryker | Stryker |
| **SAST** | Semgrep + ESLint plugin-security | Semgrep + Psalm/PHPStan | Semgrep + ESLint | Semgrep + ESLint plugin-security + react-hooks/exhaustive-deps |
| **DAST** | OWASP ZAP (contra preview env de Railway) | OWASP ZAP | N/A (frontend puro sin backend propio) | N/A |
| **SCA** | `npm audit` + Snyk / Dependabot | `composer audit` + `roave/security-advisories` | `npm audit` + Dependabot | `npm audit` + Dependabot |

## Cross-cutting

| Tool | Aplica a | Uso |
|---|---|---|
| **gitleaks** | Todo repo | Pre-commit hook + CI. Detecta secretos commiteados. |
| **Trivy** | Repos con Dockerfile | Escanea deps + imagen. Ejecutar en CI antes de push a Railway. |
| **c8 / istanbul** | Node/TS | Coverage. Reportar, no bloquear por %. |
| **pcov / Xdebug** | PHP | Coverage. pcov es más rápido, Xdebug para debug interactivo. |

## Elecciones defendidas

Estas decisiones no son negociables sin motivo técnico concreto del proyecto:

### Vitest > Jest (Node/Angular/React)
- 3-10× más rápido gracias a esbuild + workers.
- ESM nativo (Jest sufre con ESM en 2026).
- API compatible con Jest (`describe`/`it`/`expect`/`vi.mock`).
- Angular v17+ oficialmente deprecó Karma y recomienda Vitest/Jest. Vitest gana por velocidad.
- Excepción: proyecto legacy Jest con miles de tests que funcionan → no migrar.

### Playwright > Cypress (E2E)
- Multi-browser real: Chromium, Firefox, WebKit. Cypress solo Chromium-family bien.
- Sin el modelo raro de "commands sync". API async/await estándar.
- Debug mejor: trace viewer, video, screenshots.
- Mantenido por Microsoft. Ecosistema en crecimiento.
- Excepción: proyecto con suite Cypress estable → no migrar.

### testcontainers > mock de DB (Integration)
- Levanta MySQL real en Docker por suite. Elimina la clase "verde en test, rojo en prod".
- Bugs típicos que un mock oculta: `ONLY_FULL_GROUP_BY`, `sql_mode`, JSON functions, colación, LOCK behavior, transacciones anidadas.
- Overhead: ~5s startup por suite. Aceptable.
- Requisito: Docker en local + CI. Sin Docker no aplica.

### Stryker (JS/TS) e Infection (PHP)
- Únicos mutators serios en sus ecosistemas.
- Correr **solo si** la suite base tarda <2min. Mutation reruns × N mutaciones → si el baseline es 10min, mutation son horas.
- Salida útil: identificar tests débiles, no cazar 100% mutation score.

### Semgrep > SonarQube (SAST)
- OSS, corre local y CI en segundos.
- Reglas OWASP Top 10 mantenidas por comunidad.
- Custom rules en YAML (podés escribir para tu proyecto).
- SonarQube requiere server, licencia empresarial para features útiles, más pesado.
- Excepción: empresa con SonarQube ya desplegado → usar el que hay.

### Infection queja específica (PHP)
- Requiere Xdebug o pcov para coverage. Verificar antes de instalar.
- En proyectos Laravel/Symfony grandes, correr solo sobre módulo cambiado (`--filter=<path>`), no toda la app.

### Fuzzing en PHP
- Casi no existe herramienta madura en 2026.
- Suplir con: (1) property tests con Eris agresivos, (2) SAST con reglas custom, (3) validación estricta en boundary HTTP (form requests en Laravel, DTOs).
- Si el proyecto expone parsers custom o formatos binarios → considerar wrappearlo en Node y fuzzear con jazzer.js.

## Cuándo ignorar el matrix

- El proyecto ya usa otra tool funcional → respetarla.
- Constraint del hosting (Railway no tiene Docker en runtime → testcontainers va en dev/CI, no runtime).
- Licencia empresarial ya paga → usar la que hay, no OSS por dogma.
- Skills del equipo → si nadie sabe una tool, el costo de aprender > beneficio marginal. Priorizar la tool que sí saben usar bien.
