# StudyUs — Exam Blueprint Engine V2 (especificación)

| Campo | Valor |
|---|---|
| Estado | **DRAFT — Discovery + Domain Model + Gap Analysis.** No hay código ni migraciones. |
| Rama | `design/exam-blueprint-engine-v2` (worktree `studyos-blueprint`), desde `bf98086` (`preview/exam-eligibility`: Exam V2 + QB V2 + Curriculum V2 + Eligibility + Academic Profile) |
| Entornos | Ninguno tocado. No se leyó ni se escribió ninguna base de datos. Producción y `main` quedan intactos. |
| Evidencia | [`DISCOVERY_EVIDENCE.md`](DISCOVERY_EVIDENCE.md): mapa con referencias `archivo:línea` |
| Regla de contenido | Ninguna regla oficial nueva. Lo que no esté respaldado por una fuente registrada (`assessment_sources`) se marca **UNKNOWN / TBD**. |

**Índice:** A. Current State · B. Gap Analysis · C. Canonical Domain Model · D. Exam Resolution Logic · E. Blueprint Contract · F. Versioning · G. Longitudinal Mapping · H. Vertical Validation · I. Migration Plan · J. Implementation Plan · K. Decisiones pendientes

---

## Resumen ejecutivo

1. **No hay que reconstruir.** StudyUs ya tiene casi todas las piezas de un Blueprint Engine:
   - un Exam Core genérico, sin rutas de código por familia;
   - `ComponentDefinition` con fuentes;
   - versionado con huella (*fingerprint*) e inmutabilidad;
   - formularios congelados por intento;
   - un motor de scoring declarativo;
   - un Question Bank con ciclo de vida, `usage_eligibility` y `exam_alignment`;
   - elegibilidad con razones, Academic Profile y asignación de exámenes por clase.

   V2 consolida y extiende lo existente; no lo reemplaza.
2. **Hay seis brechas estructurales que impiden cumplir los criterios de aceptación** (detalle en §B):
   - **G1** El scoring tiene una sola etapa, y todas las configuraciones V2 usan `RAW`: los pesos oficiales por Paper se ignoran.
   - **G2** No existen *sessions* ni *grade boundaries* conectados. Las tablas existen, pero nadie las lee.
   - **G3** Solo puede haber un Blueprint por versión de examen.
   - **G4** No existen etapas, trayectorias ni reglas de elegibilidad como datos: están en código (`rules.ts`).
   - **G5** El cargador de exámenes escribe la estructura curricular (Curriculum ≠ Exam se viola en los datos).
   - **G6** Hay fugas de evidencia entre exámenes en el plan de Track A y en la readiness F9, lo que contradice la regla ya acordada de que la evidencia es específica de cada examen.
3. **Modelo propuesto:** seis capas con contratos estables — Curriculum, Assessment, Blueprint, Instance, Learner y Pathway — más un **Scoring Pipeline por etapas con unidades tipadas**: marks → component → weighted → scaled → grade → qualification points.
4. **Plan:** 10 bloques pequeños, aditivos y reversibles (BP-0 … BP-9). Cada uno tiene paridad en SHADOW contra el comportamiento actual antes de activarse, y ningún bloque rompe un flujo Student existente.

---

## A. Current State

### A.1 Mapa de arquitectura actual

```
                        CURRICULUM (qué aprender)                                 LEARNER
 academic_organizations ─► academic_programmes ─► academic_qualifications       student_academic_profile (Phase A)
   (country, source_type)     (programme_type: CURRICULUM |                       student_academic_subjects
                               ASSESSMENT_FRAMEWORK | ADMISSION_EXAM,           class_enrollments ─► classes ─► institution_curricula
                               stage text, grade_min/max)
        └─► academic_subjects (level text, canonical_subject_id)                 learning_evidence / mastery / memory /
              └─► structure_versions (1 PUBLISHED/subject) ─► structure_nodes     transfer  ← clave (student, concept)
                    └─► learning_objectives ─► objective_{concept,skill,          sin grado ni año: nunca se resetea
                          competency}_mappings ─► canonical_concepts/skills/
                          competencies (F4) + canonical_concept_prerequisites

 ⚠ apply-vertical-config ESCRIBE organizations/programmes/subjects/structure_versions/
   structure_nodes(EXAM_SECTION)/learning_objectives a partir de cada config de examen

                        EXAM / ASSESSMENT (cómo se evalúa)
 EXAM_FAMILIES (TS enum: PAA PISA IB CAMBRIDGE AICE ICFES)   ObjectiveFramework (TS: PAA PISA SABER11 IB_DP CIE_*)
 exam_definitions (config_key, academic_programme_id, academic_subject_id, exam_family text)
   └─► exam_versions (version_label, exam_year, exam_session TEXT, syllabus_code, first/last_assessment,
         │            navigation_rules jsonb = delivery+fingerprint+routes+reporting, scoring_model_id)
         ├─► scoring_models.config = ScoringPolicy v1 (1 etapa: strategy → transform sobre fracción 0..1)
         ├─► assessment_components (definition jsonb, max_marks, weighting_percent, calculator_policy)
         ├─► assessment_blueprints (UNIQUE exam_version_id)  ─► blueprint_component_allocations
         │                                                  ─► blueprint_objective_targets (1 fila = 1 posición)
         ├─► score_conversion_models (0 filas, solo gate de disponibilidad)
         └─► assessment_structure_nodes (catálogo navegable, 19 tipos, readiness por nodo)
 cambridge_grade_thresholds (vacía, sin lectores) · aice/policy.ts (puntos AICE en código)

                        INSTANCES / RESULTS
 exam_instances (mode PRACTICE|MOCK|CHALLENGE, form jsonb congelado, seed = instance.id)
   └─► simulation_attempts 1:1 exam_attempts (frozen_configuration) ─► exam_attempt_item_responses
         └─► exam_attempt_results (raw, final, section/objective results, provenance hash)
 Ruta legacy F9: /api/simulation/attempts (ítems resueltos en vivo, fallback IA)

                        QUESTION BANK
 question_bank_items (identity, cell_key) ─► approved_items (versiones; content.marks, rubric, parts;
   bank_lifecycle_status, usage_eligibility[], exam_alignment, 6 dificultades) ─► exam_item_usage
 health/demand → generation_requests (factory: solo PAA/PISA/ICFES, solo selected-response)

                        ELIGIBILITY / PREPARATION / READINESS
 eligibility/{graph,academic-context,rules}.ts → ObjectiveEligibility{eligible, reasons[], rank}
 class_exam_assignments (objective_key texto) · student_exam_profiles (objective_key, source)
 Readiness: (A) catálogo/plataforma SHADOW|ENFORCE · (B) F9 learner snapshots · (C) legacy 40/30/20/10
 Planes: objective-first buildPreparationPlan (exam-specific) vs Track A getExamPreparationPlan (cross-exam ⚠)
```

### A.2 Inventario de verticales

| Vertical | Configs vivas | Estructura | Escala / nota oficial modelada |
|---|---|---|---|
| IB DP | 12 con banco + 50 solo estructura (DRAFT) | Paper / IA por asignatura y SL/HL; TOK/EE como estructura | **No.** Solo % RAW. `ib.ts` estima la nota 1–7 con umbrales inventados (quiz V1). |
| Cambridge IGCSE | `0580-extended` | P2 + P4; Core solo como hecho de catálogo | No |
| Cambridge AS/A + AICE | 14 (7 sílabos × AS/A) | Componentes, rutas y AOs desde datos generados | Notas de asignatura ingresadas por el Student; puntos AICE en código; thresholds sin uso |
| Cambridge Checkpoint / Lower Secondary / Primary | **ninguna** | — | — |
| PAA | `v2.paa` (formulario reducido 36/175) | 4 secciones, conteos oficiales | 200–800 solo en comentarios → `NO_OFFICIAL_SCALE` |
| ICFES Saber 11 | `v2.saber11.math` (solo Matemáticas) | 1 prueba; las otras 4 son nodos sin binding | 0–100 y 0–500 solo en comentarios o JSON fuente |
| PISA 2022 | `v2.pisa.2022` | 3 dominios | Sin puntaje individual (por diseño) |
| SAT, EXANI, UNAM, TOEFL, ENEM, AP… | ninguna | — | — |

### A.3 Qué funciona y se reutiliza tal cual

