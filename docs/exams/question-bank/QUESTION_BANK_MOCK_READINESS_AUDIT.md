# StudyUs Exam Question Bank — Audit de cobertura real y plan ONE_MOCK_READY

Fecha: 2026-10-05 · Rama: `preview/qb-mock-readiness` (base `bf98086`, línea Preview Group 1) · Producción: **no tocada**.

Evidencia: validador `scripts/operations/qb-mock-certification.ts`, ejecutado en transacción `READ ONLY` sobre
DEV (fp `2a29b99ee14a22b4`, ledger 60) y Preview (fp `53d158d5811e7ee0`). Ambos dan el mismo resultado.

```bash
npx tsx --env-file=<env DEV|Preview> scripts/operations/qb-mock-certification.ts [--detail] [--json] [--exam v2.ib.math-aa-sl]
```

---

## 0. Respuesta directa

> **¿Qué exámenes podemos simular realmente de principio a fin hoy?**
>
> **Ninguno como simulacro real.** 0 de 39 versiones declaradas en DEV (0 de 31 en Preview) pasan el gate de certificación.

Hay dos bloqueos independientes. Cualquiera de los dos basta para que un examen falle.

1. **Contenido.** El banco tiene 493 versiones de item.
   - 477 son `DEV_CERT_FIXTURE`: contenido de certificación técnica escrito para probar el motor.
   - 16 son `ORIGINAL` generados por el factory para PAA. De ellos, 3 están en PILOT y el resto REJECTED, SUPERSEDED o REPAIR_REQUIRED.
   - Ninguno es OFFICIAL_LICENSED ni ORIGINAL_HUMAN revisado.
   - **Items certificables para mock: 0.**
2. **Longitud.** Todos los blueprints publicados son de formato reducido. Ejemplos:
   - IB Math AA SL Paper 1: 5 posiciones frente a 80 marks oficiales.
   - PAA: 36 de 175 preguntas.
   - Saber 11 Matemáticas: 12 de 50.

   Ningún blueprint con papers escritos llega a la longitud oficial. Las excepciones aparentes son IB Visual Arts y AICE 9093/9239: alcanzan los marks con un solo ensayo o tarea de portafolio por componente, pero son coursework o ensayo con rúbrica (ver §H).

**Lo que sí funciona de punta a punta** es el pipeline técnico en formato reducido con fixtures, y lo hace en 38 de 39 versiones.
- Pasos que funcionan: ensamblar forma congelada → entregar → corregir (determinista o por rúbrica) → puntuar (RAW, `official=false`) → alimentar readiness y gaps.
- Así está etiquetado: los mocks creados en DEV quedaron `fidelity: REDUCED` / `BELOW_OFFICIAL_SIZE`.
- Sirve como **demo técnica, no como simulacro**.
- La versión 39, «PAA Pilot 2026 v1», está ACTIVE pero no tiene ni items ni scoring policy.

---

## A. Current Bank Inventory

### A.1 Dónde viven las preguntas

| Capa | Tabla | Uso en mocks |
|---|---|---|
| Identidad estable | `question_bank_items` (`exam_version_id`, `assessment_component_id`, `learning_objective_id`, `provenance`, `language`, `cell_key`, `current_version_id`) | sí |
| Versión inmutable | `approved_items`. El contenido completo va en `content` JSONB: stem, stimulus, options, key, `marks`, `parts[]`, `math`, `method`, `rubric`, `portfolio`, `tags`. Las columnas guardan lifecycle, `usage_eligibility`, `exam_alignment` y las dificultades target, validated y calibrated | sí, es lo único que lee el ensamblado |
| Revisión humana | `question_bank_reviews` | gate para que un item generado llegue a ACTIVE |
| Exposición | `exam_item_usage` (`delivery_use` PRACTICE / REDUCED_MOCK / FULL_MOCK) | penaliza la reutilización |
| Telemetría | `question_bank_item_stats` | calibración (vacía en la práctica) |
| Legacy | `question_bank_candidates` / `deliveries` (por estudiante y concepto), `quiz_sessions.questions` | **no** se usan en mocks |

Markscheme, rúbrica, opciones y stimulus **no tienen tabla propia**. Viven en el JSONB y solo los valida Zod (`ApprovedItemContentSchema`, `src/lib/exam-core/items.ts:156`).

### A.2 Inventario real (DEV)

