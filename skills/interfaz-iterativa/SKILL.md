---
name: interfaz-iterativa
description: Cómo se construye una pantalla con Pablo — iterando sobre lo que ya se ve, mostrando información real y sólo la necesaria.
trigger: al diseñar, construir o modificar cualquier pantalla que use una persona
agents: [claude, codex, opencode]
enforced_by: []
depends_on: [behavior-core]
---

## Propósito

Una pantalla no se entrega, se converge. Se muestra pronto, se corrige con Pablo
mirándola correr, y en cada vuelta se saca lo que sobra. El criterio que decide
qué queda no es "qué datos tengo" sino "qué necesita ver para decidir".

## Reglas

### El ciclo

1. Versión corta y funcionando antes que diseño completo en abstracto. Pablo
   corrige mirando la pantalla, no leyendo una propuesta.
2. Cambio pedido → aplicarlo → mostrar → esperar la siguiente corrección. Una
   vuelta a la vez; no adelantarse tres pasos.
3. Cuando Pablo manda una captura anotada, esas anotaciones son la lista de
   trabajo completa de esa vuelta. Se aplican todas y no se agrega nada más.
4. Antes de construir sobre un dato, medirlo contra la base. Varias veces la
   medición desmintió lo que parecía obvio: la deuda que se veía en 0 porque
   `montoPagado` era NULL, los meses que "faltaban" por un desborde de fecha.

### Qué se muestra

1. **Si hay que explicar la pantalla en el chat, la pantalla está mal.** Se
   arregla la pantalla, no se agrega un texto de ayuda. Un párrafo explicativo no
   salva una columna que no se entiende.
2. Nada de vocabulario interno en la interfaz. Palabras como "tanda",
   "pendientes", "vigencia", "nivel", "tramo" no significan nada para quien la
   usa. Si el dato importa, se dice en las palabras del negocio.
3. Concreto antes que agregado: "julio y agosto 2026", no "2 meses desde julio".
   "Sin cobro desde octubre", no "hace 34 días".
4. Un dato que ya se ve en el encabezado no se repite en el detalle.
5. Encabezado con lo mínimo para decidir si hay que actuar; todo lo demás, en el
   detalle desplegable.
6. Cada número visible tiene que poder explicarse solo. Si un renglón está
   primero en la lista, algo en ese renglón tiene que decir por qué.
7. Los conteos que se muestran arriba miden lo mismo que la lista de abajo. Un
   "Todos (1)" sobre una lista vacía es un error, no un detalle.

### Quitar es avanzar

1. Ante la duda, se quita. En este proyecto se eliminaron tarjetas de resumen,
   columnas, un filtro entero y campos duplicados — cada vez quedó mejor.
2. Un filtro que casi nunca se cambia es ruido: o se va, o queda encendido y
   visible como tal.
3. No agregar una acción "por si sirve". Las acciones que escriben o mueven
   dinero se definen con Pablo antes de existir.

### Estilo

1. Estandarizar con los módulos que ya existen (encabezados, colores, formas)
   antes que inventar un lenguaje visual nuevo por pantalla.
2. Las animaciones confirman que el sistema respondió y ayudan a leer; nunca
   llaman la atención sobre sí mismas. Respetar `prefers-reduced-motion`.

## Por qué

- Pablo detecta en dos segundos, mirando la pantalla, lo que no se ve en una
  descripción. Iterar sobre algo que corre cuesta menos que discutir un diseño.
- La sobrecarga no es un problema estético: una columna que el usuario no
  entiende lo hace preguntar, y esa pregunta cuesta más que el dato que aportaba.
- El vocabulario interno se filtra solo si nadie lo vigila: quien escribe el
  código ya sabe qué es una "tanda" y no nota que nadie más lo sabe.

## Referencias

- Comportamiento base y tono: `behavior-core`.
- Medir contra la base antes de afirmar: consultas de lectura con `node -e` +
  mysql2, sin escribir scripts al repo.