| Activo | Dónde | Por qué se conserva |
|---|---|---|
| Exam Core genérico | `src/lib/exam-core/vertical-config.ts`, `apply-vertical-config.service.ts` | Ya cumple «cada examen es datos, sin rutas de código por familia» |
| `ComponentDefinition` + `FrameworkVersioning` + fuentes | `component-definition.ts`, `catalog/sources.ts` | Duración, marks, peso, calculadora, formatos, AOs y distribuciones, con fuente y limitaciones |
| `assessmentRoutes` | `vertical-config.ts:99-111` | Ya modela combinaciones como Cambridge P1+P2, P1+P4… |
| Guardas de procedencia | `scoring-policy.ts:83`, `vertical-config.ts:129` | Un fixture nunca puede declararse oficial |
| `NO_OFFICIAL_SCALE` / `NO_SCORING_POLICY` | `vertical-config.ts:83-91`, `scoring-policy.ts:111` | Estados reales: nunca se cae en una fórmula por defecto |
| Inmutabilidad y huella | `navigation_rules.configFingerprint`, `CONFIG_CHANGED_FOR_EXISTING_VERSION` | Base del versionado V2 |
| Formulario congelado + `frozen_configuration` + `scoring_policy_hash` | `exam-instance.service.ts`, `exam-attempt.service.ts:40-53` | Reproducibilidad por intento |
| Calificación determinista primero, doble assessor, calibración | `item-grading.ts`, `double-assessor.service.ts`, `calibration.ts` | Marking Model a nivel de ítem |
| Ciclo de vida del QB + revisión humana + `usage_eligibility` + `exam_alignment` | migraciones `20261026` y `20261028` | Base del contrato Bank ↔ Blueprint |
| Resolutor de elegibilidad puro con razones y rank | `eligibility/rules.ts`, `academic-context.ts`, `graph.ts` | Base de `resolveExamPath` |
| Academic Profile ligado al catálogo, `class_exam_assignments` | migraciones `20261029` y `20261030` | Entradas institucionales e independientes |
| Learner state por concepto canónico, sin reset anual | F4/F5 | Ya es longitudinal: solo faltan los periodos |
| Plan objective-first exam-specific | `objectives/preparation-plan.ts:133-148` | Implementa correctamente la regla de evidencia por examen |
| Política AICE como datos con `confirmed:false` | `aice/policy.ts` | Patrón para las reglas de cualificación |

---

## B. Gap Analysis

Prioridad: **P0** bloquea un criterio de aceptación · **P1** riesgo de corrección o de deuda que el diseño debe resolver · **P2** completitud · **P3** higiene. La columna «Crit.» indica los criterios de aceptación afectados (1–15).

| ID | Pri | Brecha | Evidencia | Crit. |
|---|---|---|---|---|
| G1 | P0 | **Scoring de una sola etapa.** La transformación se aplica a una fracción 0..1. Las 80 configuraciones V2 usan `RAW` + `NONE`. Un Mock multi-Paper suma marks crudos e ignora `weighting_percent`, y `blueprint_component_allocations.weight` nunca se usa. No hay etapas marks → component → weighted → grade → points. | `scoring-engine.ts:121-152, 274-309`; `scoring-policy.ts:54-108` | 9, 10 |
| G2 | P0 | **Sin sessions ni boundaries.** `exam_session` es texto libre. `cambridge_grade_thresholds` y `score_conversion_models` existen, pero ningún código las lee. No hay notas IB 1–7, ni A*–G, ni 200–800, ni 0–500. | migración `20261024:69`; `score-projection.service.ts:11-17` | 5, 10 |
| G3 | P0 | **Un Blueprint por versión** (`assessment_blueprints.exam_version_id UNIQUE`). No pueden coexistir Full Mock, Reduced Mock, Diagnostic y Paper Practice. Un PAA de 175 posiciones exigiría una versión de examen nueva. | `f7…sql:117-150` | 6, 7, 8 |
| G4 | P0 | **Sin etapas ni trayectorias.** Las reglas de elegibilidad están en código: `ASSESSMENT_ELIGIBILITY_RULES` (Saber 11 CO 10–11; PAA solo MX/PR 10–12; PISA 9–10) y `FRAMEWORK_FOLLOWS`. La etapa es texto libre y no hay calendario de evaluaciones (checkpoints, mocks, finales). | `rules.ts:112-125`; `academic_programmes.stage` | 1, 3, 11 |
| G5 | P0 | **Curriculum ≠ Exam violado en datos.** `apply-vertical-config` crea `structure_versions` y `structure_nodes(EXAM_SECTION)` y `learning_objectives` desde los objetivos del examen. Para IB, Cambridge y PAA, el «currículo» publicado es la forma del examen. Además, `academic_programmes` mezcla CURRICULUM con ADMISSION_EXAM y ASSESSMENT_FRAMEWORK, y la taxonomía marca IB/Cambridge como `programmeType: 'CURRICULUM'` a nivel de familia de examen. | `apply-vertical-config.service.ts:95-114, 174-230`; `taxonomy.ts:30-35` | 4 |
| G6 | P0 | **Fuga de evidencia entre exámenes.** (a) El plan de Track A `deriveExamGaps` usa las brechas de **todos** los exámenes, sin filtrar perfil, archivados ni ocultos: una brecha PAA marca NEEDS_REINFORCEMENT en PISA. (b) Las dimensiones F9 KNOWLEDGE, COVERAGE y SUFFICIENCY usan toda la `learning_evidence` del concepto. (c) SIMULATION_PERFORMANCE se agrega por student+version, así que sobrevive a un *restart* del perfil. | `exam-bridge.service.ts:40-92, 270`; `evidence-gate.service.ts:13-21`; `readiness.service.ts:32-58` | 14, 15 + regla de memoria |
| G7 | P1 | **Predicado de elegibilidad de ítem repartido en 4 lugares**: target, `lifecycleSqlFor`, `assembleForm` y `isEligible`. No se filtra por command term (aunque forma parte del `cell_key`), AO, skill, `reasoning_requirement` ni idioma. `validated_difficulty` y `calibrated_difficulty` no alimentan el ensamblaje. | `lifecycle.ts:165-184`; `form-assembly.ts:141-148`; `cells.ts:64` | 8, 13 |
| G8 | P1 | **Mock 1 y Mock 2 solo se distinguen por novedad blanda** (penalización de costo). No hay series, ordinal, exclusión dura ni «mismo formulario para la cohorte». | `form-assembly.ts:156-167, 216`; `policy.ts:174` | 7 |
| G9 | P1 | **Tres taxonomías de familia**: `EXAM_FAMILIES`, `ObjectiveFramework` y `CatalogFamily` (ICFES ≡ SABER11). Los nombres son inconsistentes: los seeds F6–F8 ponen PAA bajo «ICFES» e IGCSE como «Lower Secondary»; la clave del grupo AICE difiere entre V1 y V2. | `taxonomy.ts:14`; `objective-catalog.ts:29`; `f6-seed-pilot-dataset.ts:55,66` | 12 |
| G10 | P1 | **Reglas académicas inventadas en un flujo vivo.** `estimateDPGrade` usa los umbrales [45,55,65,73,81,89] y `estimateMYPBand` también es inventado; se muestran como «Nota estimada X/7» en el quiz V1. El «predicted score» legacy 0–100 no está marcado como no oficial. | `ib.ts:102-126`; `generate-and-take/route.ts:2338-2342`; `exam-readiness.service.ts:87-91` | 10 + restricción |
| G11 | P1 | **Unidades ambiguas.** i18n muestra marks como «puntos» o «pts»; AICE V2 usa `unit:'marks'` con un valor que en realidad es %. No existe un tipo de unidad por etapa. | `messages.ts:3336,3360,3423,3752`; `aice/builder.ts:146` | 10 |
| G12 | P1 | **Marks por defecto = 1 para ítems generados por IA o por la factory**: `items.ts:298`, `prompts.ts:232`. Correcto para PAA MC por dato de la config; incorrecto si se generan ítems IB o Cambridge. Los marks deben venir de la especificación de marks de la celda. No existe un default «MCQ = 2». | `items.ts:174,298`; `scoring-engine.ts:108-111` | 9 |
| G13 | P1 | **Banco acoplado a UX**: health devuelve strings en español; demand lee learner state; i18n del cliente vive en `items.ts`. La ruta legacy FULL_MOCK usa elegibilidad PRACTICE (pueden entrar ítems PILOT o de IA en un «mock»). | `health.ts:411-455`; `demand.service.ts:54-87`; `item-sourcing.service.ts:153` | 13 |
| G14 | P1 | **Dos resolutores de contexto académico**: eligibility (`buildAcademicContext`) vs learning-plan (`resolveCurriculumContext`, que usa la regex `/IB/i` y no mira las clases). | `curriculum.service.ts:111-145` | 1, 14 |
| G15 | P1 | **Tres nociones de readiness y cuatro de eligibility** con el mismo nombre. `docs/EXAM_READINESS.md` describe solo la legacy. | ver evidencia §6 | 14 |
| G16 | P2 | **Dificultad solo por media**: no hay distribución por bandas en el Blueprint, y `target_difficulty_index` se escribe pero nunca se lee. | `form-assembly.ts:28-33` | 8 |
| G17 | P2 | **Cobertura de verticales incompleta**: no hay Checkpoint ni Lower Secondary; Saber 11 solo tiene Matemáticas; PISA Reading/Science no tienen longitud oficial; los 48 sujetos IB sin `canonical_subject_id` quedan ocultos en la adopción institucional. | `curriculum-management.service.ts:96` | 11, 12 |
| G18 | P2 | **Varias fuentes de verdad para pesos y tamaños**: `max_marks`/`weighting_percent` (columnas) vs `definition` jsonb vs `sectionWeights` vs `allocation.weight`; hechos de catálogo hardcodeados (`paa.full {180, 175}`, 0580 P1–P4). | `structure.ts:153, 211-219` | 9 |
| G19 | P2 | **Sin modelo de calendario institucional** (fechas de mocks o de entrega de IA) ni periodos académicos del Student. El grado se recalcula a partir de texto libre y se ignora el `grade_level` almacenado. | `grade-level.ts:51-70`; `academic-context.ts` | 1, 3 |
| G20 | P3 | **Higiene técnica**: sin CHECK de `exam_family`; carrera en «un intento abierto por perfil»; *false negatives* en `verifyAttemptResultReproducible`; `zeroCriteria` y `result-view` ignoran los method marks. | `exam-instance.service.ts:341`; `results.service.ts:144, 344` | — |
| G21 | P3 | **Documentación desactualizada**: EXAM_VERTICAL_MATRIX, el §3 de V2_IMPLEMENTATION y el reporte objective-first. La elegibilidad (commits 0398be8 y bf98086) no tiene spec. El texto de catálogo dice «StudyUS» (81 archivos): son datos con huella que el codemod de marca excluye a propósito, así que la corrección exige una nueva versión de config (ver §F). | — | Restricción de marca |