| Origen | lifecycle | n |
|---|---|---|
| FIXTURE (`DEV_CERT_FIXTURE`) | ACTIVE | 426 + 51 legacy sin `content_origin` |
| GENERATED (factory PAA) | PILOT 3 · REJECTED 5 · SUPERSEDED 7 · REPAIR_REQUIRED 1 | 16 |
| OFFICIAL / LICENSED / ORIGINAL_HUMAN | — | **0** |

- Idioma: 340 en inglés y 153 en español.
- Corrección: 436 deterministas (MCQ, numérica con motor de equivalencia, multi-part con markscheme), 40 por rúbrica (double assessor) y 17 de portafolio. Ninguna queda sin clave.
- Calidad estructural: todos los items vivos pasan `validateExamItemStructure`, sin placeholders ni figuras referenciadas inexistentes. Esto lo detecta el validador nuevo.
- Fuente: todos se siembran desde `src/lib/exam-core/verticals/**`. `builders.ts` y `fixture-builders.ts` fuerzan `contentStatus: 'DEV_CERT_FIXTURE'`.

### A.3 Cobertura nominal vs real

- Hay 89 versiones publicadas. 39 tienen la definición ACTIVE: 31 V2 y 8 `dev-cert.*`. Las 50 restantes son IB `v2.ib.s.*` en estado **DRAFT**.
- Las 48 IB structure-only tienen la estructura oficial completa (papers, marks, minutos), una posición por componente, `simulationCapable=false` y **0 items**.
- No existen SAT, ACT, AP, IELTS ni TOEFL. `EXAM_FAMILIES` = PAA, PISA, IB, CAMBRIDGE, AICE, ICFES.
- Solo están en catálogo, sin configuración: 41 de 49 syllabi AICE, casi todo IGCSE salvo 0580, y Saber 11 Lectura crítica, Sociales, Ciencias e Inglés.

### A.4 Hallazgos (P = prioridad)

| # | P | Hallazgo | Evidencia |
|---|---|---|---|
| 1 | P0 | Los fixtures están marcados `exam_alignment = MOCK_READY` y `usage ⊇ FULL_MOCK`. El runtime los considera aptos para mock oficial | backfill M/20261028:112-117 |
| 2 | P0 | Los 8 `dev-cert.*` y «PAA Pilot 2026 v1» están **ACTIVE**, así que aparecen como exámenes soportados | `exam_definitions` |
| 3 | P1 | `target_item_count`, `skill_id`, `command_term_id` y `reasoning_requirement` del blueprint **no restringen** la selección. Los marks tampoco son restricción de slot | `form-assembly.ts:141-148`, `plan.service.ts` |
| 4 | P1 | Un mock se acepta con **un solo** slot lleno. Los slots excluidos achican el denominador del score | `exam-instance.service.ts:197-211`, `scoring-engine.ts:182` |
| 5 | P1 | El F7 `canFullMockBeOffered` considera listo con «≥1 mapping o ≥1 item». No cuenta posiciones ni marks ni longitud | `full-mock-guard.service.ts:11-58` |
| 6 | P1 | Los items del factory y de IA siempre valen `marks: 1`, sea cual sea el examen. El default del schema también es 1 | `prompts.ts:232`, `items.ts:174`, `items.ts:298` |
| 7 | P1 | No hay escala oficial ni grade boundaries en ningún vertical. `cambridge_grade_thresholds` no tiene lector y `score_conversion_models` tiene 0 filas, así que la predicción es siempre NOT_AVAILABLE | `scoring-policy`, `score-projection.service.ts` |
| 8 | P2 | Hay dos vocabularios de origen: `content_origin` GENERATED y `provenance` STUDYUS_GENERATED. No distinguen original humano de original asistido por IA | M/20261020, M/20261026 |
| 9 | P2 | Haber visto un item en práctica es solo un costo (+2) en el ensamblado, no una exclusión dura | `form-assembly.ts:156-167` |
| 10 | P2 | La ruta legacy F9 del FULL_MOCK sin instancia toma items con reglas PRACTICE, incluidos los PILOT | `item-sourcing.service.ts:57` |
| 11 | P2 | AO, topic, skill y competency del item son texto libre en `content.tags`, no FK | `ItemBlueprintTagsSchema` |
| 12 | P3 | `question_type`, `language` y `delivery_use` no tienen CHECK. Tampoco existen `estimated_time` ni `locale` | migraciones |

---

