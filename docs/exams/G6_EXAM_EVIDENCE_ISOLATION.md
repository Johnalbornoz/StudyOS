# StudyUs — G6 · Aislamiento de evidencia por Exam Target

| Campo | Valor |
|---|---|
| Rama | `integration/exam-platform-v2-e2e` (local; sin push, sin merge a `main`, sin deploy) |
| Base certificada | `d4de854` (QB + Blueprint V2 shadow + Student Journey V2) |
| Migración | **No.** El esquema ya tenía la identidad necesaria (§10) |
| Hosted (DEV / Preview / Production) | **Sin cambios** |

**Objetivo.** La evidencia de un Exam Target no puede alterar la readiness, los gaps, el estado del diagnóstico ni la siguiente acción de otro examen.

**Lo que G6 no hace.** No corta la transferencia longitudinal de conocimiento. PAA puede seguir aportando conocimiento a PISA. Lo que ya no puede es hacer que StudyUs afirme que un requisito específico de PISA está cubierto o que su diagnóstico ya no hace falta.

## 1. Causa raíz

`recordSimulationItemResponse` (`simulation/scoring.service.ts`) escribe cada respuesta de un intento de examen en la tabla compartida `learning_evidence` (`source_type = 'EXAM_SIMULATION'`) y actualiza el Knowledge State del concepto. Esa evidencia tenía `metadata.context.examAttemptId` y `metadata.framework.examVersionId`, pero no el target. Además, ningún lector exam-specific filtraba por identidad: todos unían por `student_id` → concepto canónico / objetivo.

## 2. Flujo anterior (reproducido en `d4de854`)

Escenario real sobre Postgres efímero: catálogo gobernado completo, PAA y PISA 2022 que comparten 16 conceptos canónicos, y un intento PAA real sobre 9 objetivos.

| Lector | Antes de G6 (tras el intento PAA) |
|---|---|
| Plan PISA (`buildProfilePlan` → `classifyRequirement`) | 21 NO_EVIDENCE → **13 NEEDS_CONFIRMATION** (labels del Knowledge State alimentado por PAA) |
| `nextStep` PISA | `DIAGNOSTIC` → **`PRACTICE`** (el diagnóstico de PISA se salta) |
| `deriveExamGaps` / `getExamPreparationPlan` PISA | **16** gaps PAA mostrados como NEEDS_REINFORCEMENT de PISA |
| `computeReadinessSnapshot` PISA | **6** evidencias PAA contadas; cobertura del blueprint **7/21** «SUPPORTED_AND_EVIDENCED» |
| Diagnóstico de un target PISA | lee **4/4** filas legacy sin identidad |
| Onboarding gate | targets técnicos / internos / retirados cuentan (**3**) |

Resultado: `g6-exam-evidence-isolation-cert.ts` en modo `observe` sobre `d4de854` da **16/30**. Tras G6, en modo `assert`, da **34/34**.

## 3. Nuevo contrato de alcance (`src/lib/exam-core/evidence-scope.ts`)

| Alcance | Definición | Knowledge State | Decisiones del examen X |
|---|---|---|---|
| `LONGITUDINAL` | Evidencia del Learning OS, incluido el quiz en modo «exam_simulation» (`activity_type = 'quiz'`) | sí | sí, como conocimiento |
| `EXAM_TARGET` | Evidencia de un intento del **mismo** target | sí | sí |
| `OTHER_EXAM_TARGET` | Evidencia de un intento de **otro** target (otro examen o el mismo examen archivado) | sí | **no** |
| `UNSCOPED_LEGACY` | `EXAM_SIMULATION` escrita por un writer de intento sin identidad (bridge F7: `activity_type` NULL, sin contexto) | sí | **no** |

**Identidad mínima estable:**
- `examTargetId` (`student_exam_profiles.id`) es la clave de decisión.
- `examVersionId` y `examAttemptId` se guardan como procedencia.
- No se añade `examDefinitionId`: se deriva de la versión y no decide nada.

