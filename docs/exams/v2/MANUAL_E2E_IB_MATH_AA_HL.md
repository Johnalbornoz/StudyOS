# E2E manual #1 — IB Mathematics: Analysis and Approaches HL

Estado: **listo para ejecutar. No certificado.** `IB_E2E` solo puede declararse después de esta prueba manual, la hace el equipo.

## 0. Preparación

| | |
|---|---|
| Entorno | Candidato DEV aislado de Track B. La URL y el SHA están en `EXAM_V2_DEV_READINESS_REPORT.md`; `/api/version` debe mostrar ese SHA. El alias compartido de DEV no se usa. |
| Cuenta | Student de DEV A (principal) y Student de DEV B (solo para seguridad, paso 9). |
| Idioma | Interfaz en Español. |
| Dispositivos | Escritorio + móvil (≤ 430 px) para los pasos 1, 3 y 6. |
| Punto de partida limpio (operador) | `npx tsx --env-file=.env.local scripts/operations/track-b-v2-reset-student.ts --email <A> --write`: borra solo los exámenes de A sobre contenido de prueba. No borra evidencia ni contenido. |

**Versión del currículo.** «Mathematics: analysis and approaches guide», con primera evaluación en 2021 y última en noviembre de 2028. Las fuentes son la guía y el subject brief de la IBO, y la página «Maths in the DP».

**Estructura oficial que debe verse:**

| Prueba | Tiempo | Puntos | Peso | Calculadora | Secciones |
|---|---|---|---|---|---|
| Paper 1 | 120 min | 110 | 30 % | sin calculadora | A respuesta corta · B respuesta extendida |
| Paper 2 | 120 min | 110 | 30 % | calculadora gráfica | A · B |
| Paper 3 | 60 min | 55 | 20 % | calculadora gráfica | 2 problemas extendidos |

El IA (exploración, 20 puntos, 20 %) se muestra como trabajo de curso y no se simula.

**Formato DEV.** El banco de prueba cubre una parte de cada paper:

| Prueba | Posiciones | Tiempo |
|---|---|---|
| P1 | 5 | 30 min |
| P2 | 4 | 16 min |
| P3 | 1 investigación | 10 min |

El tiempo es proporcional al ritmo oficial (≈ 1,09 min por punto). La tarjeta debe decir «Formato reducido…» con el porcentaje de cobertura.

## 1. Selección (desktop + móvil)

1. Exam Prep → **Explorar exámenes**.
2. IB → **Programa del Diploma del IB** → **Grupo 5: Matemáticas** → **Matemáticas: Análisis y Enfoques** → **Nivel Superior (NS)**.

**Verificar:**

- Los grupos 1–4 aparecen como «Aún no disponible». El grupo 6 sí está disponible (Artes Visuales).
- «Nivel Medio (NM)» aparece, pero no se puede elegir. «Aplicaciones e Interpretación» está deshabilitada.
- En la asignatura aparecen «Primera evaluación 2021 · Última evaluación 2028».
- En NS aparecen Paper 1, Paper 2 y Paper 3, cada uno con «120 min · 110 puntos · 30 % de la nota · sin calculadora» (o sus equivalentes para P2 y P3).
- No aparecen IDs, enums ni JSON.

## 2. Práctica — Paper 1

1. Marcar solo **Paper 1**, modo **Práctica**, nivel **Automático**, sin cronómetro → **Crear examen**.
2. La tarjeta muestra «Nivel: Estándar», «Formato reducido…» y «Práctica generada por StudyUS, alineada al formato de IB…».
3. **Empezar.** Se ve «Sin calculadora» y la retroalimentación aparece tras cada respuesta.

**Respuestas para verificar la calificación** (se escriben con el editor matemático; no hace falta LaTeX):