## B. Coverage Matrix (versiones declaradas, DEV)

Leyenda de columnas:
- **Blueprint actual** = posiciones del blueprint frente a la longitud oficial («i» = items, «m» = marks). El valor entre paréntesis es el total de marks que suman los items de la forma reducida.
- **Runtime** = vista STRUCTURAL: lo que el motor arma hoy, con fixtures. El número es la cantidad de formas disjuntas.
- **Certificado** = gate MOCK_READY.

| Familia | Examen / versión | Componentes oficiales | Blueprint actual | Necesario para 1 mock completo | Items certificables | Runtime | Certificado |
|---|---|---|---|---|---|---|---|
| IB | Math AA SL (2021-2028) | P1 80m, P2 80m | 5 / 4 pos. (20m / 13m) | 160 marks | 0 | ONE (1) | **NONE** |
| IB | Math AA HL | P1 110m, P2 110m, P3 55m | 5 / 4 / 1 | 275 marks | 0 | ONE (1) | **NONE** |
| IB | Math AI SL | P1 80m, P2 80m | 3 / 2 | 160 marks | 0 | ONE (1) | **NONE** |
| IB | Math AI HL | 110 / 110 / 55m | 3 / 2 / 1 | 275 marks | 0 | ONE (1) | **NONE** |
| IB | Biology SL / HL (2025) | P1A 30/40 MCQ, P1B 25/35m (4 DBQ), P2 50/80m | 4 / 2 / 2 | 105 / 155 marks | 0 | ONE (1) | **NONE** |
| IB | Chemistry SL / HL | P1A 30/40, P1B 25/35, P2 50/90 | 7 / 2 / 3 | 105 / 165 marks | 0 | ONE (1) | **NONE** |
| IB | Physics SL / HL | P1A 25/40, P1B 20/20, P2 50/90 | 6 / 2 / 3 | 95 / 150 marks | 0 | ONE (1) | **NONE** |
| IB | Visual Arts SL / HL (2027) | 3 componentes de coursework | 1 tarea por componente | — (no es examen) | 0 | TWO (2) | **NONE** |
| IB | 48 asignaturas `v2.ib.s.*` | estructura oficial cargada | 1 pos./comp., sin items | — | 0 | NONE | **NONE** (DRAFT) |
| Cambridge | IGCSE 0580 Extended | P2 100m, P4 100m | 4 / 4 (11m / 16m) | 200 marks | 0 | TWO (2) | **NONE** |
| AICE | 9709 Math AS / A | P1 75, P2/P4/P5 50 · A: +P3 75, P6 50 | 14 / 17 pos. | 225 / 300 marks | 0 | ONE (1) | **NONE** |
| AICE | 9702 / 9701 / 9700 AS | P1 40 MCQ, P2 60m, P3 40m (práctico) | 3 / 2 / 1 | 40 items + 100 marks | 0 | ONE (1) | **NONE** |
| AICE | 9702 / 9701 / 9700 A | AS + P4 100m, P5 30m | 11 pos. | 40 items + 230 marks | 0 | ONE (1) | **NONE** |
| AICE | 9708 Economics AS / A | P1 30 MCQ, P2 60m (A: +P3 30, P4 60) | 6 / 12 | 30–60 items + 60–120 marks | 0 | ONE (1) | **NONE** |
| AICE | 9093 English AS / A | 2 / 4 papers de ensayo, 50m c/u | 2 por paper | 100 / 200 marks (ensayo, rúbrica) | 0 | ONE (1) | **NONE** |
| AICE | 9239 Global Perspectives AS / A | C1 45m escrito, C2–C4 coursework | 3 / 1 / 1 / 1 | C1 45 marks (resto no simulable) | 0 | ONE (1) | **NONE** |
| ICFES | Saber 11 Matemáticas | 50 ítems | 12 | 50 items | 0 | ONE (1) | **NONE** |
| PAA | PAA revisada (guía 2021) | Lectura 45, Redacción 25, Matemáticas 55, Inglés 50 | 10 / 6 / 12 / 8 | 125 (+50 Inglés) items | 0 | ONE (1) | **NONE** |
| PAA | Pilot 2026 v1 (legacy) | sin definición | 1 pos., 0 items, sin scoring | — | 0 | NONE | **NONE** |
| PISA | PISA 2022 (3 dominios) | math 30i, reading y science ? | 8 / 7 / 6 | ver decisión D3 | 0 | TWO (2) | **NONE** |
| * | 8 `dev-cert.*` | sin tamaño oficial | 2–10 pos. | no aplica: deben ocultarse | 0 | ONE (1) | **NONE** |