**Lo que NO es brecha**:
- No existe un default «MCQ = 2 marks»: los «2» en las configs son `count` (posiciones).
- La política de readiness SHADOW y la decisión PAA_FULL_MOCK = NO son decisiones vigentes, no defectos.
- Que el motor de scoring no tenga ramas por familia es correcto.

---

## C. Canonical Domain Model

### C.1 Principios

1. **Seis capas con dependencia unidireccional:** Curriculum ← Assessment ← Blueprint ← Instance. Learner y Pathway leen las tres primeras. Ninguna capa inferior conoce la UX.
2. **Curriculum Model** = qué se aprende. **Assessment Model** = reglas de evaluación de una familia o examen, independientes de una sesión concreta. **Exam Session** = convocatoria concreta. **Blueprint** = reglas de construcción de un instrumento. **Instance** = un instrumento concreto (Mock 1, Mock 2…).
3. **Toda capa es opcional por examen.** Ejemplos: PAA no tiene Qualification, Subject Level ni grade boundaries; PISA no tiene puntaje individual. Una capa ausente es un estado explícito (`NOT_APPLICABLE`), no un *null* ambiguo, y es distinta de `UNKNOWN` (aplica, pero no hay fuente).
4. **Toda regla académica es dato con procedencia**: `source_key`, `status` (OFFICIAL_PUBLISHED | OFFICIAL_LICENSED | STUDYUS_POLICY | UNKNOWN) y `confirmed`. El código nunca contiene umbrales, pesos ni escalas oficiales.
5. **Unidades tipadas** en todo el pipeline: `MARKS`, `WEIGHTED_MARKS`, `PERCENT`, `SCALED_SCORE`, `GRADE`, `QUALIFICATION_POINTS`, `PROFICIENCY_LEVEL`. «Points» solo existe como `QUALIFICATION_POINTS` (IB Diploma, AICE) o cuando la familia lo nombra oficialmente.

### C.2 Entidades y relaciones

Acciones: **REUSE** (sin cambio) · **EXTEND** (columnas o semántica aditivas) · **NEW** · **PROMOTE** (de jsonb o código a tabla).

#### Capa 1 — Curriculum Model (qué debe aprender)

| Entidad canónica | Tabla / origen actual | Acción | Notas |
|---|---|---|---|
| CurriculumAuthority | `academic_organizations` (country, source_type, authority_level) | REUSE | SEP, MEN, IBO, Cambridge, institución |
| Programme | `academic_programmes` | EXTEND | `programme_type` se restringe semánticamente a CURRICULUM. Las filas ADMISSION_EXAM y ASSESSMENT_FRAMEWORK se conservan por compatibilidad, pero las nuevas familias de evaluación viven en `assessment_families`. |
| **ProgrammeStage** | `academic_programmes.stage` (texto) + `grade_min/max` | NEW `programme_stages` | `(programme_id, stage_key, label, ordinal, grade_min, grade_max, typical_age_min/max, years)`. Ejemplos: IB MYP 1–5, DP Year 1–2; Cambridge Primary 1–6, Lower Secondary 7–9, Upper Secondary 10–11, Advanced 12–13; MX Secundaria 1–3, Bachillerato 1–3; CO Grados 6–11. Las etiquetas y rangos salen de fuentes registradas o quedan UNKNOWN. |
| Qualification | `academic_qualifications` | REUSE | IGCSE, AS/A Level, IB Diploma, AICE Diploma, Bachillerato |
| Subject | `academic_subjects` (+`canonical_subject_id`) | REUSE | Corregir los sujetos sin mapear: G17 |
| **SubjectLevel** | `academic_subjects.level` (texto) + `canonical_concepts.level` + `subjects.ib_level` | NEW `subject_level_definitions` | `(programme_id, level_key, label, ordinal)`: SL/HL, CORE/EXTENDED, AS/A. `academic_subjects.level` pasa a referenciarlo (FK suave + backfill). |
| SyllabusVersion | `structure_versions` | EXTEND | Añade `purpose` (`CURRICULUM` \| `ASSESSMENT_SPEC`), `syllabus_code`, `first_teaching`, `last_teaching`. Resuelve G5. |
| Topic / Area | `structure_nodes` | REUSE | |
| LearningObjective | `learning_objectives` | REUSE | Destino compartido de los targets del Blueprint |
| Concept / Skill / Competency | `canonical_concepts`, `skills`, `competencies` + `objective_*_mappings` | REUSE | Identidad longitudinal del aprendizaje |
| Prerequisite | `canonical_concept_prerequisites` | REUSE | DAG validado en la aplicación |
| **StageScope** | — | NEW `curriculum_stage_scope` (opcional) | `(structure_version_id, structure_node_id, programme_stage_id, year_in_stage, status)`: «cuándo se enseña». Alimenta G (longitudinal). Si no se carga, el estado es UNKNOWN y no se infiere. |

#### Capa 2 — Assessment Model (cómo se evalúa)

| Entidad canónica | Tabla / origen actual | Acción | Notas |
|---|---|---|---|
| **AssessmentFamily** | `EXAM_FAMILIES` + `ObjectiveFramework` + `CatalogFamily` (TS) | PROMOTE `assessment_families` | `(family_key, awarding_body_org_id, ecosystem_key, aliases[], status)`. Unifica las tres taxonomías (G9). El enum TS queda como vista generada para compatibilidad. |
| ExamDefinition | `exam_definitions` | EXTEND | `assessment_family_id`, `assessment_kind` ∈ {FINAL_QUALIFICATION_EXAM, ADMISSIONS_TEST, STANDARDISED_CHECKPOINT, NATIONAL_EXIT_EXAM, LARGE_SCALE_SURVEY, PROGRESS_ASSESSMENT, INSTITUTION_ASSESSMENT}, `academic_subject_id`, `subject_level_id`, `qualification_id` (todas opcionales). |
| ExamSpecificationVersion | `exam_versions` | REUSE | Ya tiene `syllabus_code`, `framework_version`, `first/last_assessment` |
| **ExamSession** | `exam_versions.exam_session` (texto) | NEW `exam_sessions` | `(exam_definition_id, session_key 'may-2027', series_year, series_label, starts_on, ends_on, results_on, timezone_variant, status ANNOUNCED\|OPEN\|SAT\|RESULTS_PUBLISHED\|CANCELLED, source_key)` + `exam_session_versions(session_id, exam_version_id)`: qué especificación aplica a esa convocatoria. |
| Component / Paper | `assessment_components` (+definition) | REUSE | La fuente única de duración, marks y tipo es `definition`; las columnas quedan como proyección indexable (G18). |
| Section | `definition.sections[]` | EXTEND (jsonb) | Añade `choiceRule` (`ANSWER_ALL` \| `ANSWER_N_OF_M`), `marksExact` y `marksApprox`. |
| **AssessmentRoute** | `navigation_rules.assessmentRoutes` | PROMOTE `assessment_routes` | `(exam_version_id, route_key, level_key, component_set[], stage_sets[], component_weights {key: pct}, source_key)`. **Los pesos viven en la ruta**: en Cambridge el peso de un Paper depende de AS vs A; en IB, de SL vs HL (definiciones separadas). |
| **AssessmentObjective** | `definition.assessmentObjectives` (jsonb) | PROMOTE `assessment_objectives` | `(exam_version_id, code AO1…, label, weight_min, weight_max, source_key)` |
| CommandTerm | `command_terms` (UNIQUE term global) | EXTEND | Añade `scope_family_id` y `exam_version_id`, con unicidad por alcance. |
| QuestionType / ResponseFormat | enums en `component-definition.ts`, `items.ts` | REUSE | Vocabulario controlado |
| MarkingModel | ítem: `content.rubric`, `parts`, `method`, `scoringStrategy` (12) | REUSE | El ítem es la autoridad de marks; la celda restringe los modelos y rangos permitidos (§E) |
| **ScoringPipeline** | `scoring_models.config` (ScoringPolicy v1) | EXTEND | `engine: 'exam-scoring-v2'`: etapas tipadas (§E.4). v1 sigue válido; no hay reescritura. |
| **GradeBoundarySet** | `cambridge_grade_thresholds` (vacía) + `score_conversion_models` (vacía) | NEW `grade_boundary_sets` + `grade_boundaries` | `set: (exam_session_id, exam_version_id, scope COMPONENT\|SUBJECT\|AREA\|GLOBAL, scope_key, level_key, route_key, variant, input_unit, output_unit, provenance, source_key, license_status)`; `boundary: (set_id, output_value, min_input, max_input)`. `cambridge_grade_thresholds` se migra como datos y queda una vista de compatibilidad. |
| **ScaleConversion** | `score_conversion_models` | EXTEND | Tabla raw → escala por sesión y área (p. ej. PAA 200–800). Hoy no hay ninguna oficial: UNKNOWN. |
| **QualificationAwardRule** | `aice/policy.ts` (código) | PROMOTE `qualification_award_rules` | `(qualification_id, rule_version, rule jsonb, confirmed flags, source_key)`. AICE ya existe; IB Diploma (TOK/EE matrix, condiciones) queda como esqueleto con campos TBD. |

