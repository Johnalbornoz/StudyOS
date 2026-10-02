# E2E manual — PAA (Prueba de Aptitud Académica, College Board)

Estado: **listo para ejecutar. No certificado.** `PAA_E2E` solo se declara cuando esta prueba manual termina, y la hace el equipo.

## 0. Preparación

| | |
|---|---|
| Entorno | Candidato DEV aislado de Track B. La URL y el SHA están en `EXAM_V2_DEV_READINESS_REPORT.md`; `/api/version` debe mostrar ese SHA. No se usa el alias compartido de DEV. |
| Cuentas | Student de DEV A (principal) y Student de DEV B (solo para seguridad, paso 8). |
| Idioma | Interfaz en Español. |
| Dispositivos | Escritorio y móvil (≤ 430 px) para los pasos 1, 2 y 5. |
| Punto de partida limpio (operador) | `npx tsx --env-file=.env.local scripts/operations/track-b-v2-reset-student.ts --email <A> --write`. Borra solo los exámenes de A sobre contenido de prueba. |

**Versión.** PAA revisada, según la *Guía de la Prueba de Aptitud Académica* (College Board, 2021). Las fuentes registradas son `cb-paa-guia-2021`, `cb-paa-practice-test-2018`, `cb-paa-manual-latam-2024` y `cb-paa-usage-2024`.

**Estructura oficial que debe verse** (en orden oficial):

| Área | Preguntas | Tiempo | Calculadora |
|---|---|---|---|
| Lectura | 45 | 50 min | — |
| Redacción | 25 | 30 min | — |
| Matemáticas | 55 | 60 min | no |
| Inglés | 50 | 40 min | — |

**Formato DEV reducido** (banco de práctica de StudyUS, no oficial):

| Área | Posiciones | Tiempo | Notas |
|---|---|---|---|
| Lectura | 10 | 11 min | Textos con varias preguntas, incluido el par inferencia → evidencia. |
| Redacción | 6 | 7 min | — |
| Matemáticas | 12 | 13 min | Incluye respuestas producidas (SPR). |
| Inglés | 8 | 6 min | — |

Hay dos pausas de 10 min: tras Redacción y tras Matemáticas. Las preguntas de investigación (no puntuadas) no se simulan, porque la guía no publica dónde van.

## 1. Selección (escritorio y móvil)

1. Exam Prep → **Explorar exámenes** → **PAA (Prueba de Aptitud Académica)**.
2. **Verificar:** el primer nivel muestra solo **Simulacro completo** y **Practicar un área**, y los dos llevan insignia de disponible.
3. Abrir **Practicar un área** y verificar:
   - Aparecen Lectura, Redacción, Matemáticas e Inglés, con la insignia «Práctica disponible».
   - Ninguna área ofrece Simulacro ni Desafío.
4. Abrir **Lectura** y verificar que aparece «O practica una habilidad concreta:». Debajo están:
   - Vocabulario en contexto
   - Ideas explícitas
   - Inferencias y evidencias
   - Información cuantitativa o gráfica
   - Análisis literario
5. Verificar que ya **no existe** la ruta antigua «PAA → Matemáticas» como examen independiente.
6. Verificar que no aparecen IDs, enums ni JSON.

## 2. Simulacro completo

1. Abrir **Simulacro completo**. En los modos aparecen solo **Simulacro** y **Desafío**, sin Práctica. Las cuatro áreas vienen marcadas y no se pueden desmarcar: «Prueba completa: incluye todas las áreas en el orden oficial.».
2. Verificar el bloque **Antes de empezar**:
   - Por área: «50 min oficiales · 11 min en este formato reducido» (y equivalentes).
   - En Matemáticas: «sin calculadora».
   - El texto de reglas: «Durante el simulacro no hay pistas, tutor ni resultados por pregunta…».
3. **Crear examen** (modo Simulacro). La tarjeta dice «Simulacro de formato reducido» y el porcentaje de cobertura. El formulario queda **congelado** antes de empezar.
4. **Empezar** y verificar durante toda la prueba:
   - Orden: Lectura → Redacción → Matemáticas → Inglés.
   - No hay retroalimentación, pista, tutor ni botón de regenerar.
   - La dificultad no cambia.
   - El temporizador es por área.
   - Las pausas aparecen tras Redacción y tras Matemáticas.
5. **Lectura:** al menos un texto trae varias preguntas seguidas (por ejemplo, el texto de las abejas: vocabulario, idea explícita, inferencia y luego «¿Qué oración ofrece la MEJOR evidencia…?»). El estímulo sigue visible en cada pregunta del grupo, y en móvil se puede leer sin zoom.
6. **Redacción:** cada pregunta pide una operación concreta (elisión, adición, generalización, título, particularización, conectores) sobre un segmento numerado.
7. **Matemáticas, respuestas producidas** (con el editor; se aceptan equivalentes):