**Dónde vive la identidad (siempre escrita al crear la evidencia):**
- `metadata.examScope = { examTargetId, examVersionId, examAttemptId, source: 'EXAM_ATTEMPT' }`, desde G6.
- `metadata.context.examAttemptId`, en el writer F9 anterior. El target sale de `exam_attempts.student_exam_profile_id`, que es una FK NOT NULL del propio intento. Es un join determinista, no una inferencia por similitud.

Nunca se usa concepto, asignatura, dominio o familia para decidir el examen. El SQL (`inExamScopeSql`) recibe el target como parámetro ligado.

## 4. Write path

| Archivo | Cambio |
|---|---|
| `simulation/scoring.service.ts` `recordSimulationItemResponse` | Nuevo parámetro `examTargetId`. El writer lee el target del propio intento (`exam_attempts`), rechaza un target del llamador que no coincida y escribe `metadata.examScope`. Si el intento no se puede leer, no fabrica nada: queda `context.examAttemptId`. |
| `simulation/item-resolution.service.ts` `commitAnswer` | Pasa `examTargetId: loaded.attempt.examProfileId` |

Diagnóstico, práctica, mock y examen pasan todos por este único writer: instancias V2 → intento de simulación → `commitAnswer`.
- **Bridge F7** (`bridgeExamResponseToEvidence`): no tiene llamadores en `src`. Queda como fuente `UNSCOPED_LEGACY`.
- **Quiz del Learning OS:** es longitudinal, no es un intento de examen.

## 5. Read paths

| Lector | Cambio |
|---|---|
| `preparation.service.ts` `examEvidence` | `sameExam` = `sa.exam_profile_id = target`. Antes era el mismo `config_key`. |
| `preparation.service.ts` `learnerStates` | Cuenta, por concepto, la evidencia en alcance y la evidencia de examen fuera de alcance (`LearnerConceptState.examScope`). El Knowledge State no se toca. |
| `preparation-plan.ts` `classifyRequirement` / `buildPreparationPlan` | Usa `examRequirementLabel` (§8). El resultado de otro examen por sí solo ya no saca un requisito de NO_EVIDENCE: queda como razón `OTHER_EXAM_*`. |
| `nextStep` | Sin cambio de código. Recibe conteos ya aislados, así que el diagnóstico propio ya no se salta. |
| `exam-bridge.service.ts` `deriveExamGaps` | Recibe `opts.examProfileId` (filtro de lector exam-specific). «Último resultado» se calcula por estudiante × **target** × objetivo, así que otro examen no cierra ni abre un gap de este target. `ExamGap.examProfileId` nuevo. |
| `getExamPreparationPlan` | Pasa `{ examProfileId }` |
| `readiness.service.ts` | `computeSimulationPerformanceStats` por `sa.exam_profile_id`; `computeEvidenceSufficiencyStats` con `inExamScopeSql` |
| `blueprint-coverage.service.ts` | El chequeo de evidencia y el diagnóstico del target usan el alcance del target |
| `diagnosis.service.ts` / `evidence-gate.service.ts` | `runDiagnosis({ examTargetId })` → `fetchEvidenceForDiagnosis(..., { examTargetId })`. Sin target es la vista general del Learning OS (`/api/diagnostics/run`). |
| `post-exam-diagnosis.service.ts` | El diagnóstico de un intento usa el target de ese intento |
| `exam-gaps.service.ts` `examGapsFor` | El dominio sale de la versión del intento (`b.exam_version_id = g.exam_version_id`). `byObjective` se agrupa por examen. |
| `exam-journey/plan-facts.ts` | `otherExamOnlyRequirements` = requisitos sin evidencia propia con evidencia ajena; `crossExamEvidenceConcepts` = solo la mezcla residual (§8) |

## 6. Evidencia legacy