#### Capa 3 — Blueprint

| Entidad canónica | Tabla / origen actual | Acción | Notas |
|---|---|---|---|
| Blueprint | `assessment_blueprints` (1 por versión) | EXTEND | Añade `blueprint_kind`, `blueprint_version`, `route_key`, `fingerprint`, `status`. La unicidad pasa a `(exam_version_id, blueprint_kind, route_key, blueprint_version)`. Tipos: `FULL_MOCK`, `REDUCED_MOCK`, `DIAGNOSTIC`, `PAPER_PRACTICE`, `COMPONENT_PRACTICE`, `SECTION_PRACTICE`, `TOPIC_PRACTICE`, `CHECKPOINT_PRACTICE`, `GENERAL` (backfill del actual). |
| BlueprintComponent | `blueprint_component_allocations` | REUSE | Añade `quota_marks`. |
| **BlueprintCell** | `blueprint_objective_targets` (1 fila = 1 posición) + `cell_key` derivado | EXTEND | Pasa a ser una celda con cuota (`count` o `marks`) y un **predicado de elegibilidad** completo (§E.3). Las filas actuales siguen siendo válidas: cada una es una celda con `count = 1`. |
| Mock Template | — | **no es entidad** | Mock Template = Blueprint(`FULL_MOCK` o `REDUCED_MOCK`) + ruta + DeliveryPolicy. Mock 1 y Mock 2 **no** son tipos. |

#### Capa 4 — Instances

| Entidad canónica | Tabla / origen actual | Acción | Notas |
|---|---|---|---|
| AssessmentInstance | `exam_instances` | EXTEND | Añade `blueprint_id`, `blueprint_version`, `session_id`, `series_id`, `series_ordinal`, `assembly_seed`, `pool_snapshot_hash`. |
| **AssessmentSeries** | — | NEW `assessment_series` | `(scope STUDENT\|CLASS\|COHORT, owner_id, blueprint_id, overlap_policy {maxItemOverlap, maxTemplateOverlap, hard:boolean}, form_policy INDIVIDUAL\|SHARED_COHORT_FORM)`. Mock 1 = ordinal 1, Mock 2 = ordinal 2. |
| Attempt / Response / Result | `exam_attempts`, `exam_attempt_item_responses`, `exam_attempt_results` | EXTEND | El resultado añade `stage_outputs jsonb` (cada etapa con valor, unidad y procedencia) y `pipeline_hash`. |

#### Capa 5 — Learner

| Entidad canónica | Tabla / origen actual | Acción | Notas |
|---|---|---|---|
| LearnerAcademicProfile | `student_academic_profile`, `student_academic_subjects` | REUSE | |
| **LearnerAcademicPeriod** | — | NEW `student_academic_periods` | `(student_id, academic_year, programme_id, programme_stage_id, grade_level, institution_id?, source INSTITUTION\|SELF\|INFERRED, started_on, ended_on)` + `student_period_subjects(period_id, academic_subject_id, subject_level_id)`. Es la historia del Student, no un reset: la evidencia se cruza con el periodo por timestamp. |
| ExamTargetProfile | `student_exam_profiles` | EXTEND | Añade `target_session_id`, `subject_level_id`, `route_key`, `target_outcome {unit, value}` tipado (reemplaza `preparation_goals.target_value text`) y `entry_source`. |
| Evidence / LearnerState | F4/F5 (`learning_evidence`, `concept_*_state`, `learner_skill_state`…) | REUSE | Sin cambios de esquema. Se añade un **evidence-context tag** en lectura (`assessment_family_id`, `exam_definition_id`, `blueprint_kind`), derivado de `exam_attempts` (G6). |

#### Capa 6 — Pathway

| Entidad canónica | Tabla / origen actual | Acción | Notas |
|---|---|---|---|
| **PathwayDefinition** | — | NEW `assessment_pathways` | `(pathway_key, programme_id?, country?, label, source_key, status)` |
| **PathwayStep** | `FRAMEWORK_FOLLOWS` (código) | NEW `pathway_steps` | `(pathway_id, programme_stage_id, ordinal, exam_definition_id?, assessment_kind, timing {relative: END_OF_STAGE\|YEAR_N_TERM_T\|SESSION}, obligation MANDATORY\|OPTIONAL\|INSTITUTION_DECIDED\|UNKNOWN, follows_step_id)` |
| **AssessmentEligibilityRule** | `ASSESSMENT_ELIGIBILITY_RULES` (código) | PROMOTE `assessment_eligibility_rules` | `(exam_definition_id \| family_id, countries[], grade_min/max, age_min/max, programme_ids[], conditions jsonb, source_key, status)`. El backfill reproduce `rules.ts` 1:1 (paridad 55/55). |
| **InstitutionAssessmentEvent** | `class_exam_assignments` (solo objetivo) | NEW `institution_assessment_events` | `(institution_id, grade_id?, class_id?, series_id?, kind MOCK\|IA_DEADLINE\|CHECKPOINT\|INTERNAL_EXAM, scheduled_on)`. `class_exam_assignments` se conserva tal cual. |

### C.3 Diagrama de relaciones (núcleo)

```
CurriculumAuthority 1─* Programme 1─* ProgrammeStage
Programme 1─* Qualification ; Programme 1─* Subject 1─* SyllabusVersion(purpose) 1─* StructureNode 1─* LearningObjective
LearningObjective *─* CanonicalConcept / Skill / Competency   (mappings publicados)
Subject *─1 SubjectLevel(def)

AssessmentFamily 1─* ExamDefinition ─?→ Subject / SubjectLevel / Qualification / Programme   (mapping opcional)
ExamDefinition 1─* ExamSpecificationVersion 1─* Component 1─* Section
ExamDefinition 1─* ExamSession *─* ExamSpecificationVersion
ExamSpecificationVersion 1─* AssessmentRoute (component sets + weights) ; 1─* AssessmentObjective ; 1─1 ScoringPipeline
ExamSession × Version × (scope) 1─* GradeBoundarySet 1─* GradeBoundary
Qualification 1─* QualificationAwardRule

ExamSpecificationVersion 1─* Blueprint(kind, route, version) 1─* BlueprintComponent 1─* BlueprintCell ─→ LearningObjective(s)
Blueprint 1─* AssessmentSeries 1─* AssessmentInstance(ordinal, seed) 1─1 Attempt 1─1 Result(stage_outputs)
Bank Item (approved_items) ─→ LearningObjective ; eligible(item, cell) = predicate   (el Blueprint nunca guarda ítems)

Student 1─* LearnerAcademicPeriod ─→ ProgrammeStage ; Student 1─* ExamTargetProfile ─→ ExamDefinition / Session / Level / Route
PathwayDefinition 1─* PathwayStep ─→ ProgrammeStage, ExamDefinition ; AssessmentEligibilityRule ─→ ExamDefinition
```

---

## D. Exam Resolution Logic

### D.1 Contrato

```ts
resolveExamPath(input: ExamPathInput): ExamPathResolution   // pura, determinista, sin I/O

type ExamPathInput = {
  asOf: Date;
  learner: {
    periods: LearnerAcademicPeriod[];        // historia, incluido el periodo actual
    profile: LearnerAcademicProfile | null;  // Phase A (catálogo) + legacy
    enrolments: ClassContext[];              // clase → institution_curriculum → programme / subjects / levels
    classAssignments: ClassExamAssignment[]; // institución / docente
    examTargets: ExamTargetProfile[];        // elegidos por el Student (independiente)
    country: string | null;
  };
  catalog: {
    pathways; stages; eligibilityRules; examDefinitions; sessions; versions; blueprints; routes;
  };
};

type ExamPathResolution = {
  currentStage: Resolved<{ programmeId; stageId; gradeLevel; academicYear }> | Unresolved;
  currentAssessments: AssessmentRecommendation[];    // aplican ahora (p. ej. checkpoint de esta etapa, mock programado)
  recommendedPreparation: PreparationRecommendation[]; // qué Blueprint usar hoy (diagnostic / paper / mock)
  upcomingAssessments: AssessmentRecommendation[];   // ordenadas por fecha o sesión estimada
  eligibleFinalExams: AssessmentRecommendation[];    // finales, certificaciones, admisiones
  missingProfileInfo: MissingInfo[];                 // { field, neededFor[], impact, askWho: STUDENT|INSTITUTION }
  conflicts: ResolutionConflict[];                   // fuentes en conflicto: se muestran, nunca se fusionan
};

type AssessmentRecommendation = {
  examDefinitionId; sessionId | null; versionId | null; levelKey | null; routeKey | null;
  kind: AssessmentKind; obligation: 'MANDATORY'|'OPTIONAL'|'INSTITUTION_DECIDED'|'SELF_SELECTED'|'UNKNOWN';
  timing: { sessionKey?; date?; relative?: string; status: 'KNOWN'|'ESTIMATED'|'UNKNOWN' };
  reasons: Reason[];                                 // reutiliza EligibilityReason + PATHWAY_STEP, SESSION_NEXT, TARGET
  confidence: 'HIGH'|'MEDIUM'|'LOW';
  rank: number;
};
```

