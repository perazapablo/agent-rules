# Pattern: SAST (Static Application Security Testing)

## Propósito

Analiza el **código fuente** sin ejecutarlo, buscando patrones vulnerables: SQL injection, XSS, path traversal, hardcoded secrets, uso inseguro de crypto, etc.

Complementa a DAST (que ataca la app corriendo). SAST atrapa vulns que DAST no ve porque requieren condiciones específicas de estado o rutas no alcanzables por scan externo.

## Regla dura

**Correr en CI por PR + local pre-commit.** Los desarrolladores fixean cuando es rápido (hallazgo → fix → commit). Si el reporte llega días después, se ignora.

## Tool principal: Semgrep

OSS, corre local y CI en segundos, reglas OWASP Top 10 mantenidas por comunidad, custom rules en YAML.

### Instalación
```bash
# Global
pip install semgrep

# Docker (portable, no requiere Python local)
docker run --rm -v $(pwd):/src returntocorp/semgrep semgrep --config=auto /src
```

### Uso básico
```bash
semgrep --config=auto                    # rulesets recomendados según lenguaje detectado
semgrep --config=p/owasp-top-ten         # OWASP Top 10 específico
semgrep --config=p/typescript            # TS-específico
semgrep --config=p/php                   # PHP-específico
semgrep --config=p/react                 # React-específico
semgrep --json --output=semgrep.json     # CI-friendly
```

Script:
```json
"security:sast": "semgrep --config=p/owasp-top-ten --error"
```

`--error` hace que exit code sea non-zero si hay findings — bloquea CI.

## Tools complementarias por stack

### Node/TypeScript: ESLint plugin-security
```
npm i -D eslint-plugin-security
```

`.eslintrc`:
```json
{
  "plugins": ["security"],
  "extends": ["plugin:security/recommended"]
}
```

Detecta patrones peligrosos en tiempo de lint:
- `eval()` uso.
- `child_process.exec` con input dinámico.
- Regex con backtracking (ReDoS).
- `Math.random()` como crypto (usar `crypto.randomBytes`).

### PHP: Psalm / PHPStan (type checkers) + Semgrep
```
composer require --dev vimeo/psalm
composer require --dev phpstan/phpstan
```

No son SAST puros, pero atrapan clases enteras de bugs:
- Type mismatches.
- Null pointer paths.
- Dead code (indicador de bugs).

Complementar con Semgrep para vulnerabilidades específicas (SQLi, XSS en Laravel Blade sin escaping, etc).

### React: eslint-plugin-react-hooks/exhaustive-deps + Semgrep
Detecta:
- `dangerouslySetInnerHTML` con input no sanitizado (XSS).
- Missing deps en `useEffect` (bugs de re-render).
- URL raw en `href` (XSS via `javascript:` scheme).

### Angular: ESLint + Semgrep
Angular templates son relativamente seguros por default (auto-escape). Puntos de riesgo:
- `[innerHTML]="userContent"` sin `DomSanitizer`.
- `bypassSecurityTrustHtml()` uso.
- `HttpClient` con URLs dinámicas de user input (SSRF).

Semgrep detecta esos patrones.

## Setup en CI (GitHub Actions)

```yaml
name: SAST
on: [pull_request, push]

jobs:
  semgrep:
    runs-on: ubuntu-latest
    container:
      image: returntocorp/semgrep
    steps:
      - uses: actions/checkout@v4
      - run: semgrep --config=p/owasp-top-ten --error
```

En PRs, publicar findings como PR comment:
```yaml
      - uses: returntocorp/semgrep-action@v1
        with:
          config: >-
            p/owasp-top-ten
            p/typescript
```

## Custom rules

Ejemplo — detectar hardcoded API key en el codebase (`.semgrep/no-hardcoded-keys.yml`):
```yaml
rules:
  - id: no-hardcoded-api-key
    pattern-either:
      - pattern: |
          const $VAR = "sk_live_..."
      - pattern: |
          const $VAR = "AIza..."
    message: Hardcoded API key detected. Use env vars.
    languages: [typescript, javascript]
    severity: ERROR
```

Correr con:
```bash
semgrep --config=.semgrep/
```

## Cómo interpretar findings

Semgrep output:
```
services/user.service.ts
   detected-sql-injection
      Detected string concatenation in SQL query. Use parameterized queries.

       23 │   const query = `SELECT * FROM users WHERE id = ${userId}`;
```

Categorías típicas:
- **ERROR** — bug real, fix obligatorio.
- **WARNING** — patrón peligroso, review manual (a veces false positive).
- **INFO** — mejora sugerida.

## Falsos positivos

Semgrep tiene menos que otros SAST, pero pasan. Suprimir con comentario en línea:
```ts
// nosemgrep: detected-sql-injection
const query = `SELECT ...`;   // razón: userId ya validado por Zod arriba
```

**Regla:** siempre incluir el motivo en el comentario. Sin motivo → asumir que es real y fixear.

## SAST vs otros checks

| Categoría | Detecta | Cuándo |
|---|---|---|
| **SAST (Semgrep)** | Patrones vulnerables en código fuente | Local + CI |
| **SCA (`npm audit`)** | CVEs en dependencias | CI + nightly |
| **DAST (ZAP)** | Vulns en runtime, ataques al sistema corriendo | CI (contra preview env) |
| **Secret scanning (gitleaks)** | API keys/passwords commiteados | Pre-commit + CI |

Los 4 son complementarios. Ninguno reemplaza a otro.

## Anti-patterns

- **Solo correr SAST 1x al mes** — findings se acumulan, backlog impagable.
- **Ignorar todos los findings sin review** — culo cubierto legalmente ("teníamos SAST") pero cero valor real.
- **Bloquear PRs por WARNING/INFO** — genera fatiga de alertas, equipo empieza a ignorar todo.
- **Custom rules sin tests** — regla mal escrita spammea al equipo. Escribir 2-3 casos happy + 2-3 negative antes de commitear la regla.
- **SAST reemplaza review humano** — SAST atrapa patrones conocidos. Bugs de lógica de negocio requieren cerebro humano.

## Trigger para correr SAST

- **Local pre-commit** — con hook simple, `semgrep --error` sobre archivos staged.
- **CI en cada PR** — obligatorio.
- **Nightly sobre `main`** — nuevos patrones aparecen en rulesets community.
- **Post-incident** — si hubo un bug de seguridad, agregar rule custom que lo detecte.
