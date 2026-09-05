# Pattern: Property-based tests

## Propósito

En vez de escribir tests con inputs específicos (`add(2,3) === 5`), definís **propiedades que siempre deben cumplirse** (`add(a,b) === add(b,a)` para cualquier `a,b`). El framework genera cientos de inputs random para verificar.

Encuentra edge cases que humanos no imaginan: overflow, empty arrays, unicode raro, negativos, zero, NaN, strings enormes.

## Cuándo aplica

**Buenos candidatos:**
- Funciones puras con propiedades matemáticas (commutativa, asociativa, idempotente, inversa).
- Parsers/serializers (`parse(serialize(x)) === x` para cualquier `x`).
- Validadores (`validate(sanitize(x))` nunca throw).
- Comparators/sorters (`sort(sort(x)) === sort(x)`, `sort(x).length === x.length`).
- State machines (transiciones válidas nunca dejan state inválido).

**Malos candidatos:**
- Lógica de negocio con muchos edge cases específicos → usar unit tradicional.
- I/O (DB, red) → property-based sobre I/O es lento y frágil.
- UI → no tiene sentido.

## Tool por stack

### Node/TypeScript: fast-check

```
npm i -D fast-check
```

Test típico:
```ts
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { add, sortAsc, parseUser, serializeUser } from './lib';

describe('add (property-based)', () => {
  it('is commutative', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => {
        expect(add(a, b)).toBe(add(b, a));
      }),
    );
  });

  it('has identity element 0', () => {
    fc.assert(
      fc.property(fc.integer(), (a) => {
        expect(add(a, 0)).toBe(a);
      }),
    );
  });
});

describe('sortAsc (property-based)', () => {
  it('is idempotent', () => {
    fc.assert(
      fc.property(fc.array(fc.integer()), (arr) => {
        expect(sortAsc(sortAsc(arr))).toEqual(sortAsc(arr));
      }),
    );
  });

  it('preserves length', () => {
    fc.assert(
      fc.property(fc.array(fc.integer()), (arr) => {
        expect(sortAsc(arr).length).toBe(arr.length);
      }),
    );
  });

  it('output is sorted ascending', () => {
    fc.assert(
      fc.property(fc.array(fc.integer()), (arr) => {
        const result = sortAsc(arr);
        for (let i = 1; i < result.length; i++) {
          expect(result[i]).toBeGreaterThanOrEqual(result[i - 1]);
        }
      }),
    );
  });
});

describe('parseUser + serializeUser (round-trip)', () => {
  it('serialize then parse returns original', () => {
    fc.assert(
      fc.property(
        fc.record({
          id: fc.integer({ min: 1 }),
          name: fc.string({ minLength: 1, maxLength: 50 }),
          email: fc.emailAddress(),
        }),
        (user) => {
          expect(parseUser(serializeUser(user))).toEqual(user);
        },
      ),
    );
  });
});
```

### Angular / React: fast-check
Mismo tool. Aplicar sobre lógica pura de servicios/reducers, no sobre UI.

### PHP: Eris

```
composer require --dev giorgiosironi/eris
```

Test:
```php
use Eris\TestTrait;
use Eris\Generator;

class SortTest extends TestCase
{
    use TestTrait;

    public function testIsIdempotent()
    {
        $this->forAll(Generator\seq(Generator\int()))
            ->then(function ($arr) {
                $this->assertEquals(
                    sortAsc(sortAsc($arr)),
                    sortAsc($arr)
                );
            });
    }
}
```

Eris está menos mantenido que fast-check pero funciona. Alternativa: escribir property-based manual con `array_map` + assertions.

## Generators comunes (fast-check)

```ts
fc.integer()                    // int random
fc.integer({ min: 0, max: 100 })
fc.float()
fc.string()
fc.string({ minLength: 1, maxLength: 50 })
fc.emailAddress()
fc.webUrl()
fc.date()
fc.uuid()

fc.array(fc.integer())          // array de ints
fc.record({ id: fc.integer(), name: fc.string() })   // objeto

fc.oneof(fc.string(), fc.integer())   // string O int
fc.constant('fixed')            // valor fijo
fc.constantFrom('a', 'b', 'c')  // uno de los valores
```