### D.2 Algoritmo

1. **Etapa actual** (`currentStage`). Se elige el primer resultado de esta lista de precedencia:
   1. un `student_academic_periods` actual con source INSTITUTION;
   2. clase activa → `grades.academic_programme_id` + `academic_year`;
   3. Academic Profile (programme + `grade_level` almacenado);
   4. normalización de `school_year` (`grade-level.ts`);
   5. Unresolved.

   El programa se mapea a `programme_stages` por `grade_level`. **Confianza:** HIGH (institución + programa explícito), MEDIUM (perfil de catálogo), LOW (legacy o texto). Si dos fuentes discrepan (clase IB y perfil nacional) se registra un `conflict` y se resuelven **ambos caminos**. Nunca se fusionan; la misma regla que hoy en `academic-context.ts`.
2. **Candidatos** (unión, cada uno con sus razones):
   - (a) `class_exam_assignments` activas → INSTITUTION_ASSIGNED, rank 0;
   - (b) `pathway_steps` del programa con etapa ≥ actual → PATHWAY_STEP;
   - (c) definiciones alojadas por los Subjects y Levels del Student → CURRICULUM_SUBJECT, rank 1;
   - (d) `assessment_eligibility_rules` que coinciden con país, grado y edad → COUNTRY_GRADE, rank 3;
   - (e) `examTargets` del Student → SELF_SELECTED.

   El grafo actual (`graph.ts`) cubre (c) sin cambios.
3. **Resolver versión, sesión, nivel y ruta** para cada candidato:
   - **Sesión:** si el target fija una, se usa; si no, la próxima `exam_sessions` con `starts_on ≥ asOf` y estado ANNOUNCED u OPEN. Si no hay sesiones cargadas: `timing.status = UNKNOWN` y se añade a `missingProfileInfo` como dato de catálogo, no del Student.
   - **Versión:** la de `exam_session_versions`; si falta, la PUBLISHED vigente para `first_assessment ≤ año de sesión ≤ last_assessment`.
   - **Nivel:** del `student_period_subjects` o del target. Si falta: `missingProfileInfo{field:'subjectLevel'}`.
   - **Ruta:** del target. Si la versión tiene más de una ruta y no hay elección: `missingProfileInfo{field:'route'}`, y se recomienda solo PAPER_PRACTICE de componentes comunes a todas las rutas.
4. **Clasificar el horizonte:** `currentAssessments` (pasos de la etapa actual o eventos institucionales ≤ 60 días), `upcomingAssessments` (el resto, ordenado) y `eligibleFinalExams` (kind ∈ FINAL_QUALIFICATION_EXAM, ADMISSIONS_TEST, NATIONAL_EXIT_EXAM).
5. **Preparación recomendada hoy.** Depende de:
   - la distancia temporal a la evaluación;
   - el readiness de catálogo (qué Blueprints tienen banco suficiente);
   - un *readiness summary* opcional (§D.4).

   La regla base es un dato de política StudyUs versionada (`preparation_policy`), no de la familia:
   - sin evidencia del examen → `DIAGNOSTIC`;
   - brechas por Paper → `PAPER_PRACTICE`;
   - ≤ N semanas a la sesión y cobertura ≥ umbral → `FULL_MOCK` (o `REDUCED_MOCK` declarado como tal).

   Los umbrales de política se migran desde los actuales `preparation-plan.ts` (EXAM_SOON 30 días, etc.); no se inventan.
6. **Confianza por recomendación** = mínimo de la confianza de la etapa y la de la fuente: assignment HIGH; pathway + etapa HIGH o MEDIUM; regla país-grado MEDIUM; legacy LOW.

### D.3 Ejemplos

**IB DP Year 2 · Math AA HL · May 2027** (institucional)

```
periods.current = {programme: IB DP, stage: DP Year 2, gradeLevel 12}   ← clase (HIGH)
subjects: Mathematics: analysis and approaches · level HL
→ candidate: ExamDefinition "IB DP Mathematics AA HL" (CURRICULUM_SUBJECT, rank 1)
→ session: may-2027 (desde target o primera ANNOUNCED ≥ asOf) → version V2 2021-2028 (first ≤ 2027 ≤ last)
→ route: única (HL) → components P1 30% · P2 30% · P3 20% · IA 20% (INTERNAL, no simulable)
→ blueprints: DIAGNOSTIC, PAPER_PRACTICE(P1|P2|P3), FULL_MOCK (route HL)
→ institution events: Mock 1 (series ordinal 1, fecha institucional), Mock 2
→ recommendedPreparation hoy: depende del readiness (p. ej. PAPER_PRACTICE P3)
→ prediction inputs requeridos: P1, P2, P3 marks + IA estimada por docente; boundaries may-2027 = UNKNOWN → sin nota 1–7
missingProfileInfo: [] ; conflicts: []
```

**Independiente · México · Target = PAA** (entrada directa por examen)

```
periods: [] · profile: country MX, sin programa → currentStage Unresolved (LOW) — no bloquea
examTargets: [PAA] (SELF_SELECTED) ; eligibilityRule PAA (MX, 10–12) coincide si hay grado → razón adicional COUNTRY_GRADE
→ ExamDefinition PAA → version 'V2.1 PAA revisada (guía 2021)' → session: UNKNOWN (no hay sesiones cargadas)
→ tested areas: Lectura, Redacción, Matemáticas, Inglés (reporting groups)
→ blueprints: DIAGNOSTIC, SECTION_PRACTICE(×4), REDUCED_MOCK (36/175, declarado), FULL_MOCK = no disponible (PAA_FULL_MOCK = NO)
→ mapping: celdas → learning_objectives(ASSESSMENT_SPEC) → canonical concepts → prerequisites
missingProfileInfo: [{field:'targetSessionDate', impact:'priorización temporal', askWho:'STUDENT'}]
```

El Student independiente **no** pasa por un currículo escolar. El mapping examen → conceptos → prerrequisitos se obtiene de las celdas del Blueprint y de los `objective_concept_mappings` publicados.

### D.4 Readiness Engine — contrato (solo interfaz)

```ts
type ReadinessRequest = {
  studentId; examTarget: { examDefinitionId; versionId; sessionId?; levelKey?; routeKey? };
  blueprintId;                // requisito = celdas → objetivos → conceptos (con peso por marks)
  asOf: Date;
  lineage: 'PROFILE' | 'PROFILE_LINEAGE' | 'ALL_PROFILES';   // qué intentos cuentan (corrige G6c)
};
type ReadinessSignals = {     // provistos por Learning OS; el Blueprint Engine solo define la forma
  perConcept: { canonicalConceptId; curriculumExposure?: 'TAUGHT'|'NOT_YET'|'UNKNOWN';
                mastery; skillMastery?; retention; transfer; evidenceCount; lastEvidenceAt }[];
  examItemPerformance: { cellKey; sameExam: true; n; fractionMean; strictFraction }[];   // SOLO mismo examen
  mockPerformance: { instanceId; seriesOrdinal; componentResults: StageOutput[] }[];   // SOLO mismo examen
  crossExamContext: { familyKey; cellLikeKey; signal: 'GAP'|'STRENGTH' }[];            // solo contexto, nunca estado
};
type ReadinessReport = {
  byComponent: { componentKey; status; confidence; coverage; evidence: Counts }[];
  byCell: { cellKey; status; reasons[] }[];
  overall: { status; confidence; coldStart: boolean };
  provenance: { policyVersion; signalsHash };
};
```

- **Regla dura** (ya acordada): el desempeño de otro examen nunca decide el estado de este, solo aporta contexto. Las señales por concepto (mastery, retention, transfer) son compartidas porque el conocimiento es uno solo, pero se etiquetan como «sin evidencia en el formato de este examen» cuando `examItemPerformance.n = 0`.
- **Cold start**: sin historial, `coldStart = true` y se recomienda DIAGNOSTIC. `curriculumExposure` (desde StageScope + periodos) puede mostrar «enseñado, no verificado», nunca dominio.

### D.5 Contrato hacia Prediction

El Blueprint Engine solo entrega reglas; Prediction las consume.

```ts
type PredictionRulesBundle = {
  examVersionId; sessionId | null; levelKey | null; routeKey | null;
  components: { key; assessment: 'EXTERNAL'|'INTERNAL'; maxMarks: number|null; weightPercent: number|null;
                requiredForGrade: boolean; inputSource: 'ATTEMPT'|'TEACHER_ESTIMATE'|'STUDENT_ENTERED' }[];
  pipeline: ScoringPipelineV2;              // etapas y unidades
  boundaries: { status: 'OFFICIAL'|'LICENSED'|'UNKNOWN'; setId?: string; sourceKey?: string };
  qualificationRule?: { id; confirmed: boolean };
  requiredInputs: string[];                 // componentes sin dato → la proyección queda parcial
  provenanceHash: string;
};
```

| Proyección IB | Entradas | Salida máxima permitida |
|---|---|---|
| EARLY | Mock 1 (componentes cubiertos) | weighted % parcial; nota 1–7 solo si boundaries ≠ UNKNOWN |
| UPDATED | Mock 2 (+ Mock 1 como historia) | ídem |
| FULL | + IA estimada por el docente | ídem; nunca «resultado oficial IB» |

---

## E. Blueprint Contract

### E.1 Documento

Zod, `exam-blueprint/v2`. Extiende `ExamVerticalConfig` y `ComponentDefinition`; no los reemplaza.

