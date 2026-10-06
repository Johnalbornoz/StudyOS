# Saber 11 Matemáticas — Human Review Batch 1 — paquete del revisor

Batch = **Saber 11 Math Calibration 1** (`calibration-1`). Generado 2026-10-06T02:30:23.771Z desde DEV (fp 2a29b99ee14a22b4), solo lectura.
Contenido ORIGINAL generado por StudyUs con asistencia de IA. No es contenido oficial del Icfes.

**8 ítems para revisión humana** (pasaron la validación automática) · 2 rechazados automáticamente (no se revisan; cuentan en la tasa final).

> **La validación automática NO es una aprobación humana.** Cada ítem sigue en espera de revisión humana hasta que un revisor calificado registre una decisión explícita.

## Cómo registrar la decisión

- Dónde: Admin → Banco de preguntas → Revisión → ítem (con **tu propia cuenta**; quien revisa nunca es el autor ni una identidad del sistema).
- Decisiones: **HUMAN_APPROVED** (Aprobar) · **CORRECTION_REQUIRED** (Solicitar corrección) · **REJECTED** (Rechazar).
- Para cualquier decisión: responde **Sí / No** a los 9 puntos, elige la competencia, la categoría de contenido, la dificultad StudyUs y la respuesta correcta según tu revisión, y confirma o descarta cada punto de atención.
- Aprobar exige los 9 puntos en «Sí». Solicitar corrección exige al menos un «No», un comentario y notas de corrección. Rechazar exige al menos un «No» y el motivo.
- **Prerrequisito (operador, antes de registrar):** el entorno donde se registra debe tener la migración `20261104_1000_question_bank_review_assessment` aplicada y el código de esta revisión desplegado. Sin ellos, el formulario no captura la clasificación del revisor y la base de datos rechaza la decisión de piloto (`PILOT_ASSESSMENT_REQUIRED`).

Lista de revisión (contrato vigente, 9 puntos):
- **ANSWER** — La clave es correcta y es la única respuesta defendible
- **DISTRACTORS** — Los distractores son plausibles y claramente incorrectos
- **COMPETENCE** — Evalúa la competencia indicada
- **ASSERTION_EVIDENCE** — Corresponde a la afirmación y a la evidencia del marco Icfes
- **CONTENT_CATEGORY** — Corresponde a la categoría de contenido indicada
- **DIFFICULTY** — La dificultad StudyUs (básica / intermedia / avanzada) es correcta
- **LANGUAGE** — Español claro y apropiado para Colombia (es-CO)
- **SOLUTION** — La solución explicada es correcta y completa
- **ORIGINALITY** — Es original: no reproduce ni parafrasea ítems liberados por el Icfes

Política StudyUs (no oficial): StudyUs difficulty BASIC / INTERMEDIATE / ADVANCED -- never Icfes performance levels. StudyUs policy, not an official Icfes competence x content matrix.

---

## Ítem 1 — AWAITING_HUMAN_REVIEW

**Identidad**

- Candidato: `qb.saber.interpretacion.d1bb446253` · versión v1 (`5d52e2d4-2f10-4f67-ac6a-a114935fb274`)
- Batch: Saber 11 Math Calibration 1 · solicitud `saber11-math-2026:calibration-1:INTERPRETACION:ALGEBRA_CALCULO`
- Estado del ciclo de vida: PILOT

**Pregunta**

Un plan de datos tiene inicialmente 18 GB. Cada día se consumen 1,5 GB. ¿Después de cuántos días quedarán 6 GB disponibles?

- **A)** 12 días
- **B)** 8 días  ← **clave propuesta**
- **C)** 24 días
- **D)** 6 días

**Clave propuesta:** B

**Solución / explicación:** La cantidad disponible se modela como 18 - 1,5d. Al igualarla a 6, se obtiene 18 - 1,5d = 6, de modo que 1,5d = 12 y d = 8.

**Racionales de distractores (del generador):**
- A: Divide la cantidad inicial de datos entre la cantidad que debe quedar, sin considerar correctamente el consumo diario.
- C: Multiplica 18 por la diferencia entre los datos iniciales y los disponibles, en lugar de dividir la cantidad consumida entre la tasa diaria.
- D: Confunde la cantidad de datos que deben consumirse con el número de días y selecciona directamente 6.

**Clasificación propuesta (generador — confirmar o corregir)**

- Competencia: Interpretación y representación
- Afirmación: Comprende y transforma la información cuantitativa y esquemática presentada en distintos formatos.
- Evidencia (afirmada por el generador; verificar con el marco Icfes): El ítem recoge la capacidad de transformar una situación verbal de cambio constante en una relación algebraica y usarla para interpretar el valor de una variable.
- Categoría de contenido: Álgebra y cálculo
- Dificultad StudyUs: INTERMEDIA (escala interna 3; nunca un nivel de desempeño Icfes)
- Idioma / locale: es / es-CO
- Puntos (marks): 1 · tipo: multiple_choice (single_choice)

**Celda Blueprint**

- Solicitada: INTERPRETACION × ALGEBRA_CALCULO · objetivo `saber.interpretacion`
- Propuesta por el ítem: **INTERPRETACION × ALGEBRA_CALCULO** · declarada en Blueprint Saber V2.1 (50 posiciones) · coincide con la solicitud

**Validación automática (no es aprobación humana)**

- Resultado: PASS · etapa AI_VALIDATOR
- Clave recomputada (MATH): (18-6)/1.5
- Hallazgos: ninguno
- Validador independiente: eligió B, dificultad estimada LOW, distractores implausibles ninguno, alternativas defendibles ninguna

**Puntos de atención (confirmar o descartar; NO son decisiones)**

