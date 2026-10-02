# StudyUS — Learning Plan Orchestrator (Track A, DEV)

Curriculum → Class Plan → Personal Plan → Learning Engine → Exams → Reinforcement.

- **Curriculum** = what exists / what is advisable (StudyUS catalog, institution curriculum).
- **Learning Plan** = what each learner works on (personal plan, fed by many sources).
- **Learner Model** = what the learner knows (canonical decision, evidence, mastery). Unchanged.

All three speak the canonical model (`canonical_concepts`). No second Learning Engine: every "Empezar / Continuar" launches the existing session start (`StartSessionButton` → `/api/learning/session/start`), and every phase shown is read from `getCanonicalPedagogicalDecision` (read-only).

Migration: `database/migrations/20261018_1400_track_a_learning_plan_orchestrator.sql` (governed, additive).

---

## 1. Audit

### CURRENT_LEARNING_PLAN_MODEL (before this phase)

| Piece | What it was |
|---|---|
| Learner concepts | `subjects` → `concepts` per learner, with `concept_catalog_mapping` (MATCHED / UNMATCHED) to the catalog. Only 1 MATCHED mapping existed on DEV. |
| "Plan" | Implicit: whatever concepts the learner had. No intent (archive), no provenance beyond `concepts.origin` (Track A 1300). |
| `learning_plan` / `learning_plan_item` | A 14-day **scheduler** whose sole writer is `learning-plan-projector`. Reserved — not a curriculum plan; not reused. |
| Curriculum | `academic_subjects → structure_versions (PUBLISHED) → structure_nodes → learning_objectives → objective_concept_mappings`. No institution layer, no class layer. |
| Exams | `exam_attempts` + `exam_attempt_item_responses` per objective; Track B `exam_attempt_results.objective_results` (GAP). `determineNextAction` output discarded: no exam → plan bridge. |
| Teacher | Assignments (`teacher_interventions`) that merge the concept into the learner plan (Track A `fff2e29`). No class plan, no matrix. |

### REUSABLE_COMPONENTS (reused, not reimplemented)

- Canonical decision (`getCanonicalPedagogicalDecision`) — phases, next action.
- Session launch (`StartSessionButton`, `resolveCanonicalLaunch`).
- Concept resolution (`resolveStudentConceptForCanonicalConcept`), catalog mapping service.
- Published curriculum graph (structure nodes, objectives, objective→concept mappings) for the base curriculum and exam blueprints.
- Governed assessment services (`createStudentExamProfile`, `startExamAttempt`, `recordExamAttemptItemResponse`, `completeExamAttempt`).
- Authorization: `getTeacherClass`, `canTeacherAccessLearner`, `canAccessInstitution`, `requireInstitutionAdminActor`, `guardAdminUsersRoute`.
- Role notifications (`notifyInstitutionAdmins`), class assignment flow (`publishClassAssignment`).

### STRUCTURAL_GAPS (found)

1. No canonical **topic** level (structure nodes act as areas for published curricula; canonical subjects for the general one).
2. No canonical **localization** (catalog labels in one language only).
3. `canonical_concept_prerequisites` has **0 rows** on DEV.
4. Mathematics and Matemáticas are **separate canonical subjects** (equivalence via the subject catalog key).
5. Low MATCHED coverage: most learner concepts never linked to the catalog.
6. DEV contains drift table `learning_concept_proposals` (no code uses it) — left untouched; this phase uses its own `concept_proposals`.

### MIGRATION_PLAN (applied, `20261018_1400`)

| Table | Purpose |
|---|---|
| `canonical_concept_localizations` | display label per (canonical concept, language). Identity stays the id. |
| `student_plan_entries` | **1 student + 1 canonical concept = 1 entry** (`UNIQUE(student_id, canonical_concept_id)`), pointing at the ONE learner concept (`learner_concept_id UNIQUE`). `plan_status` IN_PLAN / ARCHIVED = intent only. |
| `student_concept_sources` | why it is in the plan: SELF_SELECTED, CURRICULUM_RECOMMENDATION, INSTITUTION_CURRICULUM, CLASS_PLAN, TEACHER_ASSIGNMENT, EXAM_GAP, PREREQUISITE_RECOMMENDATION. Unique per (type, key); deactivated, never deleted. |
| trigger `trg_one_learner_concept_per_canonical` | DB guard: a learner can never have two MATCHED learner concepts for one canonical concept (23505). |
| `institution_curricula`, `institution_curriculum_concepts` | institution curriculum per subject / grade / year; REQUIRED · RECOMMENDED · OPTIONAL · SUPPLEMENTAL, period, order; ACTIVE / REMOVED. |
| `class_plan_concepts` | class learning plan: priority, target date, period, required, supplemental; ACTIVE / REMOVED. |
| `concept_proposals` | PROPOSED → MAPPED_TO_EXISTING / MERGED / APPROVED / REJECTED, with candidate equivalents. |
| `learning_recommendations` | EXAM_GAP recommendations (OPEN / ACCEPTED / DISMISSED). |
| `student_plan_events`, `curriculum_events` | audit trail. |
| backfill | plan entries + sources from existing MATCHED mappings. |