```ts
BlueprintDocumentV2 = {
  schema: 'studyus.blueprint/v2';
  examDefinitionKey: string;            // exam_definitions.config_key
  examVersionLabel: string;             // exam_versions.version_label
  blueprintKind: 'FULL_MOCK'|'REDUCED_MOCK'|'DIAGNOSTIC'|'PAPER_PRACTICE'|'COMPONENT_PRACTICE'
               |'SECTION_PRACTICE'|'TOPIC_PRACTICE'|'CHECKPOINT_PRACTICE'|'GENERAL';
  blueprintVersion: string;             // semver; el fingerprint se calcula sobre el documento canónico
  curriculumMapping: { programmeKey?; qualificationKey?; subjectKey?; levelKey?; syllabus: { code?; version } } | 'NOT_APPLICABLE';
  sessionApplicability: { firstSession?: string; lastSession?: string } | 'ANY_SESSION_OF_VERSION';
  routeKey: string | null;              // AssessmentRoute; obligatoria si la versión tiene más de una
  fidelity: 'OFFICIAL_LENGTH' | 'REDUCED' | 'PRACTICE';   // REDUCED siempre se declara al Student
  components: BlueprintComponent[];
  selectionRules: SelectionRules;
  scoring: { pipelineRef: string } ;    // ScoringPipelineV2 de la versión (no se duplica aquí)
  provenance: { status: 'OFFICIAL_STRUCTURE'|'STUDYUS_POLICY'; sourceKeys: string[]; limitations: string[] };
};

BlueprintComponent = {
  componentKey: string;                 // assessment_components.section_key
  included: 'REQUIRED'|'OPTIONAL';
  timing: { mode: 'OFFICIAL'|'PROPORTIONAL'|'UNTIMED'; minutes?: number };
  tools: { calculator: CalculatorPolicy|null; resources: string[] };   // heredado de la definition si se omite
  quota: { marks?: number; items?: number };                          // FULL: = maxMarks / officialItemCount
  sections: { sectionKey; choiceRule: 'ANSWER_ALL'|{ answerN: number; ofM: number }; cells: BlueprintCell[] }[];
  distributions: { dimension: 'AO'|'COMMAND_TERM'|'TOPIC'|'PROCESS'|'CONTEXT'|'COMPETENCY'|'DIFFICULTY'|'MARKS';
                   target: Record<string, { min?: number; max?: number; exact?: number }>;
                   basis: 'MARKS'|'ITEMS'; source: 'OFFICIAL'|'STUDYUS_POLICY' }[];
};

BlueprintCell = {
  cellKey: string;                      // estable; reemplaza el cell_key derivado
  quota: { items: number } | { marks: number };
  eligibility: ItemEligibilityPredicate;
  marksSpec: { exact?: number; min?: number; max?: number; source: 'OFFICIAL'|'ITEM' };  // nunca «MCQ = 2» implícito
  stimulusGroup?: string;               // ítems que deben compartir estímulo
  required: boolean;
};

ItemEligibilityPredicate = {
  objectives: { learningObjectiveIds: string[] } ;   // obligatorio
  concepts?: string[]; skills?: string[]; competencies?: string[];
  assessmentObjectives?: string[]; commandTerms?: string[];
  questionTypes?: string[]; responseFormats?: ResponseFormat[];
  markingModels?: ScoringStrategy[];
  difficulty?: { scale: 'VALIDATED_1_5'|'INDEX'; min?: number; max?: number };
  languages?: string[];
  usage: Usage;                         // PRACTICE|DIAGNOSTIC|REDUCED_MOCK|FULL_MOCK|FORMAL_ASSESSMENT (QB V2)
  minAlignment?: 'PRACTICE'|'EXAM_STYLE'|'MOCK_READY'|'OFFICIAL';
  provenanceAllowed?: ('OFFICIAL'|'LICENSED'|'STUDYUS_GENERATED'|'FIXTURE')[];
  minCalibrationConfidence?: number;
};

SelectionRules = {
  seedPolicy: 'INSTANCE_ID' | 'SERIES_ORDINAL';      // determinista, reproducible
  uniqueness: { item: 'FORM'; template: 'FORM'; stimulus: 'FORM'|'NONE' };
  series: { maxItemOverlapWithPrevious: number; maxTemplateOverlap: number; hard: boolean };
  exposure: { studentCooldownDays: number; globalCeiling: number };   // valores actuales de policy.ts
  difficulty: { meanTarget?: number; band?: [number, number]; distribution?: Record<'1'|'2'|'3'|'4'|'5', number> };
  shortage: 'EXCLUDE_AND_DISCLOSE' | 'FAIL';         // el Mock nunca genera ítems en vivo
};
```

### E.2 Invariantes (validación del schema)

1. El Blueprint **no contiene ítems ni IDs de ítems**. Solo predicados.
2. `fidelity = OFFICIAL_LENGTH` exige que, por componente, la cuota sea igual a `definition.maxMarks` o a `officialItemCount`, y que la ruta sea completa. Si el dato oficial es `null` (UNKNOWN), OFFICIAL_LENGTH es inválido y queda REDUCED. Es la misma semántica que `readiness.ts:76-85`.
3. Cada `componentKey` existe en la versión y pertenece a la ruta. Cada `cellKey` es único.
4. Las distribuciones con `source: 'OFFICIAL'` deben citar un `sourceKey` registrado.
5. `marksSpec.source = 'OFFICIAL'` exige una fuente. Si es `'ITEM'`, manda el ítem y la suma se valida contra la cuota en el ensamblaje.
6. Los Blueprints de mock (FULL_MOCK o REDUCED_MOCK) exigen `usage ∈ {REDUCED_MOCK, FULL_MOCK}` y `minAlignment ≥ MOCK_READY`, lo que es coherente con el CHECK de la migración `20261028`.
7. El documento es inmutable una vez usado por una instancia: cambiarlo produce una nueva `blueprintVersion`.

### E.3 Contrato Question Bank ↔ Blueprint (criterio 13)

- El banco expone una sola función pura `isItemEligibleForCell(item: BankItemFacts, cell: BlueprintCell, use: Usage): Verdict` y su traducción SQL `eligibilitySql(cell, use)`. **Ambas se generan desde el mismo predicado** y tienen un test de paridad. Reemplaza los cuatro lugares actuales (G7).
- `BankItemFacts` contiene solo hechos del ítem: objetivos, tags, marks, formato, dificultades, idioma, procedencia, ciclo de vida, uso y alineación. Nada de learner state ni strings de UI.
- La demanda viaja del Blueprint al banco como `CellDemand {cellKey, requiredForms, available, shortage}`, calculada a partir de cuotas × `target_forms`. Los faltantes del ensamblaje (`AssembledForm.shortages`, hoy una señal que nadie lee) se agregan a esa misma cola.
- Los strings de presentación (salud del banco, etiquetas de procedencia) salen de la capa del banco hacia la UI admin o student mediante claves i18n.

### E.4 Scoring Pipeline V2 (marks → … → grade)

```ts
ScoringPipelineV2 = {
  engine: 'exam-scoring-v2';
  stages: Stage[];                       // orden fijo; cada etapa declara unidad de entrada y salida
  provenance: { official: boolean; sourceKeys: string[] };
};
Stage =
 | { kind: 'ITEM_MARKS' }                                                  // del Marking Model del ítem → MARKS
 | { kind: 'COMPONENT_TOTAL'; components: string[] }                       // Σ marks → MARKS por componente
 | { kind: 'COMPONENT_WEIGHTING'; weightsFrom: 'ROUTE'|'EXPLICIT'; weights?: Record<string, number> } // → WEIGHTED_MARKS / PERCENT
 | { kind: 'AREA_GROUPING'; groups: { key; components: string[] }[] }      // PAA L+R, Saber pruebas
 | { kind: 'SCALE_CONVERSION'; scope: 'AREA'|'GLOBAL'; conversionRef: 'SESSION' }          // → SCALED_SCORE (tabla por sesión)
 | { kind: 'GLOBAL_COMBINATION'; formulaRef: string }                      // p. ej. índice global Saber (fórmula como dato con fuente)
 | { kind: 'GRADE_BOUNDARIES'; scope: 'COMPONENT'|'SUBJECT'; boundariesRef: 'SESSION' }    // → GRADE
 | { kind: 'QUALIFICATION_AGGREGATION'; ruleRef: string }                  // → QUALIFICATION_POINTS + award
 | { kind: 'PROFICIENCY_ESTIMATE'; bandsRef: string; official: false };   // PISA: orientación, nunca individual oficial
```

- Si una etapa no tiene sus datos (boundaries o conversión UNKNOWN para la sesión), el pipeline **se detiene en la última etapa resoluble** y lo reporta (`stoppedAt`, `reason: 'BOUNDARIES_UNKNOWN'`). Nunca usa un default; es la misma filosofía que `NO_SCORING_POLICY`.
- Cada salida guarda `{stage, value, unit, official, sourceKey}` en `exam_attempt_results.stage_outputs`.
- **Compatibilidad:** `exam-scoring-v1` (RAW, SECTION_WEIGHTED…) sigue funcionando. Para RAW, v2 = `ITEM_MARKS → COMPONENT_TOTAL` y un test de paridad garantiza resultados idénticos.
- Los marks de ítem siguen saliendo de `examItemMarks`. Los defaults de 1 para ítems generados quedan prohibidos para celdas con `marksSpec.source = 'OFFICIAL'` distinto de 1 (G12).

