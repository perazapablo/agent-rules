# Pattern: Fuzzing

## Propósito

Bombardear código con inputs **malformados, random, o adversariales** buscando crashes, memory corruption, o comportamiento inesperado. Diferencia clave con property-based: fuzzing es **coverage-guided** — el fuzzer mide qué ramas del código se ejecutan y muta inputs para explorar ramas nuevas.

Ideal para: parsers, deserializers, decoders, código que toca input **no confiable** (HTTP handlers, file uploads, message queues).

## Cuándo aplica

**Buenos candidatos:**
- Parsers (JSON custom, XML, formatos binarios propietarios).
- Deserializers (protobuf, msgpack, custom).
- Handlers HTTP que reciben payloads complejos.
- Validators de input.
- Código que hace parsing manual con `substr`, regex complejos, state machines.

**Malos candidatos:**
- Lógica de negocio con inputs bien estructurados internos.
- UI (los users no bombardean).
- Código que ya tiene input validation estricta upstream (Zod, Joi, etc).

## Diferencia con property-based

| Aspecto | Property | Fuzzing |
|---|---|---|
| Inputs | Random según generators explícitos | Random + coverage-guided (busca ramas nuevas) |
| Foco | Propiedades lógicas cumplen para todo input | Crashes, hangs, memory errors |
| Runtime | Segundos | Minutos-horas (corre hasta encontrar bug o hasta timeout) |
| Setup | Muy simple | Setup del fuzzer + corpus inicial |
| Herramientas | fast-check, Hypothesis, Eris | jazzer.js, atheris, cargo-fuzz, AFL++, libFuzzer |

Usar ambos:
- Property → invariantes lógicos de funciones puras.
- Fuzzing → encontrar crashes en código que parsea input externo.

## Tool por stack

### Node/TypeScript: jazzer.js

```
npm i -D @jazzer.js/core
```

Fuzz target — función que recibe `Buffer` random y ejerce el código:
```ts
// fuzz/parseUser.fuzz.ts
import { parseUser } from '../src/user.parser';

export function fuzz(data: Buffer) {
  try {
    parseUser(data.toString('utf8'));
  } catch (e) {
    // Errors esperados (validation) — no son crash. Ignorar.
    if (e.message.startsWith('ValidationError')) return;
    throw e;   // otros errores → jazzer los reporta
  }
}
```

Correr:
```bash
npx jazzer fuzz/parseUser.fuzz.ts
```

Jazzer bombardea `data` con bytes random guiados por coverage. Cuando encuentra crash:
- Guarda el input reproducible en `.jazzer-corpus/`.
- Reporta stack trace.

Setup para CI (corre 5 min por fuzz target):
```json
"scripts": {
  "fuzz": "jazzer fuzz/parseUser.fuzz.ts --time 300"
}
```

**Corpus inicial:** empezar con archivos válidos (JSON payloads conocidos) para acelerar exploración:
```
fuzz/
  parseUser.fuzz.ts
  corpus/
    valid-user-1.json
    valid-user-with-nested.json
    edge-case-empty.json
```

Jazzer los usa como semillas.

### PHP

**Estado del arte pobre en 2026.** No hay fuzzer coverage-guided mantenido para PHP.

Alternativas:
1. **Property-based con Eris** — corre menos inputs pero encuentra clases similares de bugs.
2. **Wrap el código PHP con Node.js** — si el parser es crítico, escribirlo en Node y fuzzear con jazzer.js, después llamar via CLI/HTTP desde PHP.
3. **HTTP fuzzing external** — usar `wfuzz` o `ffuf` contra endpoints:
```bash
ffuf -u http://localhost/api/users/FUZZ -w /usr/share/wordlists/api-payloads.txt
```

### Angular / React
No aplica al frontend. Fuzzear la API/backend que consumen.

## Setup en CI

Fuzzing en CI corre por tiempo limitado (5-30 min por target). Nunca "hasta terminar" — no termina.

