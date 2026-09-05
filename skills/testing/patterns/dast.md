# Pattern: DAST (Dynamic Application Security Testing)

## Propósito

Bombardear el sistema **corriendo** con requests maliciosos y ver qué rompe: SQL injection, XSS, auth bypass, path traversal, CSRF, information disclosure, misconfiguration.

No mira el código (eso es SAST). Ataca la app viva desde afuera, como pentester automatizado.

## Regla dura

**Nunca correr DAST contra producción sin autorización explícita.** Un scan genera miles de requests, algunos destructivos (POST/DELETE con payloads). Puede:
- Tirar el sistema (DoS accidental).
- Ensuciar la DB con datos basura.
- Disparar alertas de seguridad reales (WAF, monitoring).
- En infra de terceros (Railway, AWS): violar TOS.

DAST se corre contra:
1. **Preview environment por PR** (Railway lo soporta nativo — recomendado).
2. **Staging aislado** con seed data desechable.
3. **Local dev** con instancia efímera (docker-compose).

## Tool: OWASP ZAP

Free, mantenido, corre headless en CI, cubre OWASP Top 10.

Alternativas: Burp Suite (mejor UI, licencia paga para automatización útil), Nuclei (más liviano, foco en templates de CVEs).

## Modos de scan

### Baseline scan (rápido, seguro, empezar por acá)

- Duración: 1-3 min.
- Solo requests pasivas (no ataques activos).
- Detecta: missing headers (CSP, HSTS, X-Frame-Options), cookies inseguras, TLS misconfig, información filtrada en errores.
- Seguro contra producción **si** estás autorizado.

```bash
docker run -t --rm ghcr.io/zaproxy/zaproxy zap-baseline.py \
  -t https://preview-abc123.up.railway.app \
  -r baseline-report.html \
  -w baseline-report.md
```

### Full active scan (agresivo)

- Duración: 30min-varias horas.
- Ataques reales: inyecciones, fuzzing de params, brute force de dirs.
- **Solo contra preview/staging/local**, nunca prod.

```bash
docker run -t --rm ghcr.io/zaproxy/zaproxy zap-full-scan.py \
  -t https://preview-abc123.up.railway.app \
  -r full-report.html \
  -m 5  # minutes per attack step
```

### API scan (para backends sin UI)

- Consume OpenAPI/Swagger spec o Postman collection.
- Ataca todos los endpoints con payloads relevantes al método/schema.

```bash
docker run -t --rm ghcr.io/zaproxy/zaproxy zap-api-scan.py \
  -t https://preview-abc123.up.railway.app/openapi.json \
  -f openapi \
  -r api-report.html
```

## Setup en CI (GitHub Actions + Railway)

Flujo:
1. Push a PR → Railway deploya preview env → devuelve URL.
2. Action espera que Railway confirme deploy healthy.
3. Corre ZAP baseline contra la URL.
4. (Opcional) Corre full scan si hay label `security-scan`.
5. Publica reporte como PR comment o artifact.
6. Bloquea merge si hay findings HIGH o CRITICAL.

```yaml
name: DAST
on: pull_request

jobs:
  zap:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Wait for Railway preview
        id: railway
        run: |
          # esperar deploy + capturar URL
          echo "url=https://pr-${{ github.event.pull_request.number }}.up.railway.app" >> $GITHUB_OUTPUT

      - name: ZAP Baseline
        uses: zaproxy/action-baseline@v0.13.0
        with:
          target: ${{ steps.railway.outputs.url }}
          fail_action: true
          cmd_options: '-a'

      - name: Upload report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: zap-report
          path: report_html.html
```

## Interpretar el output

ZAP clasifica findings en 4 niveles:

| Nivel | Acción |
|---|---|
| **High** | Bloquear merge. Fixear antes de mergear. Ej: SQLi confirmado, XSS reflejado. |
| **Medium** | Fixear en el mismo PR si es del código nuevo. Si es pre-existente → issue + fix en otro PR. |
| **Low** | Anotar en `SECURITY.md`. Fixear cuando toque el área. |
| **Informational** | Revisar. Muchas veces false positives o mejoras opcionales. |

**False positives esperados** — configurar ignores en `.zap/rules.tsv`:
```
10021	IGNORE	(X-Content-Type-Options en /api/health)
```

## Autenticación

DAST sin auth = scanear la landing page pública. Sirve poco.

Para scanear áreas autenticadas:

- **Bearer token:** pasar `Authorization: Bearer <token>` en headers del scan.
- **Cookie session:** proveer contexto ZAP con login script (form fill + submit).
- **OAuth:** usar refresh token guardado en secret.

**Nunca commitear credentials.** Usar GitHub Secrets, Railway env vars.

## Contra qué NO usar DAST

- Frontend puro (Angular/React SPA sin backend propio) → no hay ataques activos aplicables. SAST + npm audit sí aplican.
- CLI tools sin superficie HTTP → DAST no aplica.
- Servicios internos sin exposición HTTP externa → menos crítico, priorizar otros vectores.

## Complementar con otras tools

DAST no ve todo. Combinar con:

- **SAST** (Semgrep) → bugs en código fuente que DAST no detecta si la vuln requiere condiciones específicas de estado.
- **SCA** (`npm audit`, `composer audit`) → CVEs en deps. DAST no las ve directamente.
- **Secret scanning** (gitleaks) → credentials en el repo.
- **Manual pentest** una vez por año/major release → DAST cubre lo automatizable, humano cubre lógica de negocio.

## Anti-patterns

- **DAST en prod sin autorización.** Puede terminar en despido o legal.
- **Ignorar findings High como "no aplica a nosotros"** sin análisis. Cada High requiere: (a) reproducir manual, (b) confirmar/refutar con evidencia, (c) fixear o documentar por qué no aplica.
- **Correr full scan en cada PR:** 1h+ por PR es inviable. Full scan va en nightly. PR corre baseline.
- **Sin auth → scan superficial.** Configurar auth desde día 1.
- **Reporte HTML abandonado en un artifact:** nadie lo abre. Enviar summary como PR comment con top findings + link al full report.
- **Bloquear merge por Informational:** ruido. Bloquear solo High/Critical.
