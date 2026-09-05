# Pattern: Unit tests

## Propósito

Testear funciones/módulos aislados. Lógica pura, sin I/O real (DB, red, filesystem). Base de la pirámide — 75% del volumen total de tests.

Cada test corre en <10ms. Miles de tests en segundos. Feedback loop de dev debe ser inmediato: guardás → tests corren → sabés si rompiste algo.

## Regla dura

**Testean comportamiento por interfaz pública, no implementación.** Si refactorizás internos sin cambiar comportamiento observable, los tests no deben romperse. Si rompen, están mal escritos.

## Tool por stack

### Node/TypeScript: Vitest
```
npm i -D vitest @vitest/coverage-v8
```

Config `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['**/*.integration.test.ts', '**/node_modules/**'],
    environment: 'node',
    globals: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['**/*.test.ts', '**/*.spec.ts'],
    },
  },
});
```

Script:
```json
"test": "vitest run",
"test:watch": "vitest",
"test:coverage": "vitest run --coverage"
```

Test típico:
```ts
import { describe, it, expect, vi } from 'vitest';
import { calculateTotal } from './pricing';

describe('calculateTotal', () => {
  it('sums items with tax', () => {
    const items = [{ price: 100 }, { price: 50 }];
    expect(calculateTotal(items, { taxRate: 0.16 })).toBe(174);
  });

  it('returns 0 for empty cart', () => {
    expect(calculateTotal([], { taxRate: 0.16 })).toBe(0);
  });

  it('throws when tax rate is negative', () => {
    expect(() => calculateTotal([], { taxRate: -0.1 })).toThrow(/tax rate/i);
  });
});
```

### Angular: Vitest + `@analogjs/vitest-angular`

Karma está deprecado (v17+). Vitest + jsdom es el reemplazo.

```
npm i -D vitest @analogjs/vitest-angular jsdom @vitest/coverage-v8
```

Config `vitest.config.mts`:
```ts
import { defineConfig } from 'vitest/config';
import angular from '@analogjs/vitest-angular/plugin';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [angular()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['src/test-setup.ts'],
    include: ['src/**/*.spec.ts'],
  },
  resolve: {
    alias: { src: resolve(__dirname, 'src') },
  },
});
```

`src/test-setup.ts`:
```ts
import '@analogjs/vitest-angular/setup-zone';
import { getTestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';

getTestBed().initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
```

Test de componente standalone:
```ts
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { LoginComponent } from './login.component';

describe('LoginComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [LoginComponent] });
    TestBed.overrideComponent(LoginComponent, { set: { template: '', styles: [] } });
  });

  it('marks form invalid when empty', () => {
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.LoginForm.invalid).toBe(true);
  });
});
```

**Truco importante:** `TestBed.overrideComponent(X, { set: { template: '' }})` cuando solo testeás lógica del componente. Evita cargar HTML/SCSS pesados que no aportan al test.

### React: Vitest + React Testing Library
```
npm i -D vitest @testing-library/react @testing-library/jest-dom jsdom
```

Test típico:
```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Counter } from './Counter';

describe('Counter', () => {
  it('renders initial value', () => {
    render(<Counter initial={5} />);
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('increments when button clicked', async () => {
    const { user } = render(<Counter initial={0} />);
    await user.click(screen.getByRole('button', { name: /increment/i }));
    expect(screen.getByText('1')).toBeInTheDocument();
  });
});
```

### PHP: PHPUnit
```
composer require --dev phpunit/phpunit
```

Test:
```php
use PHPUnit\Framework\TestCase;
use App\Pricing;

class PricingTest extends TestCase
{
    public function testSumsItemsWithTax(): void
    {
        $pricing = new Pricing();
        $items = [['price' => 100], ['price' => 50]];
        $this->assertSame(174.0, $pricing->calculateTotal($items, 0.16));
    }
}
```

Con **Pest** (syntax más limpio encima de PHPUnit):
```
composer require --dev pestphp/pest
```

```php
test('sums items with tax', function () {
    $items = [['price' => 100], ['price' => 50]];
    expect((new Pricing())->calculateTotal($items, 0.16))->toBe(174.0);
});
```

## Ubicación

**Side-by-side con el código** cuando el proyecto lo soporta (Node/Vitest/Jest default):
```
src/users/users.service.ts
src/users/users.service.spec.ts
```

**Folder separado** cuando es la convención del stack (PHPUnit):
```
src/Users/UserService.php
tests/Unit/Users/UserServiceTest.php
```

## Qué SÍ testear

- Lógica pura (cálculos, transformaciones, validaciones).
- Funciones exportadas de un módulo.
- Métodos públicos de una clase.
- Componentes standalone (input → output visual/estado).
- Reducers/stores (input state + action → output state).
- Serializers/deserializers.
- Pipes/filtros/formatters.

## Qué NO testear acá

- Interacción con DB → **integration**.
- Interacción con API externa → **integration** con mock HTTP (MSW) o **contract test**.
- Flujos UI end-to-end → **E2E**.
- Métodos privados directamente — testear vía interfaz pública.
- Código generado (types de OpenAPI, GraphQL codegen).
- Getters/setters triviales sin lógica.

## Mocking

**Regla:** mockear en el borde, no en el medio.

- Mockear el HTTP client, no cada método del service.
- Mockear el ORM al nivel de repo, no el DB.
- **Nunca** mockear el código que estás testeando.

Ejemplo bueno:
```ts
import { vi } from 'vitest';

const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => ({ data: [] }) });
vi.stubGlobal('fetch', fetchMock);

const result = await usersService.fetchAll();
expect(result).toEqual([]);
expect(fetchMock).toHaveBeenCalledWith('/api/users');
```

Ejemplo malo:
```ts
const spy = vi.spyOn(usersService, 'parseResponse');   // ❌ mockeás lo que testeás
```

## Cobertura

Reportar sí, bloquear no (o umbrales bajos):

```json
"coverage": {
  "thresholds": {
    "lines": 60,
    "functions": 60,
    "branches": 50,
    "statements": 60
  }
}
```

Coverage 100% ≠ tests buenos. Ver `patterns/mutation.md` para medir calidad real.

## Anti-patterns

- **Tautológicos:** `expect(add(2,2)).toBe(2+2)`. Expected values de fuente independiente.
- **Snapshots gigantes:** `toMatchSnapshot()` de componentes enteros.
- **Testear implementación:** verificar métodos privados, mockear colaboradores internos.
- **Test compartido con state:** `beforeAll` que crea state que múltiples tests mutan.
- **Muchos `describe` anidados:** después de 3 niveles, imposible seguir.
- **Fixtures ocultos:** `factory.build('user')` con 20 defaults invisibles.
- **Assert por nada:** `expect(x).toBeDefined()` sin verificar valor concreto.

## Trigger para escribir un unit test

- Cada función/método público nuevo con lógica no trivial.
- Cada bug de producción → 1 unit test que lo reproduce (antes de fixear).
- Cada refactor no trivial → tests que garantizan comportamiento preservado.
- **NO** para: getters/setters, wrappers finos, código generado, prototipos exploratorios.
