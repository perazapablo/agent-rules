# Pattern: E2E tests

## Propósito

Testear el sistema completo desde afuera, como user real. Browser, clics, navegación, formularios, login end-to-end contra backend + DB reales.

**Nunca reemplazan unit/integration.** Son la punta de la pirámide (~5% del volumen total). Cubren lo que la pirámide de abajo no puede: interacción browser + backend + DB en conjunto.

## Regla dura

**Solo golden path + flujos críticos.** Un bug en E2E significa app caída. Todo lo que se pueda testear en unit o integration, va ahí — es 100× más rápido y menos flaky.

Lista típica de flujos E2E válidos (2-5 por app):
- Login + acceso a home autenticado.
- Flujo de compra/checkout completo.
- Onboarding de nuevo user.
- Recuperación de password.
- Acción crítica de negocio del proyecto (ej: "generar factura", "aprobar orden").

**No E2E:** validaciones de form, hover states, tooltips, edge cases de UI, error copy. Todo eso va a unit de componente.

## Tool: Playwright

Único razonable en 2026. Ver `tools-matrix.md` para el porqué.

## Setup

```
npm i -D @playwright/test
npx playwright install --with-deps chromium
```

Estructura (mismo layout Angular/React/Node):
```
project/
  src/...
  e2e/
    fixtures/
      auth.ts           ← login helper reusable
    tests/
      auth.spec.ts
      checkout.spec.ts
    playwright.config.ts
```

Config mínimo:
```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/tests',
  timeout: 30_000,
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: 'html',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: devices['Desktop Chrome'] },
    // agregar firefox/webkit solo si el proyecto los soporta explícitamente
  ],
});
```

## Estructura de test

```ts
import { test, expect } from '@playwright/test';

test.describe('Checkout flow', () => {
  test('user can complete purchase with valid card', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Login' }).click();
    await page.getByLabel('Email').fill('user@test.com');
    await page.getByLabel('Password').fill('test123');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL('/dashboard');

    await page.getByRole('link', { name: 'Products' }).click();
    await page.getByRole('button', { name: 'Add to cart' }).first().click();
    await page.getByRole('link', { name: 'Checkout' }).click();

    await page.getByLabel('Card number').fill('4242 4242 4242 4242');
    await page.getByLabel('Expiry').fill('12/28');
    await page.getByLabel('CVV').fill('123');
    await page.getByRole('button', { name: 'Pay' }).click();

    await expect(page.getByText('Payment successful')).toBeVisible({ timeout: 10_000 });
  });
});
```

## Reglas de escritura

### Selectors

Prioridad de selectors (arriba a abajo, mejor a peor):

1. `page.getByRole('button', { name: 'Submit' })` — usa el árbol de accesibilidad. Sobrevive rediseño CSS.
2. `page.getByLabel('Email')` — atada al label, semántico.
3. `page.getByPlaceholder('you@example.com')` — cuando no hay label.
4. `page.getByText('Welcome')` — para verificar contenido, no para actuar.
5. `page.getByTestId('checkout-btn')` — último recurso, requiere `data-testid` en el markup.
6. **NUNCA** CSS selectors (`.btn-primary`, `#checkout`) ni XPath. Se rompen con cualquier refactor de estilos.

### Waits

- Nunca `page.waitForTimeout(3000)`. Es flakiness garantizada.
- Usar `await expect(...).toBeVisible()` — reintenta hasta timeout, sin sleep arbitrario.
- Para navegación: `await page.waitForURL('/dashboard')` o assertion sobre URL.
- Para requests: `await page.waitForResponse(resp => resp.url().includes('/api/checkout'))`.

### State entre tests

- Cada test empieza desde cero. Sin state compartido.
- Login repetido en cada test es aceptable — usar `storageState` para autenticar 1 vez y reusar:

```ts
// e2e/fixtures/auth.ts
test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill('user@test.com');
  // ... login
  await page.context().storageState({ path: 'e2e/.auth/user.json' });
});

// tests que necesitan auth:
test.use({ storageState: 'e2e/.auth/user.json' });
```

Ahorra 30-60s por test en suites grandes.

### DB state

- **Reset DB antes de cada test** o antes de cada suite. Sin reset, los tests dependen del orden.
- Opciones:
  - Truncate tables via API admin del backend antes del test.
  - Endpoint `/test/reset` que solo existe cuando `NODE_ENV=test`.
  - Seed script + docker-compose que levanta DB fresca por suite.
- **Nunca correr E2E contra DB de producción** — obvio, pero se ha hecho.

## Local vs CI

**Local:** `npm run dev` + `npx playwright test`. Backend y frontend levantados por dev.

**CI:** el runner levanta todo:
```yaml
- run: docker-compose up -d db
- run: npm run migrate
- run: npm run seed:test
- run: npm run build
- run: npm run start &
- run: npx wait-on http://localhost:3000
- run: npx playwright test
```