**Totales para un mock de longitud oficial** de cada versión V2 declarada, deduplicando papers compartidos AS/A:
- **≈435 items de respuesta seleccionada**;
- **≈3 600 marks** de respuesta construida (structured, extended, ensayo), en 77 componentes.

Hoy hay **0** certificables. Las cifras se calculan de las definiciones oficiales cargadas, no de supuestos.

---

## C. Canonical Item Schema

El modelo actual (identidad + versión inmutable + contenido JSONB tipado por Zod + lifecycle + review + exposure) es **sólido y se conserva**. No hay que rediseñarlo. Lo que falta es convertir en campos de primera clase lo que hoy es texto libre o directamente no existe.

| Campo canónico | Hoy | Acción |
|---|---|---|
| item_id / content_version | `question_bank_items.id` / `approved_items.version_number` | ok |
| exam_family, exam_definition_id | derivado vía `exam_version_id → exam_definitions` | ok (vista) |
| syllabus_version | `exam_versions.syllabus_code`, `curriculum_version` | ok |
| component / paper | `assessment_component_id` | ok |
| section (Section A/B dentro del paper) | no existe | **añadir** `section_key` (validado contra `definition.sections`) |
| assessment_objective | `content.tags.assessmentObjective` (texto) | **validar** contra `definition.assessmentObjectives` de la versión |
| topic / concept / subconcept / skill / competency / prerequisites | vía `learning_objective_id` → `objective_{concept,skill,competency}_mappings` (canónico V2) | ok. Item-level `skill_id` opcional |
| command_term | `content.commandTerm` (texto) | **validar** contra `definition.commandTerms` |
| question_type / response_type | `approved_items.question_type` (sin CHECK) / `answerFormat` | **CHECK** con el vocabulario cerrado |
| difficulty / difficulty_evidence | `difficulty` (autor), `target_`, `validated_` y `calibrated_difficulty` + `calibration_confidence` / `sample_size` | ok |
| max_marks | `content.marks` o la suma de `parts[].marks` + method | ok. **Sin default 1 para contenido nuevo** |
| stem, stimulus, options, correct_response | JSONB | ok |
| markscheme | `parts[].math` / `acceptableAnswers` / `method` | ok |
| rubric | `rubric` (ANALYTIC / BEST_FIT) / `portfolio.rubric`. Se exige suma de criterios = marks | ok |
| worked_solution / explanation | `explanation` | ok. **Obligatorio** para certificar |
| calculator_allowed / tools_allowed | `calculator`, `calculatorAllowed`; el componente tiene `tool_rules` | ok |
| estimated_time | no existe | **añadir** `estimated_seconds` (por defecto, derivado del ritmo oficial por mark) |
| language / locale | `language` | **añadir** `locale` (es-MX ≠ es-CO para PAA y Saber) |
| source_type / provenance | `provenance` (OFFICIAL / LICENSED / STUDYUS_GENERATED / FIXTURE) | **migrar al modelo E** |
| validation_status / review_status | `bank_lifecycle_status` / `question_bank_reviews` | ok (mapeo en F) |
| created_by / reviewed_by / AI metadata | columnas + `generation_metadata` | ok |
| mode eligibility | `usage_eligibility[]` | **ampliar** (abajo) |

**Modos de uso.** Hoy existen PRACTICE, DIAGNOSTIC, QUIZ, REDUCED_MOCK, FULL_MOCK y FORMAL_ASSESSMENT. Propuesta:
- Agregar GUIDED_PRACTICE, PAPER_TRAINING, CHECKPOINT, RETENTION y TRANSFER.
- Agregar **`MOCK_RESERVED`**: un item reservado para mock no se sirve en práctica. Es la única forma de garantizar que el estudiante no llega al mock habiendo visto las preguntas.

---

## D. Blueprint Compatibility Contract

El Blueprint dice «necesito una pregunta de estas características» y el banco responde con los items elegibles. Las reglas de construcción viven solo en el blueprint y las preguntas concretas solo en el banco.