- [ ] Confirmo · [ ] No confirmo — El ítem plantea y resuelve una ecuación (18 − 1,5d = 6): podría corresponder mejor a Formulación y ejecución que a Interpretación y representación. `COMPETENCE_MAY_BE_FORMULATION`
- [ ] Confirmo · [ ] No confirmo — Algunos racionales de distractores no describen con precisión el error que lleva a esa opción. `DISTRACTOR_RATIONALES_IMPRECISE`
- [ ] Confirmo · [ ] No confirmo — El validador independiente estimó dificultad BAJA; el generador propuso la indicada. ¿La dificultad StudyUs propuesta es razonable? `VALIDATOR_ESTIMATED_EASIER`

**Decisión del revisor (se registra en Admin)**

- [ ] Sí · [ ] No — ANSWER: La clave es correcta y es la única respuesta defendible
- [ ] Sí · [ ] No — DISTRACTORS: Los distractores son plausibles y claramente incorrectos
- [ ] Sí · [ ] No — COMPETENCE: Evalúa la competencia indicada
- [ ] Sí · [ ] No — ASSERTION_EVIDENCE: Corresponde a la afirmación y a la evidencia del marco Icfes
- [ ] Sí · [ ] No — CONTENT_CATEGORY: Corresponde a la categoría de contenido indicada
- [ ] Sí · [ ] No — DIFFICULTY: La dificultad StudyUs (básica / intermedia / avanzada) es correcta
- [ ] Sí · [ ] No — LANGUAGE: Español claro y apropiado para Colombia (es-CO)
- [ ] Sí · [ ] No — SOLUTION: La solución explicada es correcta y completa
- [ ] Sí · [ ] No — ORIGINALITY: Es original: no reproduce ni parafrasea ítems liberados por el Icfes

- Competencia según el revisor: ____ · Contenido: ____ · Dificultad StudyUs: ____ · Respuesta correcta: ____
- Decisión: [ ] HUMAN_APPROVED · [ ] CORRECTION_REQUIRED · [ ] REJECTED

---

## Ítem 2 — AWAITING_HUMAN_REVIEW

**Identidad**

- Candidato: `qb.saber.interpretacion.1af76e7a3a` · versión v1 (`cc6229f1-596e-4abd-a6dc-8c350ba3eff0`)
- Batch: Saber 11 Math Calibration 1 · solicitud `saber11-math-2026:calibration-1:INTERPRETACION:ESTADISTICA`
- Estado del ciclo de vida: PILOT

**Pregunta**

En una campaña escolar de reciclaje, tres cursos reunieron 12, 18 y 10 kilogramos de material, respectivamente. ¿Qué porcentaje del material total reunió el curso que recolectó 18 kilogramos?

- **A)** 40 %
- **B)** 45 %  ← **clave propuesta**
- **C)** 55 %
- **D)** 30 %

**Clave propuesta:** B

**Solución / explicación:** El total recolectado fue 12 + 18 + 10 = 40 kilogramos. El porcentaje correspondiente a 18 kilogramos es 18/40 × 100 = 45 %.

**Racionales de distractores (del generador):**
- A: Calcula el porcentaje usando solo una parte de los datos o redondea de manera incorrecta.
- C: Confunde el porcentaje del curso con el porcentaje restante del material o usa una base diferente para el cálculo.
- D: Confunde la cantidad recolectada por el curso con su porcentaje sobre el total.

**Clasificación propuesta (generador — confirmar o corregir)**

- Competencia: Interpretación y representación
- Afirmación: Comprende y transforma la información cuantitativa y esquemática presentada en distintos formatos.
- Evidencia (afirmada por el generador; verificar con el marco Icfes): El ítem recoge la transformación de cantidades organizadas en una situación en un porcentaje que representa la participación de una categoría dentro del total.
- Categoría de contenido: Estadística
- Dificultad StudyUs: BÁSICA (escala interna 2; nunca un nivel de desempeño Icfes)
- Idioma / locale: es / es-CO
- Puntos (marks): 1 · tipo: multiple_choice (single_choice)

**Celda Blueprint**

- Solicitada: INTERPRETACION × ESTADISTICA · objetivo `saber.interpretacion`
- Propuesta por el ítem: **INTERPRETACION × ESTADISTICA** · declarada en Blueprint Saber V2.1 (50 posiciones) · coincide con la solicitud

**Validación automática (no es aprobación humana)**

- Resultado: PASS · etapa AI_VALIDATOR
- Clave recomputada (MATH): 18/(12+18+10)*100
- Hallazgos: ninguno
- Validador independiente: eligió B, dificultad estimada LOW, distractores implausibles ninguno, alternativas defendibles ninguna

**Puntos de atención (confirmar o descartar; NO son decisiones)**

- [ ] Confirmo · [ ] No confirmo — El validador independiente estimó dificultad BAJA; el generador propuso la indicada. ¿La dificultad StudyUs propuesta es razonable? `VALIDATOR_ESTIMATED_EASIER`

**Decisión del revisor (se registra en Admin)**

- [ ] Sí · [ ] No — ANSWER: La clave es correcta y es la única respuesta defendible
- [ ] Sí · [ ] No — DISTRACTORS: Los distractores son plausibles y claramente incorrectos
- [ ] Sí · [ ] No — COMPETENCE: Evalúa la competencia indicada
- [ ] Sí · [ ] No — ASSERTION_EVIDENCE: Corresponde a la afirmación y a la evidencia del marco Icfes
- [ ] Sí · [ ] No — CONTENT_CATEGORY: Corresponde a la categoría de contenido indicada
- [ ] Sí · [ ] No — DIFFICULTY: La dificultad StudyUs (básica / intermedia / avanzada) es correcta
- [ ] Sí · [ ] No — LANGUAGE: Español claro y apropiado para Colombia (es-CO)
- [ ] Sí · [ ] No — SOLUTION: La solución explicada es correcta y completa
- [ ] Sí · [ ] No — ORIGINALITY: Es original: no reproduce ni parafrasea ítems liberados por el Icfes

