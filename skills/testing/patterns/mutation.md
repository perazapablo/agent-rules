# Pattern: Mutation testing

## Propósito

Medir **calidad** de la suite de tests que ya existe. Modifica tu código a propósito (invierte condiciones, cambia operadores, elimina statements) y verifica que **algún test falle**. Si no falla ninguno, ese test — o esa parte del código — no está realmente probada.

**No es** una herramienta para "encontrar bugs" en el código. Es una herramienta para **encontrar tests débiles o inútiles**.

## Cuándo tiene sentido correrlo

Chequeo obligatorio antes de proponer mutation:

- [ ] La suite unit/integration existe y tiene >50 tests reales.
- [ ] La suite completa corre en **<2 minutos**.
- [ ] Coverage por línea está >70% (por debajo, mutation es ruido — hay código sin ningún test).
- [ ] Los tests son deterministas (sin flakiness).

Si alguno falla → **no correr mutation todavía**. Arreglar la suite base primero.

## Por qué el límite de <2min

Mutation genera N mutaciones (típicamente 100-1000+). Por cada mutación, **corre toda la suite** hasta que un test falle o hasta el final. Si tu suite tarda 10min y hay 500 mutaciones → 83 horas.

Optimizaciones (Stryker/Infection las hacen automáticamente si están bien configuradas):
- **Coverage-based:** solo corre los tests que tocan la línea mutada.
- **Incremental:** solo muta código cambiado desde el último run.
- **Paralelismo:** N workers en paralelo.

Con esto, un baseline de 30s + 500 mutaciones puede terminar en 5-10min.

## Tool por stack

### JS/TypeScript: Stryker

```
npm i -D @stryker-mutator/core @stryker-mutator/vitest-runner @stryker-mutator/typescript-checker
```

Config `stryker.conf.json`:
```json
{
  "packageManager": "npm",
  "reporters": ["progress", "clear-text", "html"],
  "testRunner": "vitest",
  "checkers": ["typescript"],
  "coverageAnalysis": "perTest",
  "concurrency": 4,
  "mutate": [
    "src/**/*.ts",
    "!src/**/*.test.ts",
    "!src/**/*.spec.ts",
    "!src/**/*.d.ts"
  ],
  "thresholds": {
    "high": 80,
    "low": 60,
    "break": null
  },
  "incremental": true
}
```

**Comando:**
```json
"scripts": {
  "test:mutation": "stryker run"
}
```

### PHP: Infection

```
composer require --dev infection/infection
```

Requiere Xdebug o pcov activo (Infection lo detecta).

Config `infection.json.dist`:
```json
{
  "source": {
    "directories": ["src"]
  },
  "logs": {
    "text": "infection.log",
    "html": "infection.html"
  },
  "mutators": {
    "@default": true
  },
  "testFramework": "phpunit",
  "phpUnit": {
    "configDir": "."
  },
  "threads": 4,
  "minMsi": 60,
  "minCoveredMsi": 70
}
```

**Comando:**
```json
"scripts": {
  "test:mutation": "infection --min-msi=60 --min-covered-msi=70 --threads=4"
}
```

## Cómo leer el output

Métrica clave: **MSI (Mutation Score Indicator)** = `killed_mutations / total_mutations`.

Interpretación realista (no aspiracional):

| MSI | Significado |
|---|---|
| >90% | Excepcional. Poco común, solo en libs core con test base maduro. |
| 75-90% | Muy bueno. Objetivo para módulos críticos (auth, money, permisos). |
| 60-75% | Aceptable. Objetivo para código general de negocio. |
| 40-60% | Suite tiene huecos. Investigar mutaciones sobrevivientes (`Survived`). |
| <40% | Suite es cosmética. Muchos tests no verifican nada real. |

**No perseguir 100%.** Las últimas mutaciones son típicamente:
- Logging (matarlas requiere mockear el logger).
- Optimizaciones (`if (x === null) return` vs `if (!x) return`: equivalentes).
- Ordenamiento irrelevante.
- Errores de invariantes internos (validaciones defensive).

## Qué hacer con las "surviving mutations"

Una mutación **survived** = tu suite no detectó el cambio. Casos:

1. **El código muerto/redundante** → borrarlo. La mutación sobrevive porque el statement no tiene efecto.
2. **El test es tautológico** → reescribir. Ver `SKILL.md` anti-patterns.
3. **El test falta** → escribir un test que cubra la rama mutada.
4. **La mutación es equivalente semánticamente** (Infection y Stryker las marcan `Equivalent` cuando pueden) → ignorar, no hay bug ni test faltante.

## Trigger para correr mutation

**No correr en cada CI push** — muy caro. Estrategias:

- **On-demand:** dev lo corre cuando quiere validar un módulo antes de mergear feature grande.
- **Nightly:** cron en CI que corre mutation sobre `main` cada noche. Reporte a Slack/email.
- **Por PR crítico:** label `run-mutation` que dispara el job. Bloquea merge si MSI baja de X.
- **Solo módulo cambiado:** `stryker run --mutate src/users/**` sobre lo tocado en el PR.

## Cuándo NO usar mutation

- Suite base <50 tests reales → primero escribir la suite, después medir calidad.
- Proyecto muy dinámico (mucho eval, reflection, DI complejo) → muchas mutaciones son inaplicables o dan false positive.
- Prototipo/POC → mutation es post-madurez.
- CI con presupuesto de tiempo ajustado → si mutation te suma 30min al pipeline, correrla en nightly.

## Anti-patterns

- **Perseguir 100% MSI:** absurdo, ya explicado.
- **Setear `break: <X>` demasiado alto de entrada:** rompe todos los PRs y el equipo desactiva mutation. Empezar sin `break`, medir baseline, subir gradual.
- **Correr mutation con `coverageAnalysis: "off"`:** desactiva la optimización crítica. Tarda 10-100× más.
- **Ignorar `Timeout` mutations:** si muchas timeoutean, hay tests con timeouts absurdos o loops infinitos generados por la mutación. Configurar `timeoutMS` correcto.
- **Correr sin `incremental`:** cada run muta todo el codebase. Con `incremental: true`, solo muta lo que cambió desde el último run.
