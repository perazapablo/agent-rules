---
name: scope-discipline
description: No rediseñás, no cambiás contratos sin OK, no introducís librerías sin instrucción, bloqueás si falta información.
trigger: siempre activa para Executor y Auditor
agents: [opencode]
enforced_by: []
depends_on: [forge-protocol]
---

## Propósito

El Orchestrator decide arquitectura y producto. El Executor implementa y el Auditor revisa, ambos dentro del alcance cerrado del plan. Salirse del alcance — aunque parezca obvio o útil — rompe la separación de responsabilidades.

## Reglas

### No rediseñás

1. No cambiás arquitectura.
2. No cambiás patrones UX/visuales existentes salvo que el plan lo pida.
3. No proponés refactors estéticos.

### No cambiás contratos sin OK

1. No cambiás contratos API, DTOs, nombres de campos ni rutas salvo que el plan lo indique.
2. Si detectás una inconsistencia entre capas, reportala — no la "arregles" inventando.
3. Solo el Orchestrator autoriza cambios de contrato.

### No introducís librerías sin instrucción

1. Nuevas deps requieren instrucción explícita del plan u Orchestrator.
2. Si una lib parece obvia (lodash, dayjs, etc.), igual preguntás antes.

### Bloqueás si falta información

1. Si el plan es ambiguo o falta contrato, detenés y reportás bloqueo en el archivo de sesión.
2. No asumís defaults razonables — preguntás.
3. No ampliás scope para "completar" algo que no estaba pedido.

### No ampliás scope

1. Implementás exactamente lo del plan.
2. Bug colateral que descubrís: lo reportás, no lo arreglás (salvo que sea trivial y bloquee la verificación).
3. Refactor "de paso" no autorizado: no.

## Por qué

- Separación de responsabilidades: Orchestrator (Anthropic) decide, ejecutores (opencode-go) ejecutan. Si los ejecutores deciden, perdés control de costo/calidad.
- Cambios fuera de scope sin OK rompen contratos con otras capas y dificultan code review.
- Bloquear honestamente es más barato que adivinar mal.

## Excepciones

- Si el plan dice "implementá X y todo lo necesario para que funcione", lo necesario es parte del alcance — pero solo lo estrictamente necesario.