- Competencia según el revisor: ____ · Contenido: ____ · Dificultad StudyUs: ____ · Respuesta correcta: ____
- Decisión: [ ] HUMAN_APPROVED · [ ] CORRECTION_REQUIRED · [ ] REJECTED

---

## Ítem 3 — AUTO_REJECTED (no se revisa)

**Identidad**

- Candidato: `qb.saber.interpretacion.0a60b42889` · versión v2 (`7f7530ca-1b2a-47ed-9f6c-bde856e8fd55`)
- Batch: Saber 11 Math Calibration 1 · solicitud `saber11-math-2026:calibration-1:INTERPRETACION:GEOMETRIA`
- Estado del ciclo de vida: REJECTED

**Pregunta**

En el plano de una cancha rectangular, la escala indica que 1 cm representa 200 cm en la realidad. Si la cancha mide 3,5 cm de largo y 2 cm de ancho en el plano, ¿cuál es el área real de la cancha?

- **A)** 28 m²  ← **clave propuesta**
- **B)** 56 m²
- **C)** 14 m²
- **D)** 280 m²

**Clave propuesta:** A

**Solución / explicación:** Cada centímetro del plano representa 2 m en la realidad. Por tanto, las dimensiones reales son 7 m y 4 m, y el área es 7 × 4 = 28 m².

**Racionales de distractores (del generador):**
- B: Confunde el área con una suma o aplica la escala de manera incorrecta al transformar las dimensiones.
- C: Calcula incorrectamente el área al transformar solo una dimensión o combinar de forma inadecuada la escala.
- D: Multiplica las medidas del plano por 200 sin convertir primero los centímetros a metros.

**Clasificación propuesta (generador — confirmar o corregir)**

- Competencia: Interpretación y representación
- Afirmación: Comprende y transforma la información cuantitativa y esquemática presentada en distintos formatos.
- Evidencia (afirmada por el generador; verificar con el marco Icfes): El ítem recoge la transformación de medidas representadas en un plano a dimensiones reales y su uso para calcular el área de una figura geométrica.
- Categoría de contenido: Geometría
- Dificultad StudyUs: INTERMEDIA (escala interna 3; nunca un nivel de desempeño Icfes)
- Idioma / locale: es / es-CO
- Puntos (marks): 1 · tipo: multiple_choice (single_choice)

**Celda Blueprint**

- Solicitada: INTERPRETACION × GEOMETRIA · objetivo `saber.interpretacion`
- Propuesta por el ítem: **INTERPRETACION × GEOMETRIA** · declarada en Blueprint Saber V2.1 (50 posiciones) · coincide con la solicitud

**Validación automática (no es aprobación humana)**

- Resultado: REPAIR_REQUIRED · etapa DETERMINISTIC
- Clave recomputada (MATH): 3.5*2*2*2
- Hallazgos: KEY_NOT_VERIFIED (REPAIR)
- Validador independiente: —

---

## Ítem 4 — AWAITING_HUMAN_REVIEW

**Identidad**

- Candidato: `qb.saber.formulacion.24a8685760` · versión v2 (`1f5ea768-8d56-4445-9f94-1337e9067524`)
- Batch: Saber 11 Math Calibration 1 · solicitud `saber11-math-2026:calibration-1:FORMULACION:ALGEBRA_CALCULO`
- Estado del ciclo de vida: PILOT

**Pregunta**

Para preparar 4 arepas se necesitan 300 gramos de harina. Si se conserva la misma proporción, ¿cuántos gramos de harina se necesitan para preparar 10 arepas?

- **A)** 900 gramos
- **B)** 1.200 gramos
- **C)** 600 gramos
- **D)** 750 gramos  ← **clave propuesta**

**Clave propuesta:** D

**Solución / explicación:** Cada arepa requiere 300 ÷ 4 = 75 gramos de harina. Para 10 arepas se necesitan 75 × 10 = 750 gramos.

**Racionales de distractores (del generador):**
- A: Se multiplica 300 por 3, usando incorrectamente el aumento de 4 a 10 como factor.
- B: Se multiplica 300 por 4, confundiendo la cantidad inicial de arepas con el factor necesario para 10.
- C: Se calcula 300 × 2, ignorando que pasar de 4 a 10 arepas requiere multiplicar por 2,5.

**Clasificación propuesta (generador — confirmar o corregir)**

- Competencia: Formulación y ejecución
- Afirmación: Frente a un problema que involucre información cuantitativa, plantea e implementa estrategias que lleven a soluciones adecuadas.
- Evidencia (afirmada por el generador; verificar con el marco Icfes): El ítem recoge la capacidad de establecer una proporción y ejecutar operaciones para determinar una cantidad desconocida en una situación cotidiana.
- Categoría de contenido: Álgebra y cálculo
- Dificultad StudyUs: BÁSICA (escala interna 2; nunca un nivel de desempeño Icfes)
- Idioma / locale: es / es-CO
- Puntos (marks): 1 · tipo: multiple_choice (single_choice)

**Celda Blueprint**

- Solicitada: FORMULACION × ALGEBRA_CALCULO · objetivo `saber.formulacion`
- Propuesta por el ítem: **FORMULACION × ALGEBRA_CALCULO** · declarada en Blueprint Saber V2.1 (50 posiciones) · coincide con la solicitud

**Validación automática (no es aprobación humana)**

- Resultado: PASS · etapa AI_VALIDATOR
- Clave recomputada (MATH): (300/4)*10
- Hallazgos: ninguno
- Validador independiente: eligió D, dificultad estimada LOW, distractores implausibles ninguno, alternativas defendibles ninguna

**Puntos de atención (confirmar o descartar; NO son decisiones)**

- [ ] Confirmo · [ ] No confirmo — El validador independiente estimó dificultad BAJA; el generador propuso la indicada. ¿La dificultad StudyUs propuesta es razonable? `VALIDATOR_ESTIMATED_EASIER`

