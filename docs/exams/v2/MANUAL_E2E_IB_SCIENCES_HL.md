# E2E manual: IB Physics HL e IB Chemistry HL (currículo de ciencias 2025)

Estado: **listo para ejecutar, sin certificar.** `IB_PHYSICS_E2E` e `IB_CHEMISTRY_E2E` solo se declaran después de esta prueba manual, y la hace el equipo.

## 0. Preparación

Igual que en `MANUAL_E2E_IB_MATH_AA_HL.md` §0: candidato DEV aislado (el SHA debe coincidir con `/api/version`), Students A y B, interfaz en Español, escritorio y móvil, y reset de A antes de empezar.

**Versión del currículo.** Guías de Physics y Chemistry con primera evaluación en 2025. Las fuentes registradas son la guía de cada asignatura y el subject brief de la IBO.

**Estructura oficial que debe verse (NS):**

| Prueba | Physics NS | Chemistry NS | Notas |
|---|---|---|---|
| Paper 1 (1A + 1B, una sola sesión) | 120 min · 60 puntos · 36 % | 120 min · 75 puntos · 36 % | El reparto de tiempo entre 1A y 1B **no se publica**; la interfaz lo dice. |
| Paper 1A (opción múltiple) | 40 puntos | 40 puntos | Sin penalización. |
| Paper 1B (preguntas basadas en datos) | 20 puntos | 35 puntos | — |
| Paper 2 | 150 min · 90 puntos · 44 % | 150 min · 90 puntos · 44 % | Respuesta corta y extendida. |
| Evaluación interna | 20 % (24 puntos) | 20 % (24 puntos) | Trabajo de curso; no se simula. |

**No hay Paper 3** en ciencias 2025. Que aparezca un Paper 3 es un defecto **P0**. En los dos exámenes se permite calculadora y se usa el cuadernillo de datos (*data booklet*).

**Formato DEV reducido:**

| Asignatura | Paper 1A | Paper 1B | Paper 2 |
|---|---|---|---|
| Physics NS | 6 posiciones · 12 min | 2 posiciones · 18 min | 3 posiciones · 32 min |
| Chemistry NS | 7 posiciones · 11 min | 2 posiciones · 14 min | 3 posiciones · 25 min |

El tiempo sigue el ritmo oficial por punto. Hay una pausa de 10 min entre Paper 1 y Paper 2.

## 1. Selección

1. Exam Prep → **Explorar exámenes** → IB → **Programa del Diploma del IB** → **Grupo 4: Ciencias**.
2. **Verificar:**
   - Physics, Chemistry y Biology muestran «Simulacro disponible».
   - Computer science, Sports exercise and health science y Design technology muestran «Próximamente», con su estructura oficial visible.
   - Design technology indica primera evaluación 2027.
3. Physics → **Nivel Superior (NS)** y **Nivel Medio (NM)**: los dos se pueden elegir. NM muestra Paper 2 con 90 min / 50 puntos.
4. Los nombres de las asignaturas aparecen con el nombre oficial en inglés (ver P2 en el informe). No aparecen IDs, enums ni JSON.

## 2. Simulacro de Physics NS (Paper 1A + 1B + 2)

1. Marcar los tres papers, modo **Simulacro** → **Crear examen**. La tarjeta dice «Simulacro de formato reducido» y muestra el % de cobertura.
2. **Empezar.** No hay retroalimentación, tutor ni pistas. Antes de Paper 2 hay una pausa.
3. **Respuestas para verificar la calificación:**

| Pregunta | Correcta / equivalente | Parcial / incorrecta esperada |
|---|---|---|
| 1B péndulo (a): g a partir de la pendiente 4,02, con unidad, 3 c.s. | `9.82 m/s^2`, `9.82 m s^-2`; con procedimiento `g=4π²/4.02` → 2/2 | `9.82` sin unidad → parcial; `9.8205 m/s^2` → parcial por cifras significativas; `9.8203 m/s^2` → incorrecta (no es un redondeo del valor) |
| 1B péndulo (b): % de incertidumbre en T = 2,01 s | `1` | — |
| 1B calentador (a): c, 3 c.s. | `4290`; procedimiento `50*60/(0.5*1.4)` → marca de método | `4285.7` → parcial (c.s.) |
| 1B Ohm (a): R | `5` | — |
| 2 choque (a): momento total, con unidad | `6 kg m s^-1`, `6 kg*m/s` | `6` sin unidad → parcial |
| 2 choque (b): rapidez después, con unidad | `2 m/s` | `2 km/h` → incorrecta (unidad) |
| 2 choque (c): energía cinética perdida | `3`; procedimiento `0.5*2*3^2=9` → marca de método | `9` → solo método |
| 2 proyectil: altura máxima / tiempo de vuelo / alcance | `5.10` / `2.04` / `35.3` | `5.1` → parcial (c.s.) |
| 2 circuito: I con unidad / V terminal / P | `2 A` / `11` / `22` | `2000 mA` → correcta (conversión) |
| 2 desintegración: actividad tras 15 días / λ | `100` / `0.139` | — |

