# Pattern: SCA (Software Composition Analysis)

## Propósito

Auditar **dependencias** por CVEs conocidas. Detecta cuando una lib que ya usás tiene una vulnerabilidad publicada — antes que un atacante lo descubra en producción.

Es la tool más barata de todo el stack de seguridad: corre en 5s, cero mantenimiento, atrapa RCEs reales en `lodash`, `axios`, `express`, `lombok`, etc.

## Regla dura

**Debe correr en CI en cada PR + nightly sobre `main`.** Sin CI, los reports se acumulan y nadie los mira. Con CI:
- PR con dep nueva → si tiene CVE HIGH/CRITICAL, bloquear merge.
- Nightly → si aparece nueva CVE en dep existente, alert (Slack/email).

## Tool por stack

### Node/TypeScript

**Built-in: `npm audit`**
```bash
npm audit                          # reporte completo
npm audit --audit-level=high       # solo HIGH+CRITICAL
npm audit --json                   # output machine-readable para CI
npm audit fix                      # auto-fix (updates minor/patch)
npm audit fix --force              # updates major — riesgoso, review manual
```

Script:
```json
"audit": "npm audit --audit-level=high",
"audit:fix": "npm audit fix"
```

**GitHub nativo: Dependabot** (recomendado como default)
`.github/dependabot.yml`:
```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "daily"
    open-pull-requests-limit: 10
    ignore:
      - dependency-name: "typescript"
        update-types: ["version-update:semver-major"]
```

Auto-crea PRs cuando hay updates de seguridad. Zero effort después del setup.

**Alternativa cross-ecosystem: Snyk**
```bash
npm i -g snyk
snyk auth
snyk test                          # scan local
snyk monitor                       # sube snapshot a Snyk dashboard
```

Free tier: ilimitado en repos OSS + 100 tests/mes en privados.

### PHP

**Built-in Composer 2.4+: `composer audit`**
```bash
composer audit                     # reporte completo
composer audit --format=json       # CI-friendly
composer audit --locked            # audita composer.lock (recomendado en CI)
```

Script `composer.json`:
```json
"scripts": {
  "audit": "composer audit --locked"
}
```

**`roave/security-advisories`** — package meta que **bloquea instalación** de deps con CVEs conocidas:
```bash
composer require --dev roave/security-advisories:dev-latest
```

Si intentás `composer require lib-con-cve/foo` → falla ANTES de instalar. Bloqueo preventivo.

**Snyk** también soporta PHP:
```bash
snyk test --file=composer.lock
```

### Angular / React

Mismo `npm audit` + Dependabot que Node.

### Cross-cutting: Trivy (para Docker + deps)

Si el proyecto se dockeriza (para Railway/K8s):
```bash
docker run --rm -v $(pwd):/src aquasec/trivy fs /src
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy image mi-imagen:latest
```

Detecta CVEs en deps del proyecto + CVEs en la base image de Docker.

## Setup en CI (GitHub Actions)

**Job simple `npm audit`:**
```yaml
name: SCA
on: [pull_request, push]

jobs:
  npm-audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm audit --audit-level=high
```

Si aparece CVE HIGH+ → job falla → merge bloqueado.

**Nightly con Snyk:**
```yaml
name: SCA nightly
on:
  schedule:
    - cron: '0 3 * * *'   # 3 AM UTC diario

jobs:
  snyk:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: snyk/actions/node@master
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
        with:
          args: --severity-threshold=high
```

## Cómo interpretar el output

**`npm audit` sample:**
```
# npm audit report

axios  <0.28.0
Severity: high
Server-Side Request Forgery in axios - https://github.com/advisories/GHSA-...
fix available via `npm audit fix`
node_modules/axios
  express-http-proxy  1.0.0 - 2.0.0
  Depends on vulnerable versions of axios
  node_modules/express-http-proxy
```

Interpretación:
- **Severity:** el nivel (info/low/moderate/high/critical).
- **Vulnerable range:** versión afectada.
- **Fix available:** si `npm audit fix` puede resolverlo automáticamente.
- **Dependency chain:** por qué la tenés (dep directa o transitiva).

## Acción por severity

| Severity | Acción |
|---|---|
| **Critical** | Fix inmediato. RCE, auth bypass, leak de credenciales. |
| **High** | Fix en el sprint actual. XSS, injection, DoS. |
| **Moderate** | Backlog, priorizar en próximo release. |
| **Low** | Documentar, fixear cuando toque el área. |
| **Info** | Ignorar (usualmente false positive o informativo). |

## Cuando bloquear merge

En CI:
- **`--audit-level=high`** — bloquea si aparece high o critical.
- Nunca bloquear por `moderate` o menor — genera fatiga de alertas, el equipo empieza a ignorar todo.

## Falsos positivos y excepciones

Algunas CVEs no aplican a tu uso. Ej: RCE via option `xml.parseString(untrustedInput)` pero vos nunca parseás input externo → tu app no está vulnerable.

**Documentar excepciones en `.npmrc-audit` o similar** — pero NUNCA silenciar sin motivo escrito.

`npm audit --exclude` (npm 10+):
```bash
npm audit --exclude=CVE-2024-1234
```

O usar `npm audit --production` para excluir devDeps si CVE está solo ahí.

## Anti-patterns

- **Correr `npm audit fix --force` sin review:** puede subir versiones major que rompen tu app.
- **Ignorar warnings en dev con `--production`:** una CVE en dev tool (webpack, eslint) también te puede comprometer si el atacante manipula tu build.
- **`npm audit` local sin CI:** si no bloquea PRs, se olvida.
- **Fixear la CVE editando `package-lock.json` a mano:** frágil, se rompe en el siguiente `npm install`.
- **Actualizar deps sin correr tests:** update + test es 1 paso, no 2.
- **Silenciar todo lo "informational":** a veces son early warnings de CVEs por confirmar.

## Trigger para correr SCA

- **En cada CI run** (obligatorio).
- **Nightly sobre `main`** (nuevas CVEs aparecen todos los días).
- **Antes de cada release** (double-check antes de tag).
- **Al agregar una dep nueva** (verificar CVEs antes de commit).