**Decisión del revisor (se registra en Admin)**

- [ ] Sí · [ ] No — ANSWER: La clave es correcta y es la única respuesta defendible
- [ ] Sí · [ ] No — DISTRACTORS: Los distractores son plausibles y claramente incorrectos
- [ ] Sí · [ ] No — COMPETENCE: Evalúa la competencia indicada
- [ ] Sí · [ ] No — ASSERTION_EVIDENCE: Corresponde a la afirmación y a la evidencia del marco Icfes
- [ ] Sí · [ ] No — CONTENT_CATEGORY: Corresponde a la categoría de contenido indicada
- [ ] Sí · [ ] No — DIFFICULTY: La dificultad StudyUs (básica / intermedia / avanzada) es correcta
- [ ] Sí · [ ] No — LANGUAGE: Español claro y apropiado para Colombia (es-CO)
- [ ] Sí · [ ] No — SOLUTION: La solución explicada es correcta y completa
- [ ] Sí · [ ] No — ORIGINALITY: Es original: no reproduce ni parafrasea ítems liberados por el Icfes

- Competencia según el revisor: ____ · Contenido: ____ · Dificultad StudyUs: ____ · Respuesta correcta: ____
- Decisión: [ ] HUMAN_APPROVED · [ ] CORRECTION_REQUIRED · [ ] REJECTED

---

## Ítem 5 — AWAITING_HUMAN_REVIEW

**Identidad**

- Candidato: `qb.saber.formulacion.3d04bf73f9` · versión v2 (`995eee18-f92c-4c28-9522-3c55eca3989d`)
- Batch: Saber 11 Math Calibration 1 · solicitud `saber11-math-2026:calibration-1:FORMULACION:ALGEBRA_CALCULO`
- Estado del ciclo de vida: PILOT

**Pregunta**

En una feria escolar se vendieron 180 entradas entre estudiantes y particulares. Cada entrada de estudiante costaba 8.000 pesos y cada entrada de particular, 12.000 pesos. Si el recaudo total fue de 1.840.000 pesos, ¿cuántas entradas de estudiante se vendieron?

- **A)** 100
- **B)** 120
- **C)** 60
- **D)** 80  ← **clave propuesta**

**Clave propuesta:** D

**Solución / explicación:** Si x representa las entradas de estudiante, entonces las entradas de particular son 180 − x. Al expresar los valores en miles de pesos, se plantea 8x + 12(180 − x) = 1840. Al resolver, 8x + 2160 − 12x = 1840, de donde x = 80.

**Racionales de distractores (del generador):**
- A: Se obtiene al usar el recaudo total como si todas las entradas costaran 8.000 pesos, sin considerar las entradas de particular.
- B: Se interpreta el número total de entradas como si correspondiera únicamente a entradas de estudiante.
- C: Se obtiene al intercambiar los precios de las entradas al plantear la ecuación del recaudo.

**Clasificación propuesta (generador — confirmar o corregir)**

- Competencia: Formulación y ejecución
- Afirmación: Frente a un problema que involucre información cuantitativa, plantea e implementa estrategias que lleven a soluciones adecuadas.
- Evidencia (afirmada por el generador; verificar con el marco Icfes): El ítem recoge la capacidad de modelar dos cantidades relacionadas mediante una ecuación lineal y ejecutar su solución para interpretar el resultado en el contexto.
- Categoría de contenido: Álgebra y cálculo
- Dificultad StudyUs: AVANZADA (escala interna 4; nunca un nivel de desempeño Icfes)
- Idioma / locale: es / es-CO
- Puntos (marks): 1 · tipo: multiple_choice (single_choice)

**Celda Blueprint**

- Solicitada: FORMULACION × ALGEBRA_CALCULO · objetivo `saber.formulacion`
- Propuesta por el ítem: **FORMULACION × ALGEBRA_CALCULO** · declarada en Blueprint Saber V2.1 (50 posiciones) · coincide con la solicitud

**Validación automática (no es aprobación humana)**

- Resultado: PASS · etapa DETERMINISTIC+ALIGNMENT
- Clave recomputada (MATH): (12*180-1840)/(12-8)
- Hallazgos: DIFFICULTY_IMPLAUSIBLE (WARN)
- Validador independiente: eligió D, dificultad estimada LOW, distractores implausibles ninguno, alternativas defendibles ninguna

**Puntos de atención (confirmar o descartar; NO son decisiones)**

- [ ] Confirmo · [ ] No confirmo — El error de intercambiar precios da 100 (opción A), pero el racional de ese error aparece en la opción C. `DISTRACTOR_RATIONALE_MISPLACED`
- [ ] Confirmo · [ ] No confirmo — El validador independiente estimó dificultad BAJA; el generador propuso la indicada. ¿La dificultad StudyUs propuesta es razonable? `VALIDATOR_ESTIMATED_EASIER`

**Decisión del revisor (se registra en Admin)**

- [ ] Sí · [ ] No — ANSWER: La clave es correcta y es la única respuesta defendible
- [ ] Sí · [ ] No — DISTRACTORS: Los distractores son plausibles y claramente incorrectos
- [ ] Sí · [ ] No — COMPETENCE: Evalúa la competencia indicada
- [ ] Sí · [ ] No — ASSERTION_EVIDENCE: Corresponde a la afirmación y a la evidencia del marco Icfes
- [ ] Sí · [ ] No — CONTENT_CATEGORY: Corresponde a la categoría de contenido indicada
- [ ] Sí · [ ] No — DIFFICULTY: La dificultad StudyUs (básica / intermedia / avanzada) es correcta
- [ ] Sí · [ ] No — LANGUAGE: Español claro y apropiado para Colombia (es-CO)
- [ ] Sí · [ ] No — SOLUTION: La solución explicada es correcta y completa
- [ ] Sí · [ ] No — ORIGINALITY: Es original: no reproduce ni parafrasea ítems liberados por el Icfes

