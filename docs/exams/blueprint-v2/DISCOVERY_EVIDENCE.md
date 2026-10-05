# StudyUs — Exam Blueprint Engine V2: Discovery Evidence

Snapshot: `bf98086`, rama `preview/exam-eligibility`. Lectura de código y documentos únicamente; no se ejecutó nada contra DEV, Preview ni Producción. Las rutas son relativas a la raíz del repositorio y `M/` = `database/migrations/`.

Una «✔» indica que la afirmación se verificó de nuevo leyendo el código, además del informe del agente que la encontró.

## 1. Curriculum Model

**Taxonomía legacy, por Student**
- `subjects` / `topics` / `subtopics` / `concepts` y `concept_relationships`: `database/baseline/STUDYUS_BASELINE_2026_08.sql` líneas 729, 808, 782, 302 y 278.

**Catálogo canónico (F4)**
- Origen: `M/20260922_1000_f4_learning_architecture_2.sql`.
- `canonical_subjects` (:21), `canonical_concepts` (:37), `skills` (:52), `competencies` (:63, C1–C10 sembradas en :159-171).
- `canonical_concept_prerequisites` (:115).
- `concept_catalog_mapping` (:125), con *trigger* de unicidad en `M/20261018_1400…:100-122`.

**Estructura F6**
- Origen: `M/20260924_1000_f6_curriculum_standards_mapping.sql`.
- Cadena: `academic_organizations` (:18) → `academic_programmes` (:29, `programme_type` en :37) → `academic_qualifications` (:43) → `academic_subjects` (:52) → `structure_versions` (:70, un único PUBLISHED por subject en :83) → `structure_nodes` (:91) → `learning_objectives` (:130).
- Mappings: `objective_{concept,skill,competency}_mappings` (:147, :180, :209).

**Capa de autoridad**
- `M/20261018_1500…:60-71`.
- Los organismos se clasifican por nombre con `ILIKE` en `:73-76` y en `src/lib/curriculum/catalog-classification.service.ts:34-41`.

**Etapas**
- `academic_programmes.stage` es texto libre.
- `grade_min` / `grade_max` se asignan por nombre exacto de programa en `M/20261030…:72-108`.
- No existe ninguna entidad de etapa.

**Lado institución**
- `grades` (`M/20261018_1700…:31-37`).
- `classes.institution_curriculum_id` (`…1500:153`).
- `institution_curricula` (`…1400:125`, `…1500:90-118`).
- `class_exam_assignments` (`M/20261029…:21-43`).

**Academic Profile (Phase A)**
- Esquema: `M/20261030…:32-57`.
- Servicio: `src/services/academic-profile-catalogue.service.ts` (catálogo solo CURRICULUM en :65-78; validación en :145-218).

**Estado del aprendiz**
- Se indexa por (student, concept): `learning_evidence`, `mastery_records`, `concept_knowledge_state`, `concept_memory_state`, `concept_transfer_state`; además `learner_skill_state` y `learner_competency_state` (F5).
- Ninguna de estas tablas tiene columna de grado, año o currículo, y nada se reinicia por año.

**✔ El cargador de exámenes escribe en el currículo** (`src/lib/exam-core/apply-vertical-config.service.ts`)
- :95-114 hace *upsert* de organización, programa, cualificación y subject.
- :181 crea `structure_versions` con `source_locator 'exam-vertical-config:<key>'`, en estado PUBLISHED si no había ninguna.
- :189 crea `structure_nodes` de tipo `EXAM_SECTION`.
- :231 crea `learning_objectives`.

**IB sin mapear**
- Ocurre porque los subjects que crea el cargador no tienen `canonical_subject_id`.
- `src/lib/institution/curriculum-management.service.ts:96` hace `JOIN canonical_subjects` (*inner join*) y por eso los oculta.
- La cifra «48» no aparece documentada en ningún archivo del repositorio; procede de la memoria de la sesión de Curriculum V2.

**Duplicaciones**
- Cuatro modelos de subject (`subjects`, `canonical_subjects`, `academic_subjects`, `assessment_structure_nodes` de tipo SUBJECT) más `SUBJECT_CATALOG`, con 22 entradas en `src/lib/experience/subject-catalog.ts:35-58`.
- Dos taxonomías de concepto (legacy y canónica).
- El nivel se guarda en tres lugares.
- Dos tablas de propuestas.