## Cómo interpretar fallos

Cuando una propiedad falla, fast-check hace **shrinking**: reduce el input al mínimo que reproduce el bug.

Ejemplo output:
```
Property failed after 47 tests
{ seed: 123456, path: "45:2", endOnFailure: true }
Counterexample: [-2147483648]
Shrunk 12 time(s)
Got error: Expected 2147483648 but got -2147483648

Hint: enable verbose mode to check all failing values encountered during the run
```

Fast-check encontró el bug con input random, después lo redujo hasta el mínimo que rompe (`[-2147483648]` = integer overflow negativo).

Esto es **oro puro** — te da el input exacto para escribir un unit test regresión:
```ts
it('handles INT_MIN correctly', () => {
  expect(myFunction(-2147483648)).toBe(...);
});
```

## Combinando property + unit

Property-based **no reemplaza** unit tradicional. Uso complementario:

- **Unit** para casos específicos que sabés que importan (bug conocido, requerimiento explícito de negocio).
- **Property** para invariantes generales que deben cumplirse siempre.

Ejemplo real (calculadora de precios con impuestos):
```ts
describe('calculateTotal', () => {
  // Unit tradicionales
  it('handles empty cart', () => { expect(calculateTotal([])).toBe(0); });
  it('handles single item', () => { expect(calculateTotal([{price:100}])).toBe(116); });
  it('handles known regression: 3 items with discount', () => { ... });

  // Property-based
  it('total is always >= subtotal (tax is non-negative)', () => {
    fc.assert(
      fc.property(fc.array(fc.record({ price: fc.float({ min: 0 }) })), (items) => {
        const subtotal = items.reduce((s, i) => s + i.price, 0);
        expect(calculateTotal(items)).toBeGreaterThanOrEqual(subtotal);
      }),
    );
  });

  it('total is deterministic (same input → same output)', () => {
    fc.assert(
      fc.property(fc.array(fc.record({ price: fc.float({ min: 0 }) })), (items) => {
        expect(calculateTotal(items)).toBe(calculateTotal(items));
      }),
    );
  });
});
```

## Configuración

Por default fast-check corre **100 tests por propiedad**. Configurar:

```ts
fc.assert(
  fc.property(...),
  { numRuns: 1000 },              // más runs = más chances de encontrar bugs
);
```

Trade-off: más runs = tests más lentos. Default 100 es sensato. Subir a 1000+ para libs críticas.

**Seed reproducible** (para regresión):
```ts
fc.assert(
  fc.property(...),
  { seed: 1234567 },
);
```

Sin seed, cada run usa uno random. Con seed, exactamente los mismos inputs.

## Anti-patterns

- **Testear tautologías:** `fc.assert(fc.property(fc.integer(), (n) => typeof n === 'number'))`. Verificás el generator, no el código.
- **Propiedades demasiado débiles:** `expect(result).toBeDefined()` — no atrapa nada.
- **Propiedades específicas al caso:** si necesitás casos hardcoded, es unit test, no property.
- **Correr property-based sobre I/O:** 100 requests a DB para un test = suite muy lenta.
- **Ignorar shrinking output:** el counterexample es exactamente lo que necesitás para escribir regresión.

## Trigger para escribir property test

- Función pura con propiedad matemática obvia.
- Bug encontrado que sugiere que hay otros similares (invariante violada).
- Parser/serializer nuevo (round-trip test es gratis).
- Data transformation crítica (encoding, normalization).

## Referencias

- fast-check docs: https://fast-check.dev
- "Property-Based Testing with PropEr, Erlang, and Elixir" (concepto genérico).
- QuickCheck (paper original, Haskell): https://en.wikipedia.org/wiki/QuickCheck