- Competencia según el revisor: ____ · Contenido: ____ · Dificultad StudyUs: ____ · Respuesta correcta: ____
- Decisión: [ ] HUMAN_APPROVED · [ ] CORRECTION_REQUIRED · [ ] REJECTED

---

## Ítem 6 — AWAITING_HUMAN_REVIEW

**Identidad**

- Candidato: `qb.saber.formulacion.aca89de0b2` · versión v1 (`6ade78fb-f8fd-476d-94e3-217e489ff163`)
- Batch: Saber 11 Math Calibration 1 · solicitud `saber11-math-2026:calibration-1:FORMULACION:ESTADISTICA`
- Estado del ciclo de vida: PILOT

**Pregunta**

En una encuesta realizada a 150 clientes de una tienda, 36 afirmaron que usarían el servicio de domicilio si estuviera disponible. Si se mantiene la misma proporción, ¿cuántos de los 1.000 clientes de la tienda se estima que usarían este servicio?

- **A)** 180 clientes
- **B)** 240 clientes  ← **clave propuesta**
- **C)** 264 clientes
- **D)** 400 clientes

**Clave propuesta:** B

**Solución / explicación:** La proporción de clientes interesados es 36/150. Al aplicarla a 1.000 clientes, se obtiene (36/150) × 1.000 = 240. Por tanto, se estiman 240 clientes.

**Racionales de distractores (del generador):**
- A: Este resultado se obtiene al usar 27 como porcentaje, en lugar de calcular la proporción 36/150, que equivale al 24 %.
- C: Este resultado surge de aproximar incorrectamente la proporción a 26,4 %.
- D: Este resultado corresponde a aplicar una proporción de 40 %, que no coincide con los datos de la encuesta.

**Clasificación propuesta (generador — confirmar o corregir)**

- Competencia: Formulación y ejecución
- Afirmación: Frente a un problema que involucre información cuantitativa, plantea e implementa estrategias que lleven a soluciones adecuadas.
- Evidencia (afirmada por el generador; verificar con el marco Icfes): El ítem recoge la capacidad de calcular una proporción a partir de datos muestrales y usarla para estimar una cantidad en una población mayor.
- Categoría de contenido: Estadística
- Dificultad StudyUs: INTERMEDIA (escala interna 3; nunca un nivel de desempeño Icfes)
- Idioma / locale: es / es-CO
- Puntos (marks): 1 · tipo: multiple_choice (single_choice)

**Celda Blueprint**

- Solicitada: FORMULACION × ESTADISTICA · objetivo `saber.formulacion`
- Propuesta por el ítem: **FORMULACION × ESTADISTICA** · declarada en Blueprint Saber V2.1 (50 posiciones) · coincide con la solicitud

**Validación automática (no es aprobación humana)**

- Resultado: PASS · etapa AI_VALIDATOR
- Clave recomputada (MATH): (36/150)*1000
- Hallazgos: ninguno
- Validador independiente: eligió B, dificultad estimada LOW, distractores implausibles ninguno, alternativas defendibles ninguna

**Puntos de atención (confirmar o descartar; NO son decisiones)**

- [ ] Confirmo · [ ] No confirmo — Algunos racionales de distractores no describen con precisión el error que lleva a esa opción. `DISTRACTOR_RATIONALES_IMPRECISE`
- [ ] Confirmo · [ ] No confirmo — El validador independiente estimó dificultad BAJA; el generador propuso la indicada. ¿La dificultad StudyUs propuesta es razonable? `VALIDATOR_ESTIMATED_EASIER`

**Decisión del revisor (se registra en Admin)**

- [ ] Sí · [ ] No — ANSWER: La clave es correcta y es la única respuesta defendible
- [ ] Sí · [ ] No — DISTRACTORS: Los distractores son plausibles y claramente incorrectos
- [ ] Sí · [ ] No — COMPETENCE: Evalúa la competencia indicada
- [ ] Sí · [ ] No — ASSERTION_EVIDENCE: Corresponde a la afirmación y a la evidencia del marco Icfes
- [ ] Sí · [ ] No — CONTENT_CATEGORY: Corresponde a la categoría de contenido indicada
- [ ] Sí · [ ] No — DIFFICULTY: La dificultad StudyUs (básica / intermedia / avanzada) es correcta
- [ ] Sí · [ ] No — LANGUAGE: Español claro y apropiado para Colombia (es-CO)
- [ ] Sí · [ ] No — SOLUTION: La solución explicada es correcta y completa
- [ ] Sí · [ ] No — ORIGINALITY: Es original: no reproduce ni parafrasea ítems liberados por el Icfes

- Competencia según el revisor: ____ · Contenido: ____ · Dificultad StudyUs: ____ · Respuesta correcta: ____
- Decisión: [ ] HUMAN_APPROVED · [ ] CORRECTION_REQUIRED · [ ] REJECTED

---

## Ítem 7 — AWAITING_HUMAN_REVIEW

**Identidad**

- Candidato: `qb.saber.formulacion.f318dfdb74` · versión v2 (`6086e9a1-9829-4bbf-bac5-4d2bf4abe96b`)
- Batch: Saber 11 Math Calibration 1 · solicitud `saber11-math-2026:calibration-1:FORMULACION:GEOMETRIA`
- Estado del ciclo de vida: PILOT

**Pregunta**

Un aviso triangular tiene una base de 1,8 m y una altura de 1,2 m. Para pintarlo, se necesita 1 litro de pintura por cada 0,5 m² de superficie. ¿Cuántos litros de pintura se requieren para cubrirlo completamente?

- **A)** 5,4 litros
- **B)** 2,16 litros  ← **clave propuesta**
- **C)** 3,6 litros
- **D)** 4,32 litros

**Clave propuesta:** B