## 2. Exam / Assessment Model

**Tablas F7** (`M/20260925_1000_f7_assessment_framework_engine.sql`)
- `exam_definitions` (:18; `exam_family` es texto sin CHECK).
- `scoring_models` (:32).
- `exam_versions` (:43; un único PUBLISHED por definición en :62).
- `assessment_components` (:67).
- `command_terms` (:105; `term` UNIQUE global).
- ✔ `assessment_blueprints.exam_version_id NOT NULL UNIQUE` (:119).
- `blueprint_component_allocations` (:125) y `blueprint_objective_targets` (:138).
- `approved_items` (:175), `student_exam_profiles` (:194), `preparation_goals` (:213), `institution_exam_policies` (:226), `exam_attempts` (:259), `exam_attempt_item_responses` (:276).

**Extensiones Track B**
- `M/20261019`: `config_key`, `exam_year`, `exam_session` (texto) y `exam_attempt_results` (:102).
- `M/20261020`: `assessment_structure_nodes` (:48); columnas V2 de versión (:84-91); columnas V2 de componente (:92-97); `exam_instances` (:128); `exam_response_assessments` (:176); `exam_item_usage` (:305); calibración (:317, :333).
- `M/20261024`: `cambridge_results` y `cambridge_grade_thresholds` (:69-82).

**Readiness y conversión (F9)**
- `M/20260927`: `readiness_policy_versions` (:29), `readiness_snapshots` (:45), `score_conversion_models` (:76, sembrada con cero filas), `simulation_plans` (:91), `simulation_attempts` (:108).

**Tipos TypeScript**
- `ExamVerticalConfig`: `src/lib/exam-core/vertical-config.ts:56-163`.
- `ComponentDefinition` y `FrameworkVersioning`: `component-definition.ts:10-58`.
- `ScoringPolicy`: `scoring/scoring-policy.ts:54-108`.
- Las filas F7 se tipan en `src/lib/assessment/types.ts`, pero `AssessmentComponent` no incluye las columnas V2.

**Taxonomías de examen**
- ✔ `EXAM_FAMILIES`: `taxonomy.ts:14`.
- `ObjectiveFramework`: `objectives/objective-catalog.ts:29`.
- `CatalogFamily`: `catalog/structure.ts:49`.

## 3. Scoring

**Pipeline actual**
1. Calificación del ítem: `item-grading.ts:325`.
2. Persistencia de la respuesta: `assessment/evaluation.service.ts:28`.
3. Puntuación del intento: `results.service.ts:226`.
4. Agregación del conjunto: `scoring-engine.ts:161`, con la estrategia en :274-309 y la transformación en :121-152.

**Ponderaciones**
- Solo hay ponderación por componente con `SECTION_WEIGHTED` + `sectionWeights`.
- `weighting_percent`, `definition.weightingPercent` y `blueprint_component_allocations.weight` no se usan nunca.
- Todas las configuraciones V2 usan `strategy: 'RAW'` con transformación `NONE`.

**Defaults de marks: todos valen 1; no existe ningún «MCQ = 2»**
- `items.ts:174` y `:298` (los ítems de IA siempre llevan 1).
- `question-bank/prompts.ts:232`.
- `scoring-policy.ts:67` y `scoring-engine.ts:108-111`.
- `result-view.service.ts:231` (además omite los method marks).
- `question-bank/cells.ts:126` y `health.service.ts:172`.
- Los «2» que aparecen en las configs son `count`, es decir, número de posiciones.

**Notas oficiales**
- ✔ IB: `src/lib/ib.ts:102-110` usa los umbrales inventados `[45,55,65,73,81,89]`; las bandas MYP están en :117-126. Se consumen en `src/app/api/quizzes/generate-and-take/route.ts:2338-2342` y se muestran en `src/app/dashboard/quiz/page.tsx:2078-2090`.
- AICE: los puntos y bandas están en código (`aice/policy.ts:54-60`), con tres reglas marcadas `confirmed:false` (:62-64).
- PAA: `NO_OFFICIAL_SCALE` (`v2/paa.ts:212`).
- Saber 11: la escala 0–100 solo aparece en comentarios; 0–500 solo en `docs/exams/v2/sources/pisa-saber-paa-cambridge.json:51-52`.