---

## F. Versioning Strategy

| Objeto | Identidad | Cambio permitido | Mecanismo |
|---|---|---|---|
| ExamSpecificationVersion | `(definition, version_label)` | Nunca se edita una vez PUBLISHED | Huella del config (existente) + `first/last_assessment`; una versión nueva reemplaza a la anterior |
| ExamSession | `(definition, session_key)` | Estado y fechas; boundaries y conversiones se agregan después de los resultados | `exam_session_versions` fija qué especificación aplica |
| AssessmentRoute / Objectives / Weights | por versión | Solo con una versión nueva | Pertenecen a la especificación |
| GradeBoundarySet | `(session, version, scope, level, route, variant)` | Inmutable; una corrección crea un set nuevo con `supersedes` | Procedencia y licencia obligatorias |
| Blueprint | `(version, kind, route, blueprint_version)` | Inmutable tras el primer uso | `fingerprint = hashCanonical(doc)`; las instancias guardan el `blueprint_version` |
| ScoringPipeline | `scoring_models` + `pipeline_hash` | Fila nueva por cambio (ya ocurre) | Congelado en `frozen_configuration` |
| Bank item | `question_bank_items` + versiones | Ya existe | Sin cambios |
| QualificationAwardRule | `(qualification, rule_version)` | Inmutable | Flags `confirmed` por regla |
| Curriculum (SyllabusVersion) | `structure_versions` | Ya existe (1 PUBLISHED por sujeto) | Se añade `structure_version_mappings(from_node, to_node, relation)` para transiciones de sílabo |

**Transiciones de sílabo.** El Student que cursa DP1 con la guía vieja y presenta con la nueva se resuelve por **sesión objetivo → versión aplicable** (§D.2 paso 3). La evidencia no se pierde: vive en conceptos canónicos, y el mapeo entre versiones solo afecta la cobertura del Blueprint.

**Resultados históricos.** Se reproducen con la configuración congelada del intento; nunca se recalculan con boundaries posteriores salvo que se pida explícitamente («re-proyectar con boundaries de sesión X»), y eso se etiqueta.

**Texto de catálogo con huella** («StudyUS» → «StudyUs», G21): requiere una nueva `version_label` de cada config afectada, nunca una edición in place.

---

## G. Longitudinal Assessment Mapping

```
Student ─┬─ periods: 2026 Lower Secondary Stage 7 → 2027 Stage 8 → 2028 Stage 9 → 2029 IGCSE Y1 → 2030 IGCSE Y2 → 2031 AS → 2032 A
         │            (institución o Student; ended_on cierra el periodo; nunca se borra)
         ├─ evidence/learner state por canonical concept  ← continuo, sin reset
         └─ pathway "Cambridge (institución X)" ─ steps:
              Stage 9 END_OF_STAGE  → Checkpoint (STANDARDISED_CHECKPOINT, obligation = INSTITUTION_DECIDED|UNKNOWN)
              IGCSE Y2 SESSION      → IGCSE 0580 (FINAL_QUALIFICATION_EXAM)
              AS SESSION            → AS 9709 ; A SESSION → A 9709 ; AICE Diploma (QualificationAwardRule)
```

- **Qué aprendió y cuándo:** `learning_evidence.created_at` se cruza con `student_academic_periods`. No se estampa en las filas ni hay migración de datos de aprendizaje.
- **Qué mantiene u olvidó:** `concept_memory_state` (existente).
- **Prerrequisitos faltantes para una evaluación futura:** celdas del Blueprint futuro → conceptos → `canonical_concept_prerequisites` → estado actual.
- **Qué tan preparado está para una evaluación a N años:** `ReadinessRequest` sobre el Blueprint futuro, con `curriculumExposure` (StageScope). Lo no enseñado aún se muestra como `NOT_YET`, no como brecha.
- **Cambio de institución o de programa:** cierra un periodo y abre otro. La evidencia se conserva. Las evaluaciones del pathway anterior pasan a historia, sin eliminarse.

---

## H. Vertical Validation

Leyenda: ✅ modelable con datos existentes · 🟡 modelable, faltan datos con fuente (UNKNOWN) · ❌ no aplica.

| Capacidad | IB DP | Cambridge Checkpoint | Cambridge IGCSE | Cambridge AS/A + AICE | PAA | ICFES Saber 11 | PISA |
|---|---|---|---|---|---|---|---|
| Etapa / pathway | DP Y1–Y2 ✅ (Pre-DP/MYP 🟡) | Lower Sec. Stage 9 🟡 | Upper Sec. 10–11 ✅ | Advanced 12–13 ✅ | ❌ (admisión, edad/grado 🟡) | Grado 11 CO ✅ (regla existente) | Edad 15 (aprox. grado) ✅ |
| Subject / level | ✅ SL/HL | 🟡 asignaturas | ✅ Core/Extended | ✅ AS/A | ❌ áreas | ✅ pruebas | ✅ dominios |
| Version / sessions | ✅ versión; sesiones May/Nov 🟡 (fechas) | 🟡 | ✅ 0580 2025–27; series 🟡 | ✅; series Jun/Nov ✅ (policy) | ✅ guía 2021; fechas 🟡 | ✅ 2026; Calendario A/B 🟡 | ✅ ciclo 2022 |
| Components / Papers | ✅ P1/P2/P3 + IA (INTERNAL) | 🟡 | ✅ P2/P4 (Core P1/P3 🟡 sin binding) | ✅ | ✅ 4 secciones | 🟡 solo Mat. con config | ✅ |
| Max marks / weights | ✅ (datos con fuente) | 🟡 | ✅ | ✅ por ruta | `NOT_APPLICABLE` marks; conteos ✅ | Ítems ✅; duración UNKNOWN | Solo Mat. tiene conteo |
| Marking model | ✅ markscheme / rubric StudyUs | 🟡 | ✅ | ✅ | ✅ MC 1 ítem = 1 | ✅ MC | ✅ créditos 0/1/2 (práctica StudyUs) |
| Scoring pipeline | marks → component → weighted (por pesos oficiales) → GRADE | 🟡 escala | marks → total → GRADE | marks → component → GRADE (AS/A) → AICE points | raw por sección → SCALED (200–800) | raw → prueba 0–100 → global 0–500 | PROFICIENCY_ESTIMATE (no oficial) |
| Boundaries / conversión | 🟡 por sesión (licencia escolar; UNKNOWN por defecto) | 🟡 | 🟡 (thresholds publicados por serie; cargar con fuente) | 🟡 (tabla existente vacía) | 🟡 sin tabla oficial pública registrada | 🟡 fórmula global solo en JSON fuente → validar | ❌ individual |
| Qualification points | IB Diploma 45 = 6×7 + TOK/EE (matriz en JSON fuente) 🟡 | ❌ | ❌ | AICE ✅ (3 reglas `confirmed:false`) | ❌ | ❌ | ❌ |
| Mock 1 / Mock 2 | ✅ series sobre FULL_MOCK HL/SL | 🟡 | ✅ | ✅ por ruta | REDUCED ✅ / FULL ❌ (decisión NO) | 🟡 | REDUCED |
| Independiente por examen | ✅ (asignatura + nivel + sesión) | 🟡 | ✅ | ✅ | ✅ | ✅ | ✅ |

**Resultado:** el modelo representa las seis familias sin una lógica universal simplificada. Las celdas 🟡 son **datos faltantes con fuente**, no limitaciones del modelo. Cada una queda UNKNOWN hasta que se registre su fuente, y el pipeline se detiene antes de la etapa sin datos.

**Criterios de aceptación — trazabilidad**

| # | Criterio | Cómo se cumple | Bloque |
|---|---|---|---|
| 1 | Institución → pathway automático | periodos + clase → etapa → pathway_steps + assignments | BP-6 |
| 2 | Independiente entra por examen | ExamTargetProfile → resolución sin currículo escolar | BP-6 (ya parcial) |
| 3 | Preparación multianual | periodos + StageScope + evidencia canónica continua | BP-6, BP-7 |
| 4 | Curriculum ≠ exam | `structure_versions.purpose` + `assessment_families` + el loader deja de escribir CURRICULUM | BP-1, BP-3 |
| 5 | Múltiples versions / sessions | `exam_sessions` + `exam_session_versions` | BP-1 |
| 6 | Papers variables | componentes + rutas por versión | BP-2 |
| 7 | Mock 1 / 2 desde un Blueprint | Blueprint kind + series + seed | BP-2, BP-5 |
| 8 | Elegibilidad sin preguntas | predicado de celda | BP-2, BP-3 |
| 9 | Scoring no genérico | pipeline v2 por etapas con datos | BP-4 |
| 10 | IB marks / weights / grades | pipeline IB + boundaries por sesión | BP-4 |
| 11 | Cambridge stages / checkpoints / qualifications | stages + pathway + AICE rule | BP-6, BP-9 |
| 12 | PAA / ICFES sin estructura IB | AREA_GROUPING + SCALE_CONVERSION + GLOBAL_COMBINATION | BP-4, BP-9 |
| 13 | QB desacoplado de UX | contrato §E.3 | BP-3 |
| 14 | Student Journey con contratos estables | `resolveExamPath`, `ReadinessRequest`, `PredictionRulesBundle` | BP-6–BP-8 |
| 15 | No romper flujos certificados | aditivo + SHADOW + paridad + regresión completa por bloque | todos |