```yaml
name: Fuzz
on:
  schedule:
    - cron: '0 4 * * *'   # 4 AM daily
  workflow_dispatch:       # manual trigger

jobs:
  fuzz:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npx jazzer fuzz/parseUser.fuzz.ts --time 600   # 10 min
      - name: Upload corpus (findings)
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: fuzz-corpus
          path: .jazzer-corpus/
```

Cuando fuzz encuentra crash:
- Job falla → alert.
- Corpus del input crash se sube como artifact.
- Escribís unit test regresión con ese input.
- Fixeás el bug.
- Commiteás corpus para que ese input siga en el conjunto de semillas.

## Cómo interpretar findings

Jazzer output cuando encuentra crash:
```
==== Uncaught exception ====
TypeError: Cannot read properties of undefined (reading 'trim')
    at parseUser (/app/src/user.parser.ts:23:15)
    at fuzz (/app/fuzz/parseUser.fuzz.ts:4:5)

Reproducer file written to: .jazzer-corpus/crash-abc123.bin

To reproduce:
  npx jazzer fuzz/parseUser.fuzz.ts --repeat .jazzer-corpus/crash-abc123.bin
```

Pasos:
1. Reproducir con `--repeat` → confirmar crash consistente.
2. Ver el input en hex/utf8 → entender qué se rompió.
3. Escribir unit test con ese input exacto:
   ```ts
   it('handles input that caused crash abc123', () => {
     const evilInput = Buffer.from('...').toString('utf8');
     expect(() => parseUser(evilInput)).not.toThrow(TypeError);
   });
   ```
4. Fixear el parser.
5. Commit del corpus reproducer — jazzer lo usará como semilla en futuros runs.

## Corpus management

El corpus (`.jazzer-corpus/`) es el conjunto de inputs interesantes que el fuzzer descubrió.

**Commiteable:** sí, es valioso mantenerlo en el repo. Cada input representa una rama del código explorada. Nuevos runs empiezan más cerca de encontrar bugs profundos.

**Tamaño:** típicamente MB, aceptable en git. Si supera 100MB, usar `git-lfs`.

**Cleanup:** de vez en cuando podés borrar duplicados con `jazzer.js minimize` — reduce corpus manteniendo cobertura.

## Anti-patterns

- **Fuzz sin unit tests base:** fuzzing amplifica cobertura, no la crea. Sin tests base no hay cómo distinguir "cambio comportamiento esperado" de "bug real".
- **Correr fuzzing por 5 segundos:** no es tiempo suficiente para explorar. Mínimo 5 min por target.
- **No commitear el corpus:** perdés todo el trabajo del fuzzer previo.
- **Ignorar findings porque "es input malformado, nadie envía eso":** el atacante SÍ lo va a enviar. Fuzzing atrapa exactamente lo que humanos no imaginan.
- **Fuzzer contra código con `catch (e) {}` global:** el catch traga los crashes, fuzzer no ve nada. Refactor primero.

## Cuando NO fuzzear

- Todo el código de la app: fuzzear todo es imposible. Elegir targets críticos (parsers, deserializers, validators de auth).
- Código bien testeado con property + unit: probablemente ya cubierto.
- Prototipos exploratorios: fuzzing es post-madurez.

## Trigger para agregar fuzz target

- Nuevo parser custom o deserializer.
- Handler HTTP con input complejo (JSON deep-nested, XML, binary).
- Bug CVE-like encontrado en dep similar → fuzzear tu equivalente.
- Post-incident de "app crasheó con input raro" → fuzz target del código que crasheó.

## Referencias

- Jazzer.js: https://github.com/CodeIntelligenceTesting/jazzer.js
- Atheris (Python): https://github.com/google/atheris
- cargo-fuzz (Rust): https://github.com/rust-fuzz/cargo-fuzz
- OSS-Fuzz (Google, gratis para proyectos OSS): https://google.github.io/oss-fuzz/