| Pregunta | Respuestas aceptadas | No aceptado |
|---|---|---|
| 2/3 + 3/4 como fracción | `17/12` | `34/24` → parcial (valor correcto, fracción sin simplificar); `1.41` → parcial (pide fracción) |
| x + y = 10, x − y = 4 → x·y | `21` | `7` |
| Escalera 13 m, base a 5 m → altura | `12`, `√144` | `12 m²` |
| Media de 5 números = 8, se agrega 14 | `9` | `8` |
| Comité de 2 entre 6 | `15` | `30` |

8. Responder **mal a propósito** 2 preguntas de Lectura (Inferencias) y 2 de Matemáticas (Álgebra). Las necesitará el paso 4.
9. **Entregar.**

## 3. Resultados

Verificar:

- El título es **Preparación estimada StudyUS**, con la nota: «No es una puntuación oficial: no existe una tabla oficial de conversión publicada, así que StudyUS no muestra la escala oficial.».
- **No aparece ningún número en escala 200–800.**
- Aparecen «Respondiste N de M» y «X min usados».
- **Resultados por área**, en tres grupos:
  - **Lectura y Redacción**, reportadas juntas, con sus habilidades;
  - **Matemáticas**;
  - **Inglés**, con la nota «Cada institución decide cómo usa este resultado…».
- Dentro de cada grupo aparecen las habilidades con su clasificación (fortaleza / en desarrollo / brecha).
- La revisión por pregunta muestra tu respuesta y la correcta. En matemáticas, la respuesta se renderiza como fórmula, no como LaTeX crudo.

## 4. Puente al aprendizaje

1. En las brechas (Inferencias, Álgebra) aparece **Reforzar ahora**. El concepto viene de un catálogo curado de DEV (por ejemplo, «Inferencia textual» o «Ecuaciones lineales»). No lo crea la IA.
2. Pulsar **Reforzar ahora**. Lleva a la ficha del concepto en tu aprendizaje: la asignatura y el concepto se crean si no existían.
3. Volver al resultado: esa fila ahora dice **Reforzar** y enlaza al mismo concepto. Si se pulsa de nuevo, no aparece un duplicado.
4. Una habilidad sin concepto mapeado muestra **Añadir a mi plan** (propuesta gobernada). No se crea ningún concepto.

## 5. Práctica por área y por habilidad

1. **Practicar un área → Lectura**:
   - Modo único Práctica, sin cronómetro.
   - Hay retroalimentación tras cada respuesta.
   - Solo salen preguntas de Lectura.
2. **Lectura → Inferencias y evidencias**: todas las preguntas que aparecen son de inferencia o evidencia. Repetir con **Redacción → Coherencia, cohesión y particularización**.
3. **Practicar un área → Matemáticas**: aparecen preguntas de opción múltiple y de respuesta producida.
   - Responder `17/12` a la fracción: retroalimentación **correcta**.
   - Responder `1.41`: solo crédito parcial (valor aproximado, la pregunta pide fracción).
4. Tras una sesión fuerte, crear otra práctica del área. El nivel sube (Estándar → Avanzado).

## 6. Desafío

**Simulacro completo** → modo **Desafío**. La tarjeta indica dificultad objetivo más alta. **No** se presenta como más difícil que el examen real: `CHALLENGE_MODE = PARTIAL`, porque el banco solo alcanza ≈ 1,02×.

## 7. Eliminar y nuevo intento

1. Eliminar el simulacro **completado** (pide confirmación). Desaparece del historial visible y su resultado ya no se puede abrir.
2. La evidencia consolidada del aprendizaje **no** cambia: el operador lo comprueba en el paso 9.
3. **Nuevo intento**: el formulario nuevo se congela desde cero, sin respuestas ni tiempo previos, y prefiere preguntas no vistas.
4. Eliminar un simulacro **en curso**: el intento queda cancelado y no se puede reanudar.

## 8. Seguridad (Student B)

Con la URL de un resultado o intento de A, B recibe **404**. Tampoco puede eliminar ni reanudar los exámenes de A.

## 9. Comprobaciones del operador (solo lectura, DEV)

| Comprobación | Esperado |
|---|---|
| `exam_instances.form` del simulacro | Congelado (`form_frozen_at` < `started_at`), con 4 secciones y 36 posiciones |
| Respuestas SPR | `normalized_response` con `latex` y `ast` |
| Evidencia tras eliminar | El mismo número de filas en `learning_evidence` antes y después |
| `exam_definitions` `v2.paa.math` | `RETIRED` |

## 10. Criterios para `PAA_E2E = PASS` (los decide el equipo)

Pasos 1–8 sin defectos P0/P1. No aparece ninguna escala 200–800. El Simulacro completo se mantiene íntegro y sin ayudas. La práctica por habilidad no se sale del foco.

## Evidencia a capturar

Capturas de: el primer nivel; Antes de empezar; Lectura con estímulo compartido (escritorio y móvil); una pausa; Resultados por área; Reforzar ahora → concepto; historial tras eliminar. Además: el SHA de `/api/version`.