**Solución / explicación:** El área del aviso es (1,8 × 1,2) ÷ 2 = 1,08 m². Como cada litro cubre 0,5 m², se requieren 1,08 ÷ 0,5 = 2,16 litros.

**Racionales de distractores (del generador):**
- A: Se combina incorrectamente el área y la cobertura, produciendo una cantidad mayor que la necesaria.
- C: Se obtiene al duplicar el área del triángulo, en lugar de dividirla entre la cobertura de cada litro.
- D: Resulta de multiplicar la base por la altura sin aplicar correctamente la fórmula del área triangular ni la cobertura por litro.

**Clasificación propuesta (generador — confirmar o corregir)**

- Competencia: Formulación y ejecución
- Afirmación: Frente a un problema que involucre información cuantitativa, plantea e implementa estrategias que lleven a soluciones adecuadas.
- Evidencia (afirmada por el generador; verificar con el marco Icfes): El ítem recoge la capacidad de calcular el área de un triángulo y usarla para determinar la cantidad de pintura necesaria mediante una estrategia de proporcionalidad.
- Categoría de contenido: Geometría
- Dificultad StudyUs: INTERMEDIA (escala interna 3; nunca un nivel de desempeño Icfes)
- Idioma / locale: es / es-CO
- Puntos (marks): 1 · tipo: multiple_choice (single_choice)

**Celda Blueprint**

- Solicitada: FORMULACION × GEOMETRIA · objetivo `saber.formulacion`
- Propuesta por el ítem: **FORMULACION × GEOMETRIA** · declarada en Blueprint Saber V2.1 (50 posiciones) · coincide con la solicitud

**Validación automática (no es aprobación humana)**

- Resultado: PASS · etapa AI_VALIDATOR
- Clave recomputada (MATH): (1.8*1.2/2)/0.5
- Hallazgos: ninguno
- Validador independiente: eligió B, dificultad estimada LOW, distractores implausibles ninguno, alternativas defendibles ninguna

**Puntos de atención (confirmar o descartar; NO son decisiones)**

- [ ] Confirmo · [ ] No confirmo — Algunos racionales de distractores no describen con precisión el error que lleva a esa opción. `DISTRACTOR_RATIONALES_IMPRECISE`
- [ ] Confirmo · [ ] No confirmo — El validador independiente estimó dificultad BAJA; el generador propuso la indicada. ¿La dificultad StudyUs propuesta es razonable? `VALIDATOR_ESTIMATED_EASIER`

**Decisión del revisor (se registra en Admin)**

- [ ] Sí · [ ] No — ANSWER: La clave es correcta y es la única respuesta defendible
- [ ] Sí · [ ] No — DISTRACTORS: Los distractores son plausibles y claramente incorrectos
- [ ] Sí · [ ] No — COMPETENCE: Evalúa la competencia indicada
- [ ] Sí · [ ] No — ASSERTION_EVIDENCE: Corresponde a la afirmación y a la evidencia del marco Icfes
- [ ] Sí · [ ] No — CONTENT_CATEGORY: Corresponde a la categoría de contenido indicada
- [ ] Sí · [ ] No — DIFFICULTY: La dificultad StudyUs (básica / intermedia / avanzada) es correcta
- [ ] Sí · [ ] No — LANGUAGE: Español claro y apropiado para Colombia (es-CO)
- [ ] Sí · [ ] No — SOLUTION: La solución explicada es correcta y completa
- [ ] Sí · [ ] No — ORIGINALITY: Es original: no reproduce ni parafrasea ítems liberados por el Icfes

- Competencia según el revisor: ____ · Contenido: ____ · Dificultad StudyUs: ____ · Respuesta correcta: ____
- Decisión: [ ] HUMAN_APPROVED · [ ] CORRECTION_REQUIRED · [ ] REJECTED

---

## Ítem 8 — AWAITING_HUMAN_REVIEW

**Identidad**

- Candidato: `qb.saber.argumentacion.52fc43dc03` · versión v1 (`ad72fb04-acf0-40df-8d7a-2e18ea161c8f`)
- Batch: Saber 11 Math Calibration 1 · solicitud `saber11-math-2026:calibration-1:ARGUMENTACION:ALGEBRA_CALCULO`
- Estado del ciclo de vida: PILOT

**Pregunta**

Un estudiante resuelve la ecuación \((x^2-9)/(x-3)=6\) así: factoriza el numerador, cancela el factor \(x-3\) y obtiene \(x+3=6\), por lo que concluye que \(x=3\). Al validar el procedimiento y considerar las restricciones de la expresión original, ¿cuántas soluciones válidas tiene la ecuación?

- **A)** 0  ← **clave propuesta**
- **B)** 1
- **C)** 2
- **D)** 3

**Clave propuesta:** A

**Solución / explicación:** La expresión original no está definida cuando \(x=3\). Para cualquier otro valor, al factorizar se obtiene \(x+3=6\), cuya única solución sería \(x=3\), que está excluida. Por tanto, la ecuación no tiene soluciones válidas.

**Racionales de distractores (del generador):**
- B: Considera que la solución obtenida después de cancelar el factor también es válida en la expresión original, sin verificar que el denominador no sea cero.
- C: Resuelve la ecuación equivalente obtenida al multiplicar por el denominador, pero ignora que esa transformación requiere que x sea diferente de 3.
- D: Interpreta incorrectamente los factores de la expresión y cuenta valores no justificados como soluciones.

**Clasificación propuesta (generador — confirmar o corregir)**

- Competencia: Argumentación
- Afirmación: Valida procedimientos y estrategias matemáticas utilizadas para dar solución a problemas.
- Evidencia (afirmada por el generador; verificar con el marco Icfes): El ítem recoge si el estudiante verifica una solución algebraica teniendo en cuenta las restricciones del dominio y detecta cuándo un procedimiento produce un valor no válido en la expresión original.
- Categoría de contenido: Álgebra y cálculo
- Dificultad StudyUs: AVANZADA (escala interna 4; nunca un nivel de desempeño Icfes)
- Idioma / locale: es / es-CO
- Puntos (marks): 1 · tipo: multiple_choice (single_choice)