| Ítem (enunciado) | Correcta / equivalente → puntos completos | Parcial / esperado |
|---|---|---|
| `log₂(x) + log₂(x − 2) = 3` | `4`; con procedimiento `x(x−2)=8` → 5/5 | `−2` con procedimiento `x(x−2)=8` o `x²−2x−8=0` → 2/5 (solo método); `−2` sin procedimiento → 0 |
| Suma infinita `18 + 12 + 8 + …` | `54` | procedimiento `18/(1−2/3)` con respuesta errónea → 1/3 |
| `f(x)=(2x+1)/(x−3)`: (a) asíntota vertical, (b) horizontal, (c) `f⁻¹` | (a) `x=3`, (b) `y=2`, (c) `(3x+1)/(x−2)` o cualquier forma equivalente | (c) error con procedimiento `x(y−3)=2y+1` → punto de método |
| `g(x)=x²−6x+5`: (a) factorizar, (b) `g(x)<0` | (a) `(x−1)(x−5)` o `(x−5)(x−1)`; (b) `(1,5)` o `1<x<5` | (a) `x²−6x+5` → mitad (forma no factorizada); (b) `1≤x<5` → incorrecto |
| `f′(x)` para `x³e^{2x}` | `3x²e^{2x}+2x³e^{2x}` o `x²e^{2x}(3+2x)` | `3x²e^{2x}` → 0 |
| `∫₀² (3x²−2x)dx` | `4` | — |
| Pendiente de `y=ln(x²+1)` en `x=1` | `1` o `2/2` | — |
| `f(x)=xe^{−x}` (extendida, 4 partes) | (a) `e^{−x}(1−x)`; (b) `x=1`; (c) `(x−2)e^{−x}`; (d) `x=2` | cada parte puntúa por separado |
| Geométrica `u₁=3, r=2` | (a) `384`; (b) `765`; (c) `10` | (c) forma no entera → parcial |

Al terminar, **Entregar** → resultados.

## 3. Simulacro oficial — Paper 1 + Paper 2 + Paper 3

1. Volver a NS, marcar **Paper 1, Paper 2 y Paper 3**, modo **Simulacro oficial** → **Crear examen**.
2. La tarjeta dice «El examen quedó fijado…». **Empezar.**

**Verificar durante el intento:**

- **Integridad:**
  - Sin retroalimentación por pregunta: solo «Respuesta registrada».
  - Sin pistas.
  - El Tutor está bloqueado mientras dure el intento (abrir el Tutor en otra pestaña lo muestra restringido).
  - Recargar la página muestra la **misma** pregunta, con el borrador guardado.
- **Tiempo:**
  - Reloj por sección: 30 min, luego pausa de 10 min, luego 16 min, luego pausa de 10 min, luego 10 min.
  - Al llegar a 0, la sección se cierra sola y las respuestas en borrador se envían.
- **Navegación libre dentro de cada paper:**
  - Se puede saltar entre preguntas abiertas.
  - Una respuesta enviada es final.
- **Paper 1:** «Sin calculadora».
- **Paper 2 y Paper 3:** «Calculadora gráfica».
- **Paper 2 — cifras significativas y unidades:**

| Ítem | Puntos completos | Parcial / esperado |
|---|---|---|
| Normal `P(X>168)`, `μ=150`, `σ=12` | `0,0668` | `0,067` (2 c.s.) → 1/2 |
| Binomial `P(X=3)`, `n=10`, `p=0,3` | `0,267` | `0,27` → 1/2 |
| Media `12, 15, 9, 20, k` = 14 | `14` | — |
| Lado AB (regla del coseno) | `5,79 cm` o `57,9 mm` | `5,79` sin unidad → mitad; `5,786 cm` (4 c.s.) → mitad |
| `5 sen x = 3` en `[0, π]` | (a) `0,644`; (b) `2,50` | — |
| Té que se enfría `T(t)` | (a) `80`; (b) `56,4`; (c) `35,8`, con procedimiento `60e^{−0,05t}=10` | — |
| Bolsa 5R 3A | (a) `5/14`; (b) `15/28`; (c) «No son independientes» | `10/28` → parcial |

- **Paper 3:** una investigación.
  - Sumas de potencias: `Cₙ = (n(n+1)/2)²`, o una forma equivalente como `n²(n+1)²/4`.
  - O la escalera: (a) `4 m`; (b) `−0,3 m/s`; (c) `0,927`.
- **Cierre:** **Entregar** cuando termine el último paper, o usar «Entregar» antes con la confirmación.

## 4. Resultados

**Verificar:**

- **Nota:** «Nota del examen» en porcentaje, con la aclaración de que no es una nota IB oficial (1–7 no configurado).
- **Puntos:** «obtenidos de disponibles», por Paper 1, 2 y 3.
- **Preparación estricta (StudyUS):** en un bloque aparte. Es menor o igual que la nota si hubo parciales o puntos solo de método.
- **Fortalezas y brechas:** por objetivo (álgebra, funciones, cálculo, estadística, trigonometría, extendidas, investigación).
- **Qué reforzar ahora:**
  - Texto «Necesitas reforzar: ⟨objetivo⟩. Fallaste n de m preguntas.»
  - Los objetivos de este banco aún no están vinculados a conceptos, así que se espera **Añadir a mi plan**. Al pulsarlo pasa a «Solicitado…» y no se crea ningún concepto automáticamente.
  - Si un objetivo sí está vinculado a un concepto del Student, aparece **Reforzar ahora**, que abre el concepto en el Learning Engine.
