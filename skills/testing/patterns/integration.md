# Pattern: Integration tests

## Propósito

Validar contratos reales entre capas: controller ↔ service ↔ DB, service ↔ API externa, código ↔ filesystem. Con **infraestructura real**, no mocks.

El bug que integration atrapa y unit no: SQL específico del engine (MySQL vs SQLite), transacciones anidadas, constraint violations, migrations rotas, timeouts, race conditions.

## Regla dura

**Nunca mockear la DB.** Ni SQLite en memoria para "simular MySQL", ni fixtures ORM, ni `TestingModule` con repo fake. Solo MySQL real via testcontainers (o servicio real en CI).

Si no hay Docker disponible → esto no es integration, es unit disfrazado. Nombrar bien y no pretender.

## Setup por stack

### Node/TypeScript

```
npm i -D vitest supertest @testcontainers/mysql
```

Estructura:
```
src/
  users/
    users.controller.ts
    users.service.ts
    users.integration.test.ts   ← side-by-side
```

Config mínimo `vitest.config.ts`:
```ts
export default {
  test: {
    include: ['**/*.integration.test.ts'],
    testTimeout: 30_000,  // testcontainers arranca lento
    hookTimeout: 60_000,
    pool: 'forks',        // 1 container por worker
    maxWorkers: 4,
  },
};
```

Test típico:
```ts
import { MySqlContainer } from '@testcontainers/mysql';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';

// OJO: acá NO se importa nada de la app.
// Si el módulo que se importa crea el pool en su cuerpo —directa o
// transitivamente— ese pool nace con el .env REAL, porque los imports del tope
// se evalúan antes que beforeAll. El await import() de abajo devolvería ese
// mismo pool desde la caché de Node, y el test terminaría escribiendo (y
// borrando) la base de verdad. Pasó: ver la regla dura en ../SKILL.md.

describe('POST /users', () => {
  let container: StartedMySqlContainer;
  let app: TestApp;

  beforeAll(async () => {
    container = await new MySqlContainer('mysql:8.0').start();
    process.env.DATABASE_URL = container.getConnectionUri();

    // Recién ahora, con el entorno apuntando al container:
    const { runMigrations } = await import('../db/migrate');
    const { createTestApp } = await import('../test-support/app');
    await runMigrations();
    app = await createTestApp();
  }, 60_000);

  afterAll(async () => {
    await container.stop();
  });

  it('creates a user and persists it', async () => {
    const res = await request(app.server).post('/users').send({ email: 'a@b.com' });
    expect(res.status).toBe(201);

    const [row] = await app.db.query('SELECT * FROM users WHERE email = ?', ['a@b.com']);
    expect(row).toMatchObject({ email: 'a@b.com' });
  });
});
```

**Comando en `package.json`:**
```json
"scripts": {
  "test:integration": "vitest run --config vitest.integration.config.ts"
}
```

Separado de `test` (unit) — integration es lento, no querés correrlo en watch mode.

### PHP

```
composer require --dev phpunit/phpunit testcontainers/testcontainers-php
```

Estructura:
```
src/Users/UserService.php
tests/
  Unit/UserServiceTest.php
  Integration/UserServiceIntegrationTest.php
```

Config `phpunit.xml`:
```xml
<testsuites>
  <testsuite name="unit">
    <directory>tests/Unit</directory>
  </testsuite>
  <testsuite name="integration">
    <directory>tests/Integration</directory>
  </testsuite>
</testsuites>
```

Test típico:
```php
class UserServiceIntegrationTest extends TestCase
{
    private static MySqlContainer $container;
    private PDO $pdo;

    public static function setUpBeforeClass(): void {
        self::$container = (new MySqlContainer('mysql:8.0'))->start();
        $_ENV['DATABASE_URL'] = self::$container->getConnectionUri();
        (new MigrationRunner())->run();
    }

    public static function tearDownAfterClass(): void {
        self::$container->stop();
    }

    public function testCreatesUserAndPersists(): void {
        $service = new UserService($this->pdo);
        $service->create('a@b.com');

        $row = $this->pdo->query("SELECT * FROM users WHERE email = 'a@b.com'")->fetch();
        $this->assertNotFalse($row);
    }
}
```