Certified by `scripts/operations/track-a-roles-migration-cert.sh` (apply → rollback → re-apply on an ephemeral copy).

---

## 2. Authority model

| Actor | Governs | Can never |
|---|---|---|
| StudyUS (Platform Admin) | the catalog; resolves concept proposals | — |
| Coordinator (INSTITUTION_ADMIN of the institution) | institution curriculum: adopt base, classify, add existing concepts, remove / restore | modify the catalog; delete learner state or history |
| Teacher (of the class) | class learning plan: add / remove / priority / dates / period / required; assign to all or selected; propose concepts | alter mastery, evidence or phases; act outside their class |
| Student | personal plan: add, archive / restore, accept / dismiss recommendations | claim a class / curriculum source the server cannot verify |

## 3. Universal rules

- **Merge**: `enrollCanonicalConcept` (one transaction, per-learner advisory lock) reuses the learner's existing concept → else links an existing unmatched concept with the same label (exactly one candidate, translation-safe) → else creates it at "not started" (zero record, no evidence). Then upserts the entry (restores if archived) and the source. Idempotent.
- **Progress never resets**: no path writes learning evidence, mastery updates, or phases. Archiving, removing from a class plan or a curriculum only changes intent / provenance.
- **Available ≠ in plan**: curricula and class plans enroll nobody; REQUIRED shows as "Obligatorio y aún sin empezar".
- **Plan status** (`derivePlanStatus`, pure projection): IN_PLAN → ACTIVE (evidence) → MAINTENANCE (RETAIN / TRANSFER) → COMPLETED (CONSOLIDATED); ARCHIVED. SUGGESTED = a recommendation not yet accepted.
- **Exam gap**: latest result per learner × objective with fraction < 0.5 (or Track B GAP) → published objective mappings → EXAM_GAP recommendation; a dismissed gap reopens only on a later attempt.

## 4. Surfaces

| Who | Route | What |
|---|---|---|
| Student | `/dashboard/plan` | Mi plan · Explorar currículo · Recomendado para mí · Preparar un examen |
| Student | `/dashboard/plan/exam/[profileId]` | exam blueprint × learner model |
| Teacher | `/dashboard/teacher/classes/[id]` (+ `/plan`, `/students`, `/assignments`, `/progress`) | Resumen · Plan de aprendizaje · Estudiantes · Tareas · Progreso (matrix) |
| Coordinator | `/dashboard/institution/[id]/curriculum` | adopt, classify, remove / restore, supplemental suggestions, proposals |
| Platform Admin | `/dashboard/admin/concept-proposals` | resolve proposals (equivalents first) |

APIs: `/api/student/{plan,plan/[cc]/archive,curriculum,recommendations,recommendations/[id]/{accept,dismiss},exam-prep/[id]/plan}`, `/api/teacher/classes/[id]/{plan,plan/[cc]/{assign,remove},matrix,needs,assignment-preview,concept-proposals}`, `/api/institutions/[id]/{curricula,curricula/[cid],curricula/[cid]/concepts,curricula/[cid]/concepts/[cc]/remove,concept-proposals}`, `/api/admin/concept-proposals{,/[id]/resolve}`.

## 5. Security matrix

| Action | Student (self) | Other student | Teacher of class | Other teacher | Coordinator (own inst.) | Other coordinator | Platform Admin |
|---|---|---|---|---|---|---|---|
| Read / change own plan | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Accept / dismiss own exam recommendation | ✅ | ❌ 404 | — | — | — | — | — |
| Class plan, matrix, needs, assign | ❌ | ❌ | ✅ | ❌ 403 | ❌ | ❌ | ❌ |
| Assign to a learner outside the class | — | — | ❌ 404 | — | — | — | — |
| Institution curriculum | ❌ | ❌ | ❌ 403 | ❌ | ✅ | ❌ 403 | — |
| Resolve concept proposal | ❌ | ❌ | ❌ | ❌ | ❌ 403 | ❌ | ✅ |

Needs expose names only (no scores, no tutor data); exam data of learners outside the class never appears.

## 6. Automated evidence

- Unit: `tests/unit/learning-plan-orchestrator.test.ts`, `learning-plan-exam-bridge.test.ts`, `learning-plan-recommendations.test.ts`, `track-a-teacher-plan-assignment.test.ts`, source guards (`track-a-source-guards.test.ts`).
- HTTP E2E: `scripts/operations/track-a-learning-plan-e2e-http.ts` (scenarios 53–57: independent student, coordinator, 20-learner class in mixed states, exam gap, teacher + exam gaps). Builds its own fixture world (TA Institución LP, `LP Matemáticas 11`, 19 DB-only synthetic learners + Sofía); `track-a-fixtures.ts learning-plan-teardown` removes it.
- Catalog labels: `scripts/operations/seed-canonical-localizations.ts` (DEV-guarded, dry-run default).

