# Piloto Saber 11 Matemáticas — lote de calibración 1

**Fecha:** 2026-10-05
**Rama:** `preview/qb-mock-readiness`
**Entorno:** DEV únicamente (fp `2a29b99ee14a22b4`). No se tocó Preview ni Producción.

**Estado:** el lote 1 está generado y validado automáticamente. **Sigue en espera de revisión humana**, y los lotes siguientes no se generan hasta que esa revisión termine.

## 1. Plan aprobado: qué es oficial y qué es política StudyUs

Todo el plan vive en `src/lib/exam-core/question-bank/pilots/saber11-math.ts`. `planProblems()` verifica sus totales y sus rangos.

| Dimensión | Oficial (Icfes) | Política StudyUs (50 ítems) |
|---|---|---|
| Competencia | Interpretación 34 %, Formulación 43 %, Argumentación 23 % | 17 / 22 / 11 |
| Contenido | Álgebra y cálculo 35–40 %, Estadística 35–40 %, Geometría 20–35 % | 19 / 19 / 12 (dentro de rangos) |
| Matriz 3×3 competencia × contenido | **no existe matriz oficial** | Int 6/7/4 · For 9/8/5 · Arg 4/4/3 |
| Dificultad | — | BÁSICA / INTERMEDIA / AVANZADA = 30 / 50 / 20 % (15/25/10). **Nunca** niveles de desempeño Icfes |
| Tiempo | Icfes no publica tiempo por área | ~1,5 min/ítem, política StudyUs. **Nunca** se presenta como tiempo oficial |
| Puntaje | — | puntaje bruto de práctica StudyUs. **Sin escala Icfes 0–100** |

Fuentes: `icfes-marco-matematicas-saber11`, `icfes-guia-saber11-2026`, `icfes-resolucion-268-2020`.

## 2. Seguridad de migraciones antes de escribir en DEV

**Certificación efímera.** Se hizo en Postgres 18 local y desechable (nunca Neon), con baseline más los 62 archivos aplicados por el runner gobernado: 62 aplicados, 0 pendientes, 0 drift.

| Migración | Verificación | Resultado |
|---|---|---|
| `20261031_1000` exam_instances.content_audience | columna NOT NULL, default STUDENT | ok |
| | CHECK rechaza un valor inválido | ok |
| | re-ejecución idempotente | ok |
| | rollback y re-aplicación | ok |
| `20261101_1000` question_bank_reviews.review_checklist (nueva) | CHECK rechaza aprobado con un punto en `false`, valores no booleanos y JSON que no es objeto | ok |
| | acepta aprobado completo, y rechazo o corrección con puntos fallidos | ok |
| | idempotente; rollback y re-aplicación | ok |

**DEV.**
- Antes: `db:status` daba 60 aplicados, 1 pendiente, 0 drift.
- Se aplicó cada migración con dry-run y luego en real con el runner gobernado.
- Ahora: **62 aplicados, 0 pendientes, 0 drift**.

## 3. Generación del lote de calibración 1

Comando:

```bash
npx tsx --env-file=<DEV> scripts/operations/qb-pilot-saber11.ts calibration --max-calls 40 --confirm-ai
```

- Se crearon 9 solicitudes con 10 ítems: una por celda de la matriz, más una extra en Formulación × Álgebra (la celda más grande).
- La dificultad se repartió 3 / 5 / 2.
- Cada solicitud corrió el factory **solo para esa solicitud**: sin análisis de huecos ni otros exámenes, y con tope total de llamadas.
- Los ítems llevan como etiquetas competencia, afirmación, evidencia (propuesta por el generador), categoría de contenido y locale es-CO.
- El dominio es MATH, así que la clave se recalcula a partir de una expresión y nunca se toma la del generador.

| Resultado | n |
|---|---|
| Candidatos | 10 |
| Validación automática superada → **PILOT** (solo práctica, no cuenta como contenido aprobado) | **8** |
| Rechazados automáticamente | **2** (los dos de Geometría) |
| Llamadas IA | 25 de un tope de 40 |
| Costo | ≈ USD 0,023 |

**Los dos rechazos:**
- Int × Geometría: `KEY_NOT_VERIFIED`. La clave no coincidió con el valor recalculado y la reparación tampoco pasó.
- Arg × Geometría: `IMPLAUSIBLE_DISTRACTORS`.

Celdas cubiertas por candidatos que pasaron: 7 de 9. Faltan Int×Geo y Arg×Geo.