---

## I. Migration Plan

**Reglas generales:**
- Solo migraciones aditivas: nada de DROP ni cambios de tipo destructivos.
- Cada migración tiene un script de certificación en Postgres efímero.
- Se aplica primero en DEV (huella `2a29b99ee14a22b4`), después en Preview `53d1` en ventana coordinada. **Producción nunca.**
- Los backfills son idempotentes.
- Cada lectura nueva entra en SHADOW (calcula y compara, no decide) hasta que se certifica.

| Paso | Migración | Backfill | Compatibilidad / rollback |
|---|---|---|---|
| M1 | `assessment_families` + `exam_definitions.assessment_family_id`, `assessment_kind` | Desde `exam_family` y los aliases de `ObjectiveFramework`. La regla de mapeo ICFES ≡ SABER11 se documenta. | El enum TS se genera desde la tabla; la columna `exam_family` se conserva. Rollback: ignorar las columnas nuevas. |
| M2 | `exam_sessions`, `exam_session_versions` | Sin datos oficiales: se crean solo las sesiones con fuente registrada; el resto queda vacío (UNKNOWN). | `exam_versions.exam_session` (texto) se mantiene. |
| M3 | Multiplicidad de Blueprint: añade `blueprint_kind`, `blueprint_version`, `route_key`, `fingerprint`; reemplaza `UNIQUE(exam_version_id)` por un índice único compuesto | Filas actuales → `kind='GENERAL'`, `version='1.0.0'` | Todo el código que lee «el blueprint de la versión» pasa por `defaultBlueprintFor(version)`, que devuelve GENERAL. Comportamiento idéntico. |
| M4 | `blueprint_objective_targets`: añade `cell_key`, `quota_items`, `quota_marks`, `eligibility jsonb`, `marks_spec jsonb` | `cell_key` = la clave derivada actual (`cells.ts`); `quota_items = target_item_count` | Ensamblaje actual sin cambios hasta BP-3. |
| M5 | `grade_boundary_sets`, `grade_boundaries`; `score_conversion_models.session_id` | Copia de `cambridge_grade_thresholds` (vacía hoy) | Vista de compatibilidad `cambridge_grade_thresholds_v`. |
| M6 | `scoring_models.engine_version`; `exam_attempt_results.stage_outputs`, `pipeline_hash` | Ninguno (v1 sigue) | Resultados v1 intactos. |
| M7 | `assessment_routes`, `assessment_objectives`; `command_terms.scope_*` | Desde `navigation_rules.assessmentRoutes` y `definition.assessmentObjectives` | El jsonb sigue siendo leído por el código actual hasta su migración. |
| M8 | `programme_stages`, `subject_level_definitions`, `structure_versions.purpose` | Etapas solo con fuente. `purpose='ASSESSMENT_SPEC'` para `source_locator LIKE 'exam-vertical-config:%'`. | Curriculum UI y catálogo filtran CURRICULUM; las vistas de examen no cambian. |
| M9 | `assessment_pathways`, `pathway_steps`, `assessment_eligibility_rules`, `institution_assessment_events`, `student_academic_periods`, `student_period_subjects` | Las reglas copian `rules.ts` 1:1. Los periodos se derivan del perfil actual y de las inscripciones activas (source INFERRED). | `rules.ts` queda como fallback hasta lograr paridad 55/55. |
| M10 | `assessment_series`, `exam_instances.series_*`, `blueprint_id`; `student_exam_profiles.target_session_id`, `subject_level_id`, `route_key`, `target_outcome` | Instancias existentes → sin serie (NULL) | Mocks existentes siguen funcionando. |

El **loader de exámenes** (`apply-vertical-config`) deja de crear `structure_versions` con purpose CURRICULUM. Crea `ASSESSMENT_SPEC` solo cuando la familia no tiene un currículo propio enlazado (PAA, PISA, Saber 11). Para IB y Cambridge, los targets apuntan a objetivos del currículo (sílabo) cuando exista el mapeo publicado; mientras no exista, siguen apuntando a los ASSESSMENT_SPEC actuales. Así no se pierden filas ni referencias.

---

## J. Implementation Plan

Cada bloque cumple el mismo ciclo, alineado con el proceso por grupos ya acordado:
1. Rama propia desde el SHA congelado anterior.
2. Desarrollo en DEV o en Postgres efímero.
3. Unit + escenarios + regresión completa.
4. SHA congelado.
5. Certificación de migraciones.
6. Candidato Preview inmutable.
7. E2E manual.
8. PASS o FAIL.

Reversible = desactivar el flag de lectura nueva o ignorar las columnas nuevas.

| Bloque | Alcance | DB | Flag / modo | Certificación mínima |
|---|---|---|---|---|
| **BP-0** | Este spec + ADR + tipos y schemas zod (`BlueprintDocumentV2`, `ScoringPipelineV2`, `ExamPathResolution`, `ReadinessRequest`, `PredictionRulesBundle`) + **compilador** `configToBlueprintV2(cfg)` (puro) | No | — | Unit: las 80 configs compilan; huellas estables; invariantes §E.2 |
| **BP-1** | `assessment_families` + `exam_sessions` (M1, M2) + `structure_versions.purpose` (parte de M8) | Sí | lecturas SHADOW | Cert de migración; paridad taxonomía (enum ≡ tabla); regresión V2 / objective-first / eligibility |
| **BP-2** | Multiplicidad de Blueprint + celdas (M3, M4); persistencia del documento compilado | Sí | `BLUEPRINT_V2_READ=shadow` | **Paridad de ensamblaje**: para las 30 configs con banco, el formulario v2 es idéntico al actual con el mismo seed |
| **BP-3** | Predicado único `isItemEligibleForCell` + `eligibilitySql` (G7, G13) | No | shadow diff → enforce | Diff de elegibilidad 0 en las configs actuales; tests de banco (25 + 33) |
| **BP-4** | Scoring Pipeline v2 + boundary sets (M5, M6); IB, Cambridge y AICE con boundaries UNKNOWN → se detienen en weighted %; corrige las unidades (G11) | Sí | por versión (`engine_version`) | Paridad v1 = v2 en RAW; reproducibilidad; cert de migración |
| **BP-5** | Series de Mock (M10 parcial): ordinal, solapamiento duro opcional, formulario de cohorte | Sí | por serie | Escenarios Mock 1 / Mock 2 sin solapamiento cuando el banco alcanza; *shortage* declarado cuando no |
| **BP-6** | Pathways, etapas, reglas y periodos (M7, M8, M9) + `resolveExamPath` (API de solo lectura) | Sí | `EXAM_PATH_RESOLVER=shadow` | Paridad con el resolutor actual (55/55); nuevos escenarios IB DP2, independiente PAA, conflicto clase/perfil, ruta faltante |
| **BP-7** | Adaptador del contrato de Readiness + corrección de G6 (plan Track A exam-specific; F9 por linaje de perfil) | No / mínima | shadow | Tests nuevos que fijen la regla exam-specific (hoy no existen); regresión F9 (20) + bridge (6) |
| **BP-8** | `PredictionRulesBundle` (solo lectura, sin UI) | No | — | Unit IB EARLY / UPDATED / FULL con boundaries UNKNOWN → sin nota |
| **BP-9** | Completitud de datos con fuente: Cambridge Lower Secondary y Checkpoint (estructura), Saber 11 resto de pruebas, IB Diploma rule skeleton, mapeo de los 48 sujetos IB | Datos | — | Cada dato con `source_key`; lo no respaldado queda UNKNOWN |

**Fuera de alcance de estos bloques:**
- UI nueva.
- ENFORCE de readiness de catálogo.
- PAA full-length (decisión vigente: NO).
- Cambios en Producción.
- Retirar `ib.ts` (ver K.3).

---

## K. Decisiones pendientes (del usuario)

1. **Orden.** ¿Arrancar BP-0 (sin DB) inmediatamente? Recomendado: sí. BP-1+ requieren coordinar escrituras en DEV con las otras sesiones (Group 2 E–J del master plan).
2. **Relación con el master plan.** BP-1…BP-9 se solapan con fases de Group 2 (E–J). Hay que decidir si este trabajo **es** Group 2 o corre después de Group 1 PASS. Group 1 aún espera el E2E manual.
3. **G10 — estimación IB inventada en el quiz V1** (flujo certificado). Opciones:
   - (a) retirar la nota estimada;
   - (b) reemplazarla por weighted % con la etiqueta «sin boundaries oficiales»;
   - (c) dejarla con un disclaimer reforzado hasta BP-4.

   Es un cambio de un flujo Student existente, así que necesita tu decisión.
4. **G6 — fuga de evidencia entre exámenes.** Corregir el plan de Track A cambia lo que ve el Student en `/dashboard/plan/exam/[id]`. ¿Lo corregimos en BP-7 o como hotfix independiente antes?
5. **Fuentes oficiales.** Para cargar boundaries, conversiones y fechas de sesión (IB, Cambridge, PAA, Saber) se necesita definir quién provee las fuentes con licencia; IB entrega boundaries a los colegios. Sin eso, el sistema queda deliberadamente en UNKNOWN.
6. **Elegibilidad PAA solo MX/PR.** Está en código sin documento. ¿Se mantiene como regla de datos con esa cobertura o se amplía con fuente?