```ts
interface BlueprintSlotSpec {           // una posición de la forma
  componentKey: string;                 // paper
  sectionKey?: string;                  // Section A / B
  objectiveIds: string[];               // topic / concept / skill (OR)
  assessmentObjective?: string;         // AO1..AO6
  questionTypes?: string[];             // MCQ, structured, extended...
  marks?: { exact?: number; min?: number; max?: number };
  difficulty?: { min: 1..5; max: 1..5 };
  commandTerms?: string[];
  calculatorPolicy?: 'NONE' | 'ALLOWED' | 'GDC_REQUIRED' | ...;
  language: string; locale?: string;
}
// Banco: eligibleItems(spec, use, studentExposure) -> ItemFacts[]
// Ensamblado: matching máximo (1 item y 1 template por forma) + metas de marks por componente
```

Estado del contrato:
- **Ya implementado:** objetivo, tipo de pregunta y banda de dificultad. Esto lo usan `form-assembly.ts` y el validador nuevo.
- **Falta aplicarlo:**
  - `marks`: hoy la conciliación es por componente, no por slot;
  - `sectionKey`, `assessmentObjective`, `commandTerms`;
  - `count`: hoy cada fila de target es una posición y `target_item_count` se ignora.

  Esto queda para la fase de estructura, sin migración aplicada en este entregable.

---

## E. Content Provenance Model

| Nuevo valor | Viene de | ¿Puede entrar a un mock certificado? | Etiqueta al estudiante |
|---|---|---|---|
| `OFFICIAL_LICENSED` | OFFICIAL / LICENSED + `license_source_id` → `assessment_sources` (`license_status = LICENSED`) | sí | «Pregunta oficial (licenciada)» |
| `ORIGINAL_HUMAN` | nuevo | sí, con review APPROVED | «Contenido original StudyUs» |
| `ORIGINAL_AI_ASSISTED` | STUDYUS_GENERATED | sí, con review humana APPROVED (el trigger ya lo exige) | «Contenido original StudyUs» |
| `SYNTHETIC_FIXTURE` | FIXTURE | **nunca** (solo práctica en DEV y Preview) | — |
| `INTERNAL_TEST` | nuevo | nunca, y tampoco se entrega fuera de E2E | — |