---

## 7. Manual E2E packages

Hosted DEV immutable URL, sign-in links and DB checks are delivered with the readiness report (one-time links expire). Every step: URL · action · expected · screenshot · read-only query · PASS/FAIL.

### 7.1 Student

**Independent student**
1. `/dashboard/plan?tab=explore` → pick a subject → the curriculum appears by areas (localized labels); nothing is in the plan yet. *Query*: `SELECT COUNT(*) FROM student_plan_entries WHERE student_id = :me` = 0.
2. "Añadir a mi plan" on a concept → appears in Mi plan as "En mi plan", source "Lo elegiste tú". Press again (or refresh + add) → no duplicate. *Query*: one row per (student, concept); one MATCHED mapping.
3. "Empezar" → the normal learning session opens (Learning Engine).
4. Recomendado para mí → "siguiente en tu currículo"; add one → enters the plan with its source.

**Institutional student**
5. As a learner of a class: Recomendado shows "Lo trabajará tu clase …" (class plan) and "Obligatorio en … y aún sin empezar" (REQUIRED) — neither is auto-added.
6. A Teacher assignment / assign-all: Mi plan shows source "Tu clase · <clase>"; a concept already studied keeps its phase and history.
7. Self-select another concept → both sources coexist on one entry. Archive → Restaurar → same phase.

### 7.2 Teacher

1. Class → **Plan de aprendizaje**: suggested curriculum with classification, coverage "n de N lo tienen en su plan", prerequisites.
2. Add concepts to the class plan; edit priority / target date / period / required.
3. **Asignar a estudiantes seleccionados** → preview "X ya lo tienen · Y lo incorporarán · Z ya van avanzados" → Asignar.
4. **Asignar a toda la clase** → preview → Asignar; repeat → nothing changes (idempotent).
5. **Progreso**: concept × phase matrix; open a cell → names → learner detail.
6. **Estudiantes** → learner detail: phase, next step, practice, sources.
7. **Necesidades detectadas** (after learners take an exam): "N estudiantes muestran dificultad reciente" → **Asignar a estos N**.
8. Add a concept outside the institution curriculum → "Complementario"; the coordinator gets a notification.
9. **Proponer un concepto nuevo** → equivalents suggested ("Puede que ya exista …").

### 7.3 Coordinator

1. Institution → **Currículo** → Adoptar currículo (published base, e.g. IB, or the subject's general catalog) → concepts seeded as RECOMMENDED (base proposal; nobody starts from an empty page).
2. Classify REQUIRED / RECOMMENDED / OPTIONAL / SUPPLEMENTAL, set periods.
3. A teacher's supplemental concept appears in "Conceptos complementarios de los docentes" → Añadir al currículo.
4. Propose a concept → visible in Propuestas; Platform Admin resolves it (`/dashboard/admin/concept-proposals`) → status updates here.
5. Retirar a concept → "Retirado"; learners keep entries, phases and history. Restaurar → back. *Query*: `curriculum_events` rows for each action.

### 7.4 Exam bridge

`Exam → Gap → Recommendation → Add to plan → Learning Engine → Retest`
1. Take an exam (Preparar un examen → exam preparation / simulation) and complete it.
2. Recomendado para mí → "Un examen mostró que conviene reforzarlo" for the weak objectives' concepts.
3. "Reforzar" (already in plan → "Ya estás trabajando este concepto", same learner state) / "Añadir a mi plan" (new) / "Descartar".
4. Exam preparation plan (`/dashboard/plan/exam/<profile>`) → "Necesita refuerzo" per concept.
5. "Continuar" → Learning Engine session on that concept.
6. Retest: a later attempt that passes the objective removes the gap (only the latest result counts).

---

## 8. Known debt

| P | Item |
|---|---|
| P1 | `canonical_concept_prerequisites` empty on DEV: prerequisite recommendations are implemented and unit-tested but produce nothing until the catalog has prerequisites. |
| P1 | Catalog localizations exist only where seeded (`seed-canonical-localizations.ts`, es/en, DEV). New catalog concepts need labels; de / fr / pt UI strings fall back to English for this feature. |
| P2 | Today does not yet merge plan sources (class plan / exam gap) into its CTAs; the plan page is the entry point. |
| P2 | No canonical topic level: areas come from published structure nodes or canonical subjects. |
| P2 | Mathematics vs Matemáticas are separate canonical subjects (equivalence by catalog key; a teacher of a "Mathematics" class sees only that subject's concepts). |
| P2 | Exam objectives without a published concept mapping produce no gap (counted as "objetivos aún no vinculados" in the exam plan). |
| P3 | Low MATCHED coverage of pre-existing learner concepts (only linked on enrollment / assignment). |
| P3 | DEV drift table `learning_concept_proposals` unused. |