**Comando en `composer.json`:**
```json
"scripts": {
  "test:integration": "phpunit --testsuite=integration"
}
```

## Qué SÍ testear

- Todo endpoint HTTP con lógica no trivial → 1 test happy path + 1-2 edge cases (auth fallida, validación, conflict).
- Toda mutación de DB con transacción o constraint no trivial (foreign keys, unique compuesto, cascada).
- Toda integración con API externa → mockear la API con MSW (Node) o wiremock (PHP), DB sigue real.
- Migrations críticas → un test que corre la migration y valida schema resultante.

## Qué NO testear acá

- Lógica pura sin I/O → **unit test**.
- UI, clics, formularios → **E2E**.
- Validaciones de input triviales (regex de email, required) → **unit test del validador**.
- CRUD trivial sin lógica → escepticismo. Si un endpoint es literalmente `db.insert(req.body)`, el test aporta poco valor (testeás el ORM, no tu código).

## Test data

- **Explícito en el test.** `create({ email: 'a@b.com', role: 'admin' })`. No factories mágicas que ocultan qué se prueba.
- Factory helpers OK cuando hay 10+ campos y solo 1-2 relevantes: `userFactory({ role: 'admin' })` con defaults sensatos. Documentar defaults.
- Nunca datos de producción. Nunca `.env` real. Nunca credenciales reales.
- Seed común: si múltiples tests necesitan la misma base, usar `beforeEach` limpio (TRUNCATE + insert) — no fixtures compartidos entre suites.

## Aislamiento

- 1 container MySQL **por worker**, no por test (arranca 5s). Vitest `pool: 'forks'` + `maxWorkers: 4` = 4 containers en paralelo.
- Entre tests: `TRUNCATE` de tablas tocadas o `BEGIN`/`ROLLBACK` por test. Nunca compartir state entre tests.
- Nunca depender de orden de tests. Si un test asume que otro corrió antes → mal escrito.

## CI

- Docker-in-Docker en runner. GitHub Actions: usar `runs-on: ubuntu-latest` (Docker viene instalado).
- Cachear la imagen MySQL entre runs (`docker pull mysql:8.0` en step separado con cache).
- Jobs separados: `unit` (rápido, corre siempre), `integration` (más lento, corre en PR + main).
- Bloquear merge si integration falla.

## Timeouts realistas

- Startup de container: 30-60s primera vez, 5-15s cacheado.
- Suite de 50 integration tests: apuntar a <2min total. Si excede → paralelizar o revisar test data (seeds gigantes son el culpable típico).

## Anti-patterns específicos de integration

- **Import estático que arrastra el pool.** El más caro de todos, porque no
  falla: conecta. Ver la regla dura en [`../SKILL.md`](../SKILL.md). El gate
  `test-db-gate.cjs` bloquea el runner si el `.env` apunta a un host no local,
  pero no puede ver el orden de imports — eso queda en el código del test.
- **Limpieza defensiva antes del schema** (`DROP TABLE` de todas las tablas "por
  si quedó algo"). Contra un container nuevo no hay nada que limpiar; contra
  cualquier otra cosa, es el borrado. El que sobra es el DROP, no el container.
- **Verificar el destino leyendo `process.env`** en vez de la conexión ya
  construida. La variable pudo cambiar después de que el pool nació — que es
  justo lo que pasa cuando hay un import fuera de orden.
- **In-memory DB fake** ("H2 modo MySQL", `sqlite::memory:` "modo MySQL compat"): no existe compatibilidad real. Es una mentira que rompe en prod.
- **DB compartida entre tests sin TRUNCATE**: tests que pasan solos y fallan juntos.
- **Assertions solo por HTTP status**: `expect(res.status).toBe(200)` sin verificar que la DB tenga el estado esperado. La mitad del test.
- **Mock del ORM pero DB real**: no tiene sentido. O va todo real, o el mock oculta el propósito.
- **Cleanup en `afterAll` en vez de `afterEach`**: si un test rompe a la mitad, el siguiente arranca sucio.