## 4. Pre-revisión técnica (aporte para el revisor; no es una aprobación)

- **Claves:** las 8 claves en PILOT se recalcularon a mano y son correctas.
- **Competencia:** el ítem 1 (plan de datos, 18 − 1,5d = 6) plantea y resuelve una ecuación. Parece más *Formulación* que *Interpretación*.
- **Racionales de distractores que no corresponden al número:**
  - Ítem 5: el error de intercambiar precios da 100, que es la opción A, pero el racional está en C.
  - Ítems 1, 6 y 7: racionales imprecisos.
- **Distractores débiles:** 9A (187,5 %, evidentemente mayor a 100 %) y 8D.
- **Dificultad:** el validador independiente estimó LOW en los 8, incluidos los 2 AVANZADOS (5 y 8). Es una señal de calibración: el generador sobreestima la dificultad. El ítem 8 sí es conceptualmente exigente.
- **Defecto de presentación (ítem 8):** usa delimitadores LaTeX `\( \)`. El renderizador de ítems (`lib/math-text`) solo entiende `$…$`, así que el estudiante vería el texto crudo. Se recomienda «Solicitar corrección».
  - Corregido para los lotes siguientes: hay una validación determinista nueva (`UNSUPPORTED_MATH_DELIMITERS`, que manda a reparación) y una instrucción en el prompt.

## 5. Revisión humana (pendiente, obligatoria antes del lote 2)

**Dónde:** Admin → Banco de preguntas → Revisión → cada ítem.

- Al pie de la pregunta, la ficha muestra las coordenadas solicitadas y las del ítem.
- Muestra una **lista de verificación de 9 puntos**: respuesta, distractores, competencia, afirmación/evidencia, categoría de contenido, dificultad StudyUs, idioma es-CO, solución y originalidad.

**Cómo se hace cumplir la lista:**
- **Aprobar** exige los 9 puntos.
- Lo verifican la UI, el servicio (`CHECKLIST_INCOMPLETE`) y la base de datos (CHECK de 20261101).
- Rechazar o solicitar corrección guarda qué puntos fallaron.
- El revisor nunca puede ser el autor; el autor es la identidad técnica del factory.

**Material de apoyo:** paquete de revisión [CALIBRATION_BATCH_1_REVIEW_PACKET.md](CALIBRATION_BATCH_1_REVIEW_PACKET.md).

**Qué es el revisor:** una persona, docente de matemáticas con conocimiento de Saber 11. El agente **no aprueba** ítems.

## 6. Medición veraz después del lote

El validador (`qb-mock-certification.ts --exam v2.saber11.math`, en DEV y solo lectura) da para Saber 11 Matemáticas:

| Medida | Valor |
|---|---|
| Engine | TECHNICAL_DEMO |
| **Content** | **NONE** |
| MOCK_READY | false |

- Los 8 ítems en PILOT cuentan como `NOT_HUMAN_APPROVED`. Desde este cambio, PRACTICE_READY solo cuenta contenido real **aprobado por una persona**; PILOT se puede entregar en práctica DEV, pero no hace a un examen «listo».
- El blueprint sigue en 12 de 50 posiciones y con distribución UNKNOWN.

## 7. Gate para el lote 2 y siguientes

Se generan los ~70 candidatos restantes **solo si se cumplen las tres condiciones**:

1. Los 8 ítems en PILOT tienen decisión humana.
2. La tasa de rechazo total (automática más humana) sostiene el supuesto de ~25 %. Con 2 de 10 rechazos automáticos, la tasa total ya es ≥ 20 %.
3. Se ajustó el prompt según lo que encuentre la revisión: dificultad, racionales, Geometría.

Si la tasa total supera ~30 %, hay que recalcular el número de candidatos antes de seguir.

## 8. Pendiente para llegar a ONE_MOCK_READY (no hecho aquí)

**Blueprint de 50 posiciones.** Debe usar la tabla aprobada, con `blueprintSpecification: DOCUMENTED` y las fuentes Icfes.
- El validador ya exige la restricción de contenido (`contentCategory`).
- `blueprint_objective_targets` todavía no puede guardar la categoría. Hay dos opciones:
  1. Nueve objetivos (competencia × contenido).
  2. Una columna nueva.

  Requiere decisión del usuario.

**Contenido.** Hacen falta ≥ 50 ítems aprobados que no sean fixtures, repartidos según la matriz y la dificultad 15/25/10.

**Marks.** Los ítems MCQ valen 1 punto bruto por política StudyUs de práctica. No es una escala oficial.