**Unidades e i18n**
- La interfaz muestra los marks como «puntos»: `src/lib/i18n/messages.ts:3336, 3360-3361, 3423, 3752`.
- AICE declara `unit:'marks'` aunque el valor es un porcentaje: `verticals/v2/aice/builder.ts:146`.

**Otros defectos**
- `zeroCriteria` ignora los method marks: `results.service.ts:144`.
- `verifyAttemptResultReproducible` produce falsos negativos en planes antiguos: `results.service.ts:344-345`.

## 4. Blueprint, ensamblaje y Question Bank

**Posiciones**
- Cada fila de `blueprint_objective_targets` es una posición. `apply-vertical-config.service.ts:235-242` expande `count: N` en N filas.
- `target_item_count` nunca se lee.

**Elegibilidad de ítems en tres capas**
1. SQL: `lifecycleSqlFor`, `question-bank/lifecycle.ts:176-184`.
2. Uso: `exam-instance.service.ts:136-140`.
3. Filtro por posición: `form-assembly.ts:141-148`.
- Existe además una variante pura, `isEligible` (`lifecycle.ts:165-173`).
- Ninguna capa filtra por command term, AO, skill o idioma.

**Celdas**
- Clave: `sectionKey|objectiveCode|questionType|dmin-dmax|commandTerm` (`question-bank/cells.ts:64-66`).
- Para la longitud completa se aplica la regla proporcional (`cells.ts:118-135`); `fullLengthDeliverable` está en :139-141.

**Ensamblaje**
- El costo y la novedad son blandos (`form-assembly.ts:156-167`); la semilla es el id de la instancia (`exam-instance.service.ts:199`).
- La dificultad solo apunta a la media (`form-assembly.ts:28-33`). `target_difficulty_index` se escribe pero nunca se lee, y `calibrated_difficulty` no llega al ensamblaje.

**Mock 1 / Mock 2**
- No existe la noción de serie: cada mock es una instancia nueva.
- `maxOverlapBetweenFullForms = 0.2` (`policy.ts:174`) solo lo usa `health` (`health.ts:245-266`).

**Ruta legacy FULL_MOCK**
- Usa elegibilidad de PRACTICE y *fallback* a IA: `item-sourcing.service.ts:92-159`, invocado desde `src/app/api/simulation/attempts/route.ts:86`.

**Acoplamiento con la UX**
- Cadenas en español dentro de `health.ts:411-455`.
- `demand.service.ts:54-87` lee el estado del aprendiz.
- `items.ts:432-488` contiene i18n del cliente.

**Readiness del catálogo**
- `catalog/readiness.ts:26-100`.
- Modo SHADOW/ENFORCE leído de una variable de entorno: `question-bank/policy.ts:91`.

## 5. Elegibilidad, preparación y readiness

**Resolución de elegibilidad**
- `eligibility.service.ts:19-30`, `graph.ts:31-62`, `academic-context.ts:44-131`, `rules.ts:77-197`.
- ✔ `ASSESSMENT_ELIGIBILITY_RULES` y `FRAMEWORK_FOLLOWS`: `rules.ts:112-125`.
- `ObjectiveEligibility` no tiene campo de confianza.

**Normalización de grado**
- `grade-level.ts:51-70`, con casos codificados para MX, CO, IB, US y DE.
- El `grade_level` almacenado en el perfil no se usa para elegibilidad.

**Segundo resolutor de contexto**
- `src/lib/learning-plan/curriculum.service.ts:111-145` reconoce IB con la expresión regular `/IB/i` (:141).

**Preparación objective-first**
- `objectives/preparation.service.ts` (crea en :161-217, diagnostica en :440-491).
- `objectives/preparation-plan.ts:133-148` es específico de cada examen. ✔ Coincide con la regla acordada.

**Fugas entre exámenes**
- ✔ `learning-plan/exam-bridge.service.ts:40-92` (`deriveExamGaps`): filtra por student, intento COMPLETED y resultado no invalidado, pero no por perfil ni por examen. Se consume en :270 y :311.
- `readiness/readiness.service.ts:32-58`: SIMULATION_PERFORMANCE se calcula por student + versión.
- `diagnostics/evidence-gate.service.ts:13-21`: toma toda la evidencia del concepto, sin importar el examen.