4. **Entregar.** En el resultado verificar:
   - «Preparación estimada StudyUS» (no una nota IB 1–7).
   - Resultados por paper (1A, 1B, 2) y por tema (A–E).
   - En la revisión: las marcas de método («M»), el estado de la unidad y de las cifras significativas en las partes de cálculo, y las fórmulas renderizadas.

## 3. Simulacro de Chemistry NS (Paper 1A + 1B + 2)

Mismo flujo. **Respuestas para verificar la calificación:**

| Pregunta | Correcta / equivalente | Parcial / incorrecta esperada |
|---|---|---|
| 1B titulación (a): media de titulación, 2 decimales | `20.00` | `20` → parcial (forma) |
| 1B titulación (b): [NaOH] con unidad, 3 c.s. | `0.0800 mol dm^-3`, `0.0800 mol/dm^3`; procedimiento `0.1*0.02` → método | `0.08` → parcial (c.s.) |
| 1B calorimetría (a): calor en kJ, con unidad, 3 c.s. | `2.51 kJ`, `2510 J` (conversión) | `3000 J` → parcial; `2.508 kJ` → parcial (c.s.) |
| 1B velocidad (solo NS): órdenes y k | `1`, `2`, `2` | — |
| 2 combustión: coeficientes O₂ / CO₂ / H₂O | `5` / `3` / `4` (cada coeficiente es una parte) | `4` en O₂ → pierde solo esa marca |
| 2 combustión (d): masa de CO₂ con unidad | `13.2 g` | `13.2` sin unidad → parcial |
| 2 gas: n, 3 c.s. | `0.0201` | — |
| 2 Kc | `4` | — |
| 2 redox (a): estado de oxidación de Cr | `6`, `+6` | — |
| 2 redox (b): pH de NaOH 1,0 × 10⁻³ | `11` | `3` → incorrecta; procedimiento `14-3` → método |

Verificar también:

- La pregunta de velocidad de reacción **no** aparece en Chemistry NM: es de material exclusivo de NS.
- En la revisión se ven las mismas marcas de unidad y de cifras significativas que en Physics.

## 4. Puente al aprendizaje

Fallar a propósito el bloque de momento (Physics) y el de estequiometría (Chemistry). En el resultado debe aparecer **Reforzar ahora**, con «Conservation of momentum» y «Stoichiometric relationships». Son conceptos del catálogo curado de DEV, marcados DEV_FIXTURE.

1. Pulsar **Reforzar ahora**: se abre la ficha del concepto.
2. Al volver, la fila dice **Reforzar** y no se duplica.

## 5. Desafío, eliminar y seguridad

1. **Desafío:** la tarjeta lo etiqueta, pero **no** se presenta como más difícil que el examen real (`CHALLENGE_MODE = PARTIAL`).
2. **Eliminar el simulacro completado:** pide confirmación y lo oculta del historial. La evidencia consolidada se mantiene; el operador lo comprueba igual que en el paquete de PAA §9.
3. **Nuevo intento:** el formulario se congela de nuevo desde cero.
4. **Student B:** recibe 404 en los intentos y resultados de A.

## 6. Criterios para declarar `IB_PHYSICS_E2E` / `IB_CHEMISTRY_E2E = PASS` (los decide el equipo)

- Se cumplen los §1–5 sin P0/P1.
- No aparece ningún Paper 3.
- Las unidades, las cifras significativas y las marcas de método se califican como indica la tabla.
- La interfaz no muestra una nota IB 1–7 ni promete equivalencia con un examinador oficial.

## Evidencia a capturar

- Selección (Grupo 4).
- Bloque «Antes de empezar».
- Una parte 1B con su estímulo de datos, en escritorio y en móvil.
- Resultados por paper.
- Una revisión con marca de método y estado de unidad.
- Reforzar ahora.
- SHA.