**Celda Blueprint**

- Solicitada: ARGUMENTACION × ALGEBRA_CALCULO · objetivo `saber.argumentacion`
- Propuesta por el ítem: **ARGUMENTACION × ALGEBRA_CALCULO** · declarada en Blueprint Saber V2.1 (50 posiciones) · coincide con la solicitud

**Validación automática (no es aprobación humana)**

- Resultado: PASS · etapa DETERMINISTIC+ALIGNMENT
- Clave recomputada (MATH): 0
- Hallazgos: EXPLANATION_DOES_NOT_STATE_KEY (WARN), DIFFICULTY_IMPLAUSIBLE (WARN)
- Validador independiente: eligió A, dificultad estimada LOW, distractores implausibles ninguno, alternativas defendibles ninguna

**Puntos de atención (confirmar o descartar; NO son decisiones)**

- [ ] Confirmo · [ ] No confirmo — La opción D parece un distractor débil. `WEAK_DISTRACTOR_D`
- [ ] Confirmo · [ ] No confirmo — Usa delimitadores LaTeX \( \) que el renderizador de ítems no muestra (el estudiante vería el texto crudo). `MATH_DELIMITERS`
- [ ] Confirmo · [ ] No confirmo — La validación automática advirtió que la explicación no enuncia la clave. `EXPLANATION_DOES_NOT_STATE_KEY`
- [ ] Confirmo · [ ] No confirmo — El validador independiente estimó dificultad BAJA; el generador propuso la indicada. ¿La dificultad StudyUs propuesta es razonable? `VALIDATOR_ESTIMATED_EASIER`

**Decisión del revisor (se registra en Admin)**

- [ ] Sí · [ ] No — ANSWER: La clave es correcta y es la única respuesta defendible
- [ ] Sí · [ ] No — DISTRACTORS: Los distractores son plausibles y claramente incorrectos
- [ ] Sí · [ ] No — COMPETENCE: Evalúa la competencia indicada
- [ ] Sí · [ ] No — ASSERTION_EVIDENCE: Corresponde a la afirmación y a la evidencia del marco Icfes
- [ ] Sí · [ ] No — CONTENT_CATEGORY: Corresponde a la categoría de contenido indicada
- [ ] Sí · [ ] No — DIFFICULTY: La dificultad StudyUs (básica / intermedia / avanzada) es correcta
- [ ] Sí · [ ] No — LANGUAGE: Español claro y apropiado para Colombia (es-CO)
- [ ] Sí · [ ] No — SOLUTION: La solución explicada es correcta y completa
- [ ] Sí · [ ] No — ORIGINALITY: Es original: no reproduce ni parafrasea ítems liberados por el Icfes

- Competencia según el revisor: ____ · Contenido: ____ · Dificultad StudyUs: ____ · Respuesta correcta: ____
- Decisión: [ ] HUMAN_APPROVED · [ ] CORRECTION_REQUIRED · [ ] REJECTED

---

## Ítem 9 — AWAITING_HUMAN_REVIEW

**Identidad**

- Candidato: `qb.saber.argumentacion.cd009f77a3` · versión v2 (`b56b9c76-30b2-4c89-a5c6-d2b45f7fbf9b`)
- Batch: Saber 11 Math Calibration 1 · solicitud `saber11-math-2026:calibration-1:ARGUMENTACION:ESTADISTICA`
- Estado del ciclo de vida: PILOT

**Pregunta**

En una encuesta a 50 estudiantes sobre cómo llegan al colegio, 22 respondieron que usan bus, 15 caminan, 8 van en bicicleta y 5 usan motocicleta. Se quiere determinar el porcentaje que llega mediante un medio no motorizado. ¿Cuál procedimiento valida correctamente este porcentaje?

- **A)** Dividir los 15 estudiantes que caminan entre los 8 que van en bicicleta y multiplicar por 100; se obtiene 187,5%.
- **B)** Sumar 15 y 8, dividir el resultado entre 50 y multiplicar por 100; se obtiene 46%.  ← **clave propuesta**
- **C)** Restar 22 y 5 de 50; como quedan 23 estudiantes, el porcentaje es 54%.
- **D)** Sumar 15 y 8 y expresar el resultado como 23%; por tanto, el porcentaje es 23%.

**Clave propuesta:** B

**Solución / explicación:** Caminar y usar bicicleta son los medios no motorizados, así que se suman sus frecuencias: 15 + 8 = 23. Luego se compara esa cantidad con el total de 50 estudiantes: 23/50 × 100 = 46%.

**Racionales de distractores (del generador):**
- A: Compara dos categorías entre sí en lugar de comparar la cantidad de estudiantes con el total de encuestados; además, el resultado no puede representar un porcentaje del total en este contexto.
- C: Calcula correctamente que 23 estudiantes usan medios no motorizados, pero convierte de manera incorrecta esa cantidad en porcentaje al usar el complemento sin dividirlo entre el total.
- D: Confunde la frecuencia absoluta de 23 estudiantes con el porcentaje que representan del total.

**Clasificación propuesta (generador — confirmar o corregir)**

- Competencia: Argumentación
- Afirmación: Valida procedimientos y estrategias matemáticas utilizadas para dar solución a problemas.
- Evidencia (afirmada por el generador; verificar con el marco Icfes): El ítem recoge si el estudiante puede validar la selección de categorías, el denominador y la conversión de una frecuencia en porcentaje para justificar un procedimiento estadístico.
- Categoría de contenido: Estadística
- Dificultad StudyUs: INTERMEDIA (escala interna 3; nunca un nivel de desempeño Icfes)
- Idioma / locale: es / es-CO
- Puntos (marks): 1 · tipo: multiple_choice (single_choice)