**Tres sistemas de readiness**
- Catálogo: `readiness-overlay.ts`.
- F9: `readiness/*`.
- Legacy: `src/services/exam-readiness.service.ts:81-91`, servido por `/api/exam-readiness/score`.
- `docs/EXAM_READINESS.md` solo describe el legacy.

**Proyección de puntaje**
- `readiness/score-projection.service.ts:11-17` únicamente informa si hay proyección disponible; nunca calcula un valor.

**Contratos con la UI**
- `/api/exam-preparation/*`, `/api/exams/instances/*`, `/api/simulation/attempts/*`, `/api/readiness/*`, `/api/student/exam-prep/[id]/plan`.
- Las formas de cada respuesta se detallan en el informe del agente de elegibilidad.

**Suites que protegen los flujos actuales** (cifras declaradas en los documentos)
- Escenarios: exam-eligibility 55/55, objective-first 61/61, exam-profile 24/24, domain-curriculum 19/19.
- Regresiones: V2 90, V1 203, delete 21, AICE+PISA 45.
- Unit: 7498/7498 en `bf98086`.
- Ningún test protege la regla de que la evidencia es específica de cada examen.

## 6. Verticales

**Recuento de configuraciones**
- V1 DEV_CERT: 8 (`verticals/index.ts:16-25`).
- V2 con banco: 30 = 12 IB + PISA + Saber + PAA + 0580 + 14 AICE (`v2/index.ts:36-39`).
- IB solo estructura: 50 (`catalog/ib-dp.ts:186-197`).
- Total aplicado por `scripts/operations/track-b-v2-apply.ts`: 80.
- Retiradas: `v2.paa.math`, `v2.pisa.math`.

**PAA**
- Definición: `v2/paa.ts`. Formulario reducido de 36/175 ítems (:223-258); unidad `NO_OFFICIAL_SCALE` (:212).
- Hechos de catálogo codificados `{minutes:180, items:175}` en `catalog/structure.ts:153`.
- Elegibilidad limitada a MX/PR en `rules.ts:114`.
- Los seeds F6–F8 colocan PAA bajo «ICFES» (`scripts/operations/f6-seed-pilot-dataset.ts:55-56`).

**Saber 11**
- Definición: `v2/saber11-math.ts`. Solo Matemáticas, con duración `null` (no publicada).
- El resto de pruebas son nodos sin binding (`structure.ts:136-139`).

**PISA**
- Definición: `v2/pisa-2022.ts`. Solo Matemáticas tiene `officialItemCount`.

**IB**
- Datos generados en `catalog/ib-dp.generated.ts`, con fuentes en `docs/exams/v2/sources/ib-dp-*.json`.
- Math AA HL está tecleado a mano en `v2/ib-math-aa-hl.ts:84-155`.
- La IA (*internal assessment*) existe como dato y nunca se simula.
- La matriz TOK/EE solo existe en el JSON fuente (`ib-dp-groups-1-3-core.json:2004`).

**Cambridge**
- 0580 en `v2/cambridge-0580.ts`.
- AS/A en `v2/aice/builder.ts`, alimentado por `aice-syllabi.generated.ts`.
- No hay datos de Checkpoint, Lower Secondary ni Primary.

## 7. Documentación frente a código

**Incoherencias**
- `EXAM_V2_DEV_READINESS_REPORT.md:60` declara IB «FULL_MOCK_READY»; el código y la matriz dicen REDUCED. Solo Visual Arts está completo.
- `EXAM_VERTICAL_MATRIX.md` está desactualizado respecto a AICE.
- `EXAM_ARCHITECTURE_V2_IMPLEMENTATION.md` §3 sigue citando configuraciones retiradas.
- El reporte objective-first queda superado por el filtrado de elegibilidad.
- No hay especificación escrita de elegibilidad, Academic Profile ni `class_exam_assignments`.

**Decisiones vigentes**
- PAA_FULL_MOCK = NO; PAA_FULL_LENGTH_MOCK = NOT_AVAILABLE.
- La readiness del QB permanece en SHADOW.
- Sin transformaciones oficiales de puntaje.
- OFFICIAL_CONTENT_COVERAGE = 0 %.
- E2E manual de PAA, IB, PISA, Saber y Cambridge: NOT DECLARED.

**Marca**
- «StudyUS» aparece en 81 archivos de `src` y `docs/exams`. Una parte es texto de catálogo con huella que el codemod de marca excluye a propósito; corregirlo requiere una nueva versión de la configuración.