Reglas:
1. «Oficial» solo con licencia trazable. El trigger `question_bank_quality_guard` ya impide `exam_alignment = OFFICIAL` sin provenance OFFICIAL o LICENSED.
2. Ningún contenido de IB, Cambridge, College Board o Icfes se copia. Los items se escriben alineados a las guías públicas, que ya están registradas en `assessment_sources`.
3. **Corrección del backfill (P0 #1):** los items `SYNTHETIC_FIXTURE` deben quedar con `exam_alignment = EXAM_STYLE` y `usage` sin FULL_MOCK. Se acompaña de un CHECK: `FULL_MOCK ⇒ provenance ∉ {SYNTHETIC_FIXTURE, INTERNAL_TEST}`. Es una migración aparte y requiere decisión (D5), porque cambia lo que el runtime ofrece en DEV y Preview.

---

## F. Validation Pipeline

```
Blueprint requirement (celda vacía o escasa)
 → Item specification (slot spec + definición del componente, `componentDefinitionForAI`)
 → generación (humana o asistida por IA)                  DRAFT_AI
 → validación estructural (Zod + validateExamItemStructure) VALIDATING
 → validación de respuesta (la clave es una opción, la rúbrica suma los marks)
 → validación matemática (motor de equivalencia: clave autoconsistente)
 → detección de duplicados (fingerprints semantic / template / reasoning / stimulus)
 → validación de mapeo curricular (objetivo PUBLISHED + concept / skill)
 → validación de examen: AO, command term, marks y tiempo dentro de la definición   ← NUEVO
                                                          VALIDATED → PILOT (solo práctica)
 → gate humano (question_bank_reviews APPROVED, sin autoaprobación) → ACTIVE
 → calibración con respuestas reales                      CALIBRATED
```

Mapeo a los estados pedidos:

| Estado pedido | Estado de lifecycle |
|---|---|
| APPROVED | ACTIVE / CALIBRATED con review APPROVED |
| REJECTED | REJECTED |
| NEEDS_REVIEW | REVIEW_REQUIRED / REPAIR_REQUIRED |
| QUARANTINED | SUSPENDED (ya existe; se usa ante un reporte o una anomalía de stats) |

Todo esto ya está implementado en el factory salvo el paso marcado NUEVO. Hay dos límites para los papers escritos:
- El factory solo genera `single_choice` de 1 mark.
- Está deshabilitado para IB, Cambridge y AICE (`adapters.ts:40-77`).

---

## G. Exam Assembly Validator (implementado)

- **Archivos:**
  - `src/lib/exam-core/question-bank/mock-certification.ts` (puro);
  - `mock-certification-facts.ts` (mapper puro de una fila a hechos);
  - `scripts/operations/qb-mock-certification.ts` (CLI READ ONLY, rechaza Producción);
  - tests en `tests/unit/question-bank-mock-certification.test.ts` (18).
- **Prueba, no conteo.** Hace matching bipartito máximo (posición → item, un template por forma), así que «disponible» significa «asignable a la vez».
- **Profundidad.** Cuenta las formas disjuntas por empaquetado: Mock 1, Mock 2, etc.
- **Dos perfiles:**
  - `STRUCTURAL`: lo que el runtime arma hoy;
  - `CERTIFIED`: el gate MOCK_READY de §J.
- **Salida FAIL:** la lista exacta de lo que falta, con los candidatos bloqueados y su motivo. Ejemplo real:

```
v2.saber11.math  FAIL/NONE
  gate 1 Valid blueprint: math: BLUEPRINT_BELOW_OFFICIAL_LENGTH (12/50 items)
  gate 2 Enough eligible items: math: 5 x saber.formulacion | 3 x saber.argumentacion | 4 x saber.interpretacion
  blocked: DEV_FIXTURE:15
```

- **Estados de cobertura:**

| Estado | Condición |
|---|---|
| NONE | 0 elegibles |
| PARTIAL | algún gate falla |
| ONE_MOCK_READY | 1 forma completa |
| TWO_MOCKS_READY | 2 formas disjuntas |
| PRODUCTION_DEPTH | ≥5 formas disjuntas, parametrizable: Mock 1 + Mock 2 + retake + 2 formas de reserva de práctica |

  La profundidad se calcula por blueprint, no con un número universal.

---

## H. Minimum Bank Plan (ONE_MOCK_READY)

**Paso 0 (estructura, sin contenido).**
- Convertir cada blueprint reducido en un **blueprint de longitud oficial**, construido solo con datos publicados que ya están en `assessment_components.definition`: `officialItemCount`, `maxMarks`, `sections` (p. ej. IB Math Section A/B ≈ 40/40m SL), `distributions` (Saber 11: competencias 23/43/34 %, contenidos 20-35/35-40/35-40 %) y `assessmentObjectives`.
- Mantener el blueprint reducido como variante de práctica.
- Si una distribución no está publicada, el blueprint completo **no se inventa**: se marca como decisión pendiente.

Necesario por examen. La cantidad de items en papers por marks depende de la estructura publicada de cada sección:

| Ola | Examen | Para 1 mock | Notas |
|---|---|---|---|
| 1 | Saber 11 Matemáticas | 50 MCQ (+≈25 de holgura) | distribución publicada; corrección determinista; ES-CO |
| 1 | IB Math AA SL | P1 80m + P2 80m (≈18–22 preguntas multi-part) | markscheme M/A con el motor matemático existente |
| 1 | IGCSE 0580 Extended | P2 100m + P4 100m | ídem |
| 2 | IB Biology / Chemistry / Physics SL→HL | P1A 30–40 MCQ, P1B 4 DBQ, P2 por secciones | escribir HL como superset de SL (el material SL se reutiliza) |
| 2 | IB Math AA HL, AI SL/HL | 160–275 marks | AA HL reutiliza el núcleo SL |
| 2 | AICE 9709 AS→A | 225 → 300 marks | AS es subconjunto de A |
| 3 | AICE 9700 / 9701 / 9702 / 9708 | 30–40 MCQ + 60–230 marks | los papers prácticos (P3) se simulan como «planning / analysis», nunca como laboratorio |
| 3 | AICE 9093, 9239 C1 | ensayos con rúbrica | corrección por double assessor + revisión humana: certificable solo con calibración (≥30 casos) |
| — | PAA | 125 (+50 Inglés) | **bloqueado por decisión**: College Board no publica la distribución por dominio y no se usa la regla proporcional (D2) |
| — | PISA | — | PISA no es un examen individual de forma única (D3) |
| — | IB Visual Arts, AICE 9239 C2–C4, IB `v2.ib.s.*` coursework | — | coursework: soporte de preparación, no mock (D4) |

Profundidad posterior: TWO_MOCKS_READY = ×2 sin solapamiento; PRODUCTION_DEPTH = ×5 más la reserva de práctica por celda.

---

## I. Population Plan

1. **Estructura antes que contenido.** Hacerlo en este orden, con migraciones en DEV primero:
   - provenance canónico (E);
   - corrección del backfill de fixtures;
   - ocultar `dev-cert.*` y «PAA Pilot 2026 v1» del catálogo de estudiantes;
   - `section_key`, `estimated_seconds` y `locale`;
   - validación de AO y command term;
   - blueprints de longitud oficial (H, paso 0);
   - el validador como gate de catálogo: `FULL_MOCK_READY` solo si `certifyBlueprint(..,'CERTIFIED')` da PASS.
2. **Piloto vertical: Saber 11 Matemáticas.**
   - Por qué: MCQ, distribución publicada, factory ya habilitado para ICFES.
   - Producción: el factory genera, se valida, un revisor humano aprueba y el item llega a ACTIVE.
   - Objetivo: ONE_MOCK_READY certificado con el validador, más una E2E manual en Preview.
   - Mide el costo real por item aprobado antes de escalar.
3. **Papers escritos (IB, Cambridge, AICE).**
   - Habilitar un adapter **multi-part con markscheme** en el factory: hoy solo hace single_choice de 1 mark. Así la IA propone el stem, las partes, la clave matemática, los method marks y la worked solution.
   - El revisor es la autoridad. Ese revisor es un docente de la asignatura, no un rol técnico.
   - Empezar por IB Math AA SL y 0580: el motor de equivalencia matemática ya corrige de forma reproducible.
4. **Rúbricas** (ensayos AICE 9093 y 9239 C1, IB P2 Section B extended): exigen casos de calibración del corrector antes de certificar.
5. **Cadencia.** Por ola: generar en DEV → regresión → validador CERTIFIED → congelar SHA → Preview → E2E manual (igual que los Groups del plan maestro). Calidad antes que volumen: una celda nunca se llena con contenido PILOT para alcanzar longitud.

---

## J. Mock Certification

**Gate MOCK_READY=true**, implementado en `certifyBlueprint` con el perfil `CERTIFIED`:

| # | Condición | Cómo se verifica |
|---|---|---|
| 1 | Blueprint válido | publicado, posiciones > 0, componentes simulables, longitud oficial conocida y alcanzada |
| 2 | Suficientes elegibles | matching completo |
| 3 | Respuestas y markschemes | clave determinista o rúbrica con criterios; nada `UNKEYED` |
| 4 | Marks cuadran | suma de marks del item = `maxMarks` oficial por componente; nunca 1 por defecto |
| 5 | Distribución cumplida | cada target asignado |
| 6 | Sin datos inexistentes | sin referencias a figuras o media ausentes |
| 7 | Sin placeholders | sin marcadores, worked solution presente, sin fixtures |
| 8 | Construible de punta a punta | forma completa |
| 9 | Corregible de punta a punta | todo item reproducible (las rúbricas se advierten: double assessor + revisión) |
| 10 | Consumible por scoring | scoring policy válida. Advierte cuando el score no es oficial y cuando la predicción no está calibrada |

**Resultado hoy:** 0 / 39 PASS en DEV y 0 / 31 en Preview. Los gates que fallan en todos son 2, 5 y 8 (sin contenido certificable). Además fallan:
- gate 1 en los blueprints por número de items: PAA, Saber, PISA, P1 de AICE;
- gate 4 en los papers por marks.

### Decisiones que necesito del usuario

- **D1.** ¿Ocultar del catálogo de estudiantes los 8 `dev-cert.*` y «PAA Pilot 2026 v1»? Recomendado: sí.
- **D2.** PAA: ¿con qué fuente se fija la distribución por dominio de un mock completo? Sin ella, PAA se queda en «práctica / mock reducido».
- **D3.** PISA: ¿se declara solo como práctica? Recomendado: sí. PISA es una evaluación muestral con cuadernillos rotados.
- **D4.** Coursework (IB Visual Arts, 9239 C2–C4, componentes IA/EE/TOK): ¿queda fuera del alcance MOCK_READY?
- **D5.** ¿Aplicar la corrección del backfill de fixtures (E.3) en DEV y Preview, aunque deje sin «mock» a las demos actuales?