- **Revisión por pregunta:** tu respuesta, la respuesta correcta y la explicación. Las expresiones matemáticas se muestran como fueron escritas.

## 5. Desafío — Paper 1

1. Crear un examen nuevo: Paper 1, modo **Desafío**.
2. La tarjeta dice «Más exigente que el formato estándar». Hoy debe además indicar que el banco no alcanza del todo la dificultad objetivo (`CHALLENGE_MODE = PARTIAL`).
3. Reglas iguales a las del simulacro.

## 6. Eliminar y nuevo intento desde cero

1. **Simulacro en curso:**
   1. Empezar uno y responder una pregunta.
   2. En «Exámenes» pulsar **Eliminar**. Aparece el aviso «Esta prueba está en curso. Si la eliminas perderás este intento.»
   3. Confirmar.
   4. Abrir la URL del intento: devuelve «no encontrado» y no se puede reanudar.
2. **Crear nuevo simulacro.** Debe tener:
   - una instancia nueva;
   - preguntas preferentemente distintas;
   - ningún borrador;
   - posición en la pregunta 1;
   - reloj completo;
   - ninguna nota previa.
3. **Simulacro terminado (el del paso 3):**
   1. **Eliminar.** El aviso dice que el resultado y el aprendizaje se conservan.
   2. Confirmar.
   3. Verificar que desaparece de «Exámenes», del historial de Exam Prep y de la URL de resultados («no encontrado»).
   4. **Comprobación del operador:** el resultado sigue `SCORED` en la base y la evidencia de aprendizaje del intento no cambia (ver §8).
4. **Repetir con preguntas nuevas** desde un examen terminado crea otro examen desde cero.

## 7. Práctica adaptativa

Tras una práctica con ≥ 80 %, la siguiente práctica (nivel Automático) debe crearse en «Avanzado». Tras una práctica con < 50 %, en «Base».

## 8. Comprobaciones del operador (solo lectura, DEV)

```sql
-- Instancia eliminada; resultado y respuestas intactos:
SELECT i.status, i.deleted_at, r.status AS result_status, r.raw_score, r.max_score
  FROM exam_instances i JOIN simulation_attempts s ON s.id = i.simulation_attempt_id
  JOIN exam_attempt_results r ON r.exam_attempt_id = s.exam_attempt_id
 WHERE i.id = '<instance>';
-- Evidencia del intento (debe ser la misma antes y después de eliminar):
SELECT count(*) FROM learning_evidence
 WHERE metadata->'context'->>'examAttemptId' = '<exam_attempt_id>';
-- Calificación auditable:
SELECT target_index, scoring_strategy, score, max_score, strict_score, normalized_response, grading_detail
  FROM exam_attempt_item_responses WHERE exam_attempt_id = '<exam_attempt_id>' ORDER BY target_index;
```

## 9. Seguridad (Student B)

Con la sesión de B, abrir las URLs de A:

- `/dashboard/exam-prep/attempt/<intento A>` → «no encontrado»;
- `/dashboard/exam-prep/attempt/<intento A>/result` → «no encontrado».

Llamar a `DELETE /api/exams/instances/<instancia A>` → 404. La instancia de A queda intacta.

## 10. Criterios para declarar `IB_E2E = PASS` (los decide el equipo)

- Pasos 1–9 cumplidos en escritorio y en móvil.
- Ninguna respuesta equivalente calificada como incorrecta. Ningún texto técnico visible.
- Tiempos, calculadora y estructura según la tabla oficial.
- Eliminar e iniciar desde cero sin estado residual. El resultado y la evidencia se conservan al eliminar un examen terminado.

## Evidencia a capturar

Capturas de:

- la ruta de selección (y NM no disponible);
- la configuración;
- P1 sin calculadora y P2 con calculadora gráfica;
- una respuesta con procedimiento;
- el cierre por tiempo;
- la pausa entre papers;
- los resultados (nota, Preparación estricta, brechas, «Qué reforzar ahora»);
- el aviso de eliminar en curso;
- el nuevo intento;
- la vista móvil.

Además, la salida de las consultas del §8.