- No hay backfill, ni `UPDATE` masivo, ni filas borradas.
- Las filas F9 previas ya tenían `examAttemptId` → su target es determinista (`EXAM_TARGET` / `OTHER_EXAM_TARGET`).
- Las filas `UNSCOPED_LEGACY`:
  - siguen en el Knowledge State y en el diagnóstico general;
  - nunca satisfacen un requisito, gap, cobertura o diagnóstico de ningún target (T10/T11).
- El historial de intentos no se modifica.

## 7. Semántica de múltiples targets

- **Targets de exámenes distintos:** aislados en plan, gaps, snapshot, cobertura, diagnóstico y Journey. La salida Journey de PISA es byte-idéntica tras un intento PAA (T1/T14).
- **Mismo examen:** dos targets **activos** del mismo examen no pueden existir. Lo impiden `uq_student_exam_profiles_one_active` y `_one_active_objective`.
- **Caso alcanzable: archivar y recrear (p. ej. repetir PAA).**
  - **Decisión explícita: alcance TARGET.** El target nuevo hace su propio diagnóstico.
  - Los intentos siguen con el target archivado (`listProfileAttempts`).
  - El Knowledge State se conserva (P7, verificado en DB).
  - Por qué: el diagnóstico, el historial y el snapshot ya eran por perfil desde Track B. Reutilizar por versión exigiría decidir caducidad y vigencia, que es trabajo de J3.7 y no de G6.
- **Resultados (fase 8): PASS sin cambios.**
  - `listProfileAttempts` y `findOpenSimulationAttemptForProfile` filtran por `exam_profile_id`.
  - La página de resultado va por intento.
  - Journey `INSTANCES_SQL` filtra por `exam_profile_id`.

## 8. KNOWLEDGE_MASTERY vs EXAM_REQUIREMENT_SATISFACTION

- **Un único Knowledge State por concepto (longitudinal).** No se duplica y sigue recibiendo la evidencia de todos los exámenes (T4).
- **El plan del target usa `examRequirementLabel`:**
  - un concepto conocido **solo** por evidencia de otro target o legacy queda en `NO_EVIDENCE` para este examen;
  - si el conocimiento se apoya en parte en intentos de otro examen, el requisito se puede confirmar aquí, pero nunca queda `ALREADY_STRONG` aquí;
  - el conocimiento longitudinal o el del propio target conserva su significado completo.
- `PlannedRequirement.concepts[]` expone `label` (examen) y `knowledgeLabel` (Knowledge State).
- **Residuo transparente:** cuando un concepto que este target usa también tiene evidencia de otro examen, el Journey lo reporta (`crossExamEvidenceRisk`, razón `CROSS_EXAM_EVIDENCE_RISK`) y no lo oculta. No cambia ninguna decisión: en el cert, la salida de PAA es idéntica en todos los campos de decisión tras un intento PISA (T9).

## 9. Onboarding: target técnico

- `VALID_EXAM_TARGET_PREDICATE` (`student/onboarding-gate.ts`) es el único predicado del gate, del primer destino y del rebote de onboarding.
- Ahora exige además que el target sea Student-valid: objective-first, o una definición que cumpla `studentVisibleDefinitionSql`. Es la misma regla QB-0 de audiencia, reutilizada y no duplicada.
- Técnico (`dev-cert.*`), interno (sin `config_key`) y retirado → no cuentan (T12: 3 → 0).
- Un target Student-valid sigue permitiendo el onboarding independiente sin asignaturas (T13).

## 10. Migración

No hace falta:
- `exam_attempts.student_exam_profile_id` y `simulation_attempts.exam_profile_id` son NOT NULL;
- `learning_evidence.metadata` es jsonb y `updateMastery` lo guarda tal cual.

La cadena sigue en `20261103_1000`. Cert desde base vacía: ver §11.

Corrección de harness: el seed de `mastery_policies` del cert de cadena usaba columnas inexistentes y fallaba en silencio. Ahora usa las columnas reales y falla en alto.

## 11. Tests