**Celda Blueprint**

- Solicitada: ARGUMENTACION × ESTADISTICA · objetivo `saber.argumentacion`
- Propuesta por el ítem: **ARGUMENTACION × ESTADISTICA** · declarada en Blueprint Saber V2.1 (50 posiciones) · coincide con la solicitud

**Validación automática (no es aprobación humana)**

- Resultado: PASS · etapa AI_VALIDATOR
- Clave recomputada (MATH): 23/50*100
- Hallazgos: ninguno
- Validador independiente: eligió B, dificultad estimada LOW, distractores implausibles ninguno, alternativas defendibles ninguna

**Puntos de atención (confirmar o descartar; NO son decisiones)**

- [ ] Confirmo · [ ] No confirmo — La opción A (187,5 %, mayor que 100 %) parece un distractor débil. `WEAK_DISTRACTOR_A`
- [ ] Confirmo · [ ] No confirmo — La etiqueta de habilidad está truncada ("…utilizadas para d"). `SKILL_TAG_TRUNCATED`
- [ ] Confirmo · [ ] No confirmo — El validador independiente estimó dificultad BAJA; el generador propuso la indicada. ¿La dificultad StudyUs propuesta es razonable? `VALIDATOR_ESTIMATED_EASIER`

**Decisión del revisor (se registra en Admin)**

- [ ] Sí · [ ] No — ANSWER: La clave es correcta y es la única respuesta defendible
- [ ] Sí · [ ] No — DISTRACTORS: Los distractores son plausibles y claramente incorrectos
- [ ] Sí · [ ] No — COMPETENCE: Evalúa la competencia indicada
- [ ] Sí · [ ] No — ASSERTION_EVIDENCE: Corresponde a la afirmación y a la evidencia del marco Icfes
- [ ] Sí · [ ] No — CONTENT_CATEGORY: Corresponde a la categoría de contenido indicada
- [ ] Sí · [ ] No — DIFFICULTY: La dificultad StudyUs (básica / intermedia / avanzada) es correcta
- [ ] Sí · [ ] No — LANGUAGE: Español claro y apropiado para Colombia (es-CO)
- [ ] Sí · [ ] No — SOLUTION: La solución explicada es correcta y completa
- [ ] Sí · [ ] No — ORIGINALITY: Es original: no reproduce ni parafrasea ítems liberados por el Icfes

- Competencia según el revisor: ____ · Contenido: ____ · Dificultad StudyUs: ____ · Respuesta correcta: ____
- Decisión: [ ] HUMAN_APPROVED · [ ] CORRECTION_REQUIRED · [ ] REJECTED

---

## Ítem 10 — AUTO_REJECTED (no se revisa)

**Identidad**

- Candidato: `qb.saber.argumentacion.7886fc7487` · versión v2 (`b2328c22-2811-400b-b51d-d43359ce7e03`)
- Batch: Saber 11 Math Calibration 1 · solicitud `saber11-math-2026:calibration-1:ARGUMENTACION:GEOMETRIA`
- Estado del ciclo de vida: REJECTED

**Pregunta**

Una cancha rectangular mide 9 m de ancho y 12 m de largo. Un estudiante afirma que una cuerda de 15 m alcanza exactamente de una esquina a la esquina opuesta porque calculó la diagonal con el teorema de Pitágoras. ¿Cuál procedimiento valida su afirmación?

- **A)** Aplicar Pitágoras: d² = 9² + 12² = 225, así que d = 15 m.  ← **clave propuesta**
- **B)** Multiplicar las dimensiones: d = 9 × 12 = 108 m.
- **C)** Sumar las dimensiones: d = 9 + 12 = 21 m.
- **D)** Restar las dimensiones: d = 12 − 9 = 3 m.

**Clave propuesta:** A

**Solución / explicación:** La diagonal y los dos lados de un rectángulo forman un triángulo rectángulo. Por eso se aplica el teorema de Pitágoras: d² = 9² + 12² = 225 y d = 15 m; la afirmación del estudiante es válida.

**Racionales de distractores (del generador):**
- B: El producto de las dimensiones calcula el área del rectángulo, no la longitud de su diagonal.
- C: La suma de los lados corresponde a recorrer dos lados consecutivos, no a la diagonal del rectángulo.
- D: La diferencia entre las dimensiones no representa la longitud de la diagonal.

**Clasificación propuesta (generador — confirmar o corregir)**

- Competencia: Argumentación
- Afirmación: Valida procedimientos y estrategias matemáticas utilizadas para dar solución a problemas.
- Evidencia (afirmada por el generador; verificar con el marco Icfes): El ítem recoge si el estudiante puede validar una afirmación geométrica comprobando que el procedimiento usado corresponde a la relación entre los lados y la diagonal de un rectángulo.
- Categoría de contenido: Geometría
- Dificultad StudyUs: BÁSICA (escala interna 2; nunca un nivel de desempeño Icfes)
- Idioma / locale: es / es-CO
- Puntos (marks): 1 · tipo: multiple_choice (single_choice)

**Celda Blueprint**

- Solicitada: ARGUMENTACION × GEOMETRIA · objetivo `saber.argumentacion`
- Propuesta por el ítem: **ARGUMENTACION × GEOMETRIA** · declarada en Blueprint Saber V2.1 (50 posiciones) · coincide con la solicitud

**Validación automática (no es aprobación humana)**

- Resultado: REPAIR_REQUIRED · etapa AI_VALIDATOR
- Clave recomputada (MATH): sqrt(9^2+12^2)
- Hallazgos: IMPLAUSIBLE_DISTRACTORS (REPAIR)
- Validador independiente: eligió A, dificultad estimada LOW, distractores implausibles B, C, D, alternativas defendibles ninguna