O contra **preview environment de Railway** — deploy PR → obtener URL → correr E2E contra la URL. Es lo más realista (mismo runtime que prod).

```yaml
- name: E2E vs Railway preview
  env:
    E2E_BASE_URL: ${{ steps.railway-deploy.outputs.url }}
  run: npx playwright test
```

## Ubicación en el árbol

- Node/React/Angular: `e2e/` en el root del proyecto. Config y tests separados de `src/`.
- Monorepo: `e2e/` en el root del monorepo, apunta al app deployado.
- **Nunca** dentro de `src/tests/` mezclado con unit — corren en pipelines distintos.

## Cuándo agregar un test E2E nuevo

Trigger claros:
- Bug de producción en flujo crítico → E2E que lo reproduce.
- Feature nueva que atraviesa 3+ capas (UI → API → DB → email/notification) y es crítica de negocio.
- Regresión pasada que rompió algo grande.

Trigger inválidos:
- "Por completar cobertura." E2E no es para cobertura.
- "Por si acaso." E2E no es defensiva.
- "El PM lo pidió." Entender el flujo primero — probablemente sea unit o integration.

## Anti-patterns

- **E2E como reemplazo de unit:** tests de 200 líneas para verificar que un botón cambia de color al hover. Va a component test.
- **Retries altos para tapar flakiness:** si un test necesita `retries: 5`, está mal escrito. Buscar la race condition, no ocultarla.
- **Sleeps arbitrarios:** `waitForTimeout(3000)` es admisión de "no sé cómo esperar bien". Investigar y usar el wait correcto.
- **Selectors por CSS:** rompe con cada refactor.
- **DB seed gigante compartido:** tests se acoplan a datos que nadie recuerda por qué existen.
- **E2E sin cleanup:** tests que dejan orders/users basura. La DB se ensucia, el próximo run rompe.
- **1 mega-test que hace todo:** login + checkout + reembolso en un solo test. Cuando rompe, no sabés qué falló. Separar por flujo.

---

## Lessons aprendidas — Angular Material + APIs externas (Facturama/SAT/Stripe)

Validado en `admin-purifreze` (Angular 16 + Material) + `server-admin-purifreze` (Express/Node) contra Facturama sandbox. Estas son las reglas que evitan repetir 4-5 iteraciones fallidas.

### 1. SPA con hash routing (Angular <17 con HashLocationStrategy)

URLs son `/#/admin/...`, no `/admin/...`. Navegar sin el hash lleva a login o 404 silencioso.

```ts
await page.goto('/#/admin/facturacion/nueva');        // ✅
await page.goto('/admin/facturacion/nueva');           // ❌ Angular no matchea
```

Assertions de URL con regex: usar `/\/admin/` (matchea con o sin hash), no `/^\/admin/`.

### 2. Auth reusable via multi-project

Login 1 vez por corrida (no por test). Setup dedicado guarda `storageState`.

**`playwright.config.ts`:**
```ts
projects: [
  { name: 'setup', testMatch: /.*\.setup\.ts/ },
  {
    name: 'chromium',
    testMatch: /.*\.spec\.ts/,
    use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/user.json' },
    dependencies: ['setup'],
  },
],
```

**`e2e/tests/auth.setup.ts`:**
```ts
import { test as setup, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

setup('authenticate', async ({ page }) => {
  mkdirSync('e2e/.auth', { recursive: true });
  await page.goto('/#/login');
  await page.getByLabel('Usuario').fill('<user>');
  await page.getByLabel('Contraseña').fill('<pass>');
  await page.getByRole('button', { name: /Acceder/i }).click();
  await expect(page).toHaveURL(/\/admin/, { timeout: 15_000 });
  await page.context().storageState({ path: 'e2e/.auth/user.json' });
});
```

Cada `*.spec.ts` arranca ya logueado. **Nunca commitear `e2e/.auth/`** — agregar al `.gitignore`.

### 3. webServer: `port` vs `url`

- **`url`**: Playwright espera respuesta HTTP 2xx/3xx en la URL. Bueno cuando root (`/`) responde 200.
- **`port`**: Playwright solo chequea si el TCP socket está bindeado. Bueno para backends que devuelven algo raro en `/` (426 Upgrade Required, redirect a HTTPS, WebSocket-only).

Regla: si `curl http://localhost:<port>/` no devuelve 2xx/3xx, usar `port`.

```ts
webServer: [
  {
    command: 'npm run start',
    cwd: '../server',
    port: 3001,                  // no url — backend responde 426 en /
    reuseExistingServer: true,
  },
],
```

`reuseExistingServer: true` en dev — si ya tenés `ng serve` corriendo manualmente, Playwright lo usa. En CI, poner `false` para arrancar limpio.

### 4. Ports squatting (Windows específico)

VS Code, dev tools y debuggers a veces agarran puertos random. Antes de arrancar tests, verificar:

```powershell
netstat -ano | findstr :<PORT>
```

Si aparece un PID que no es tu app → matar:
```powershell
taskkill //F //PID <PID>
```

Nuestra experiencia: VS Code Node utility agarró el 3001, el backend "arrancaba" (log printeaba OK) pero el bind fallaba silencioso.

### 5. Environment del frontend en tests

Apps Angular usan `fileReplacements` en `angular.json` para swappear environments según config de build.

- `ng serve` (default) → `production` config → API_URL apunta a **producción** o **deploy remoto**.
- Para E2E local → usar el script que corre con config `development` o `local` (típicamente `npm run start:local`).

```ts
{
  command: 'npm run start:local',    // NO npm run start
  cwd: '.',
  port: 4200,
},
```

Si no, el frontend hitea el backend de prod mientras el tuyo local está idle. Debugueás durante horas antes de darte cuenta.

### 6. Debugging: capturar tráfico API

Meter listener `page.on('response')` que loguea request/response de endpoints relevantes. Sin esto es imposible debuggear por qué un flujo falla.

```ts
page.on('response', async (resp) => {
  const url = resp.url();
  const method = resp.request().method();
  if (url.includes('/api/') && (method !== 'GET' || resp.status() >= 400)) {
    console.log(`[api] ${method} ${url} → ${resp.status()}`);
    try { console.log(`[body] ${(await resp.text()).slice(0, 400)}`); } catch {}
  }
});
```

Para verlo, correr con `--reporter=list` (Playwright default suprime stdout de tests con reporter html-only).

### 7. Autocompletes de Angular Material (mat-autocomplete)

Playwright `fill()` **no siempre** dispara el `(input)="handler()"` del template Angular en inputs con `[formControl]` + `[matAutocomplete]`. Usar `pressSequentially()` — typing char-por-char emite eventos DOM reales.

Patrón robusto:
```ts
async function seleccionarAutocomplete(page: Page, input: Locator, valor: string) {
  await input.click();
  await input.pressSequentially(valor, { delay: 50 });
  const option = page.getByRole('option').filter({ hasText: new RegExp(valor) }).first();
  await option.waitFor({ state: 'visible', timeout: 15_000 });
  await option.click();
}
```

`mat-option` renderiza con `role="option"` — usar `getByRole('option')` es más estable que selectores por clase.

### 8. Backend transforma inputs — no confiar en match literal

APIs externas (Facturama, SAT, Stripe) suelen normalizar datos. Ej: Facturama devuelve `Value: "1010101"` cuando buscás `q=01010101` — strippea leading zeros.

Regex tolerante:
```ts
const valorSinCeros = valor.replace(/^0+/, '');
const option = page.getByRole('option').filter({ hasText: new RegExp(valorSinCeros) }).first();
```

Otros ejemplos comunes:
- Fechas: format ISO vs local.
- Números: coma vs punto decimal.
- Case sensitivity en códigos.

### 9. Selectors dentro de bloques repetidos (líneas, filas, items)

Para "el último bloque agregado" (típico en formularios con "Agregar línea"):
```ts
const linea = page.locator('.container-class').last();
```

Cuando labels no están asociados (sin `for` attribute), `getByLabel` falla. Usar posicionales dentro del scope:
```ts
const inputs = linea.locator('input[type="text"]');
await inputs.nth(0).fill('descripcion');
await inputs.nth(1).fill('clave');
```

Frágil si el HTML cambia orden, pero mucho más estable que CSS/XPath complejos.

### 10. Errores de APIs externas son señal REAL, no ruido

Facturama sandbox rechazó nuestro POST con validaciones SAT reales:
- "CFDI Use G03 no válido para régimen fiscal 616"
- "Si Receiver.Name = 'PUBLICO EN GENERAL', RFC debe ser XAXX010101000"

Interpretación correcta: el test está atrapando **bugs de datos o de lógica de negocio** que en producción explotarían igual. No "fix" haciendo mock del error — corregir los datos/lógica, o cambiar el test para usar datos válidos.

Regla: cada validación externa que rompe el test = 1 caso de negocio documentado. Cada test data debe respetar las reglas SAT/Stripe/etc del sandbox.

### 11. Timeouts realistas por tipo de acción

- Startup backend Node: 30-60s.
- Startup Angular `ng serve`: 60-180s primera vez (compilación).
- Search autocomplete (query a backend): 5-15s.
- Timbrado en Facturama sandbox: 10-45s.
- Login: 5-15s.

Playwright global `timeout: 90_000` (90s por test) alcanza para flujos de facturación. Aumentar solo si un flujo específico necesita más.

### 12. `.gitignore` para E2E

```
/test-results/
/playwright-report/
/playwright/.cache/
/e2e/.auth/
```

Test-results y playwright-report cambian cada run. `.auth/` contiene tokens de sesión.