| Suite | Resultado |
|---|---|
| `tests/unit/g6-exam-evidence-isolation.test.ts` (nuevo) | 23/23: contrato, etiquetas, cableado de writer y lectores, gate |
| Tests que codificaban la semántica previa | 3 actualizados, a propósito y no debilitados. `exam-objective-first` («resultado de otro examen → NO_EVIDENCE + DIAGNOSTIC») y `journey-shadow-validation` ×2 (aislado sin riesgo; mezcla residual reportada). Además, 2 títulos «legacy, not fixed here» renombrados sin cambiar sus asserts. |
| `g6-exam-evidence-isolation-cert.ts` (DB efímera, real) | **34/34**. Antes, en `d4de854`: **16/30** |
| Unit completo / `tsc` / `next build` / cadena de migraciones | ver `EXAM_PLATFORM_V2_E2E_INTEGRATION.md` §16 |

Mapa T1–T17:

| T | Evidencia |
|---|---|
| T1 | Cert: PISA sigue en `DIAGNOSTIC` / `START_DIAGNOSTIC` tras PAA; mismos conteos; Journey byte-idéntico. Unit: plan con conocimiento solo ajeno → DIAGNOSTIC |
| T2 | Cert: intento PISA → cobertura PISA sube, sale de DIAGNOSTIC |
| T3 | Cert: PAA avanza con su evidencia; gaps PAA presentes |
| T4 | Cert: Knowledge State con evidencia en 9 conceptos; unit `conceptKnowledgeLabel` intacto |
| T5 | Cert: 0 gaps PAA en PISA (`deriveExamGaps` + `getExamPreparationPlan`) |
| T6 | Cert: snapshot PISA 0 evidencias / 0 simulaciones; PAA 9 / 1 |
| T7 | Cert: cobertura PISA 0/21 |
| T8 | Cert: dominios de `examGapsFor` = componentes de la versión PAA |
| T9 | Cert: PAA sin cambios de decisión tras PISA; mezcla reportada |
| T10 | Cert: fila legacy (bridge F7 real) → NO_EVIDENCE en PISA; diagnóstico del target lee 0/4 |
| T11 | Cert: legacy en Knowledge State (4) y en el diagnóstico general (4/4); quiz del Learning OS cuenta para PISA |
| T12 / T13 | Cert: técnico, interno y retirado = 0; PAA Student-valid = 1 sin asignaturas |
| T14 | Cert: Journey PISA byte-idéntico tras PAA; Journey PAA (decisiones) idéntico tras PISA |
| T15 | Cert: plan y Journey idénticos con `EXAM_BLUEPRINT_V2` OFF y SHADOW; unit: ningún lector importa Blueprint V2 |
| T16 | Cert: Saber sin mock completo ni reducido (content NONE) |
| T17 | Unit: un intento técnico es OTHER_EXAM_TARGET; QB-0 sigue excluyendo intentos técnicos y fixtures |

Supuesto del harness: el catálogo efímero solo tiene fixtures DEV, que QB nunca ofrece a un Student. Por eso, para leer plan / next step / Journey, el cert fuerza `canRunDiagnostic` / `canPractice` (y el `content.diagnostic` del Journey) como si PAA y PISA tuvieran contenido Student. Nada más se fuerza.

## 12. E2E-A tras G6

| Escenario | Estado |
|---|---|
| PAA independiente: target sin asignaturas → fecha → Exam Prep | PASS (Journey cert E1, T13) |
| Institucional: contexto reutilizado | PASS (unit J1/J3; sin cambio en G6) |
| Múltiples targets PAA + PISA sin contaminación | **PASS** (G6 cert) |
| Saber: Full Mock estructural de 50 slots + contenido NONE → no disponible | PASS (Journey cert E5, T16) |
| Veracidad: técnico / interno oculto, sin predicción, mocks no soportados no disponibles | PASS |

Ownership sin cambios. No se tocaron las reglas estructurales de Blueprint ni la semántica de readiness de contenido de QB. Blueprint SHADOW sigue siendo solo observación.
