# F11-C1 — Concept Reinforcement Execution Orchestration

## Baseline

F11-B closed and frozen at `70f8bf3e09fcc79699d29e11417fe47b3cb5f7e7`. Verified: `git rev-parse HEAD` matched exactly, tree clean, ancestor check confirmed F11-B's implementation commit `2b57d06` included.

## Reusable Practice Contract Found (critical implementation inspection)

`POST /api/quizzes/generate-and-take`'s handlers are module-private (`handleGenerateQuiz`/`handleSubmitQuiz`, not exported), but they call **real, already-exported service functions** — no route-to-route call and no copy/paste was needed:

- `generatePracticeQuestions(conceptId, studentId, subjectId, options)` (`src/services/quiz-generation.service.ts`) — question generation.
- `storeQuiz(studentId, conceptId, subjectId, questions, language, quizMode, conceptIds, v1Marker)` → returns `quizId` (`src/services/quiz-persistence.service.ts`) — persistence.
- `getQuizSession(quizId)` — read-only observation of `status: 'active'|'completed'|'expired'`.
- `completeQuiz(quizId)` — the exact function the real submit handler calls at grading time.

The student still submits through the existing, completely unmodified route. F11-C1 never calls it, never duplicates its grading logic, and never needs a hook into it — completion is **derived/reconciled** by reading `getQuizSession` back (task's own preferred option 3), since options 1/2 weren't available without touching the frozen route.

## Files Changed

- New: `database/migrations/20260929_1000_f11c1_concept_reinforcement_execution.sql`
- New: `src/lib/student/teacher-intervention-execution.service.ts`
- New: `src/app/api/student/teacher-interventions/route.ts`, `src/app/api/student/teacher-interventions/[id]/start/route.ts`
- New: 2 test files, 1 cert runner, 1 cert shell script, this doc
- Modified (additive only): `src/lib/authorization/index.ts` — exports the pre-existing, unmodified `isOwner` (was module-private; used internally by `canAccessLearner`'s Owner branch since F1/F2). Nothing about its logic changed.

## Execution Registry

`teacher_intervention_executions`: `id`, `teacher_intervention_id` (real FK), `execution_type` (CHECK, only `'TOPIC_PRACTICE'` today), `execution_reference` (text, no cross-table FK — verified safe against `quiz_sessions`' own id-minting scheme, not merely assumed), `idempotency_key`, `status` (`ACTIVE|COMPLETED|EXPIRED`), `started_at`, `completed_at`, `created_at`, `updated_at`. Two uniqueness constraints: `UNIQUE(teacher_intervention_id, idempotency_key)` (orchestration-level idempotency) and `UNIQUE(execution_type, execution_reference)` (verified safe: F11-C1's own service is the only writer, and `storeQuiz` mints a fresh id every call).

## Student Read Model

`getStudentPendingTeacherInterventions(studentId)` — `studentId` is **always** server-resolved from the caller's own identity (`getOrCreateStudentId`), never accepted as a request parameter, so there is no value for a caller to substitute. Returns only `ASSIGNED`/`IN_PROGRESS` (by stored status), lazily reconciling any `IN_PROGRESS` intervention whose linked execution has independently completed, before returning. Cancelled rows never appear. `study_plans` and Canonical V2's mission concept were not reused, per instruction.

## Student Execution API

`GET /api/student/teacher-interventions` (no params — always "mine"). `POST /api/student/teacher-interventions/[id]/start` (`{ idempotencyKey }` body, required) — `id` is the only client-supplied identifier, and it is only ever used to look up the intervention row and check `isOwner(actor, intervention.student_id)`; there is no path where a client-supplied learner identity is trusted.

## Idempotency Design & Results

Row-lock design (`SELECT ... FOR UPDATE` on `teacher_interventions`, mirroring F8's own `recordInterventionAttempt` precedent): authorization + executability + idempotency-key lookup all happen inside one locked transaction; the (necessarily external, must-never-hold-a-lock) AI generation call happens after that transaction commits; the final registry insert relies on the `UNIQUE(teacher_intervention_id, idempotency_key)` constraint as the ultimate concurrency guard, recovering the winning row on a `23505` conflict.

**Accepted, documented trade-off**: under a genuine two-request race with the identical key, at most one *extra, unreferenced* `quiz_sessions` row could be created (harmless, ordinary practice data) before the constraint resolves which `teacher_intervention_executions` row wins — but exactly one registry row, and one deterministic returned reference, is always the outcome. Proven for real:
- Sequential retry (same key twice): second call `RECOVERED`, identical `executionId`, exactly 1 row.
- **Real concurrency** (`Promise.all`, same key): both calls resolve to the identical `executionId`, exactly 1 row.
- Different keys on the same still-`IN_PROGRESS` intervention: 2 distinct rows (0..N cardinality proven, not silently collapsed to 1:1).

## Lifecycle Results

`ASSIGNED → IN_PROGRESS`: proven triggered by a real execution row being created (never by viewing/listing). `IN_PROGRESS → COMPLETED`: proven triggered by the linked `quiz_sessions` row reaching `'completed'` via the real, unmodified submit path (simulated using the exact same `updateMastery`/`completeQuiz` functions, same `operationType: 'QUIZ_SUBMISSION'` identity shape the real route uses) — **with an INCORRECT answer**, proving completion is never conditioned on a passing score or improvement.

## Security/Adversarial Results (12/12 PASS, real Postgres)

All 12 required cases executed for real: assigned-student list/access (1), cross-student denial (2/10), Parent-cannot-execute (3), assigning-Teacher-cannot-execute (4), unrelated-Teacher-cannot-execute (5), Student-executes-own (6), CANCELLED-cannot-start (7), effectively-EXPIRED-cannot-start (8), COMPLETED-cannot-start-another (9), Owner-does-not-imply-Teacher (11 — the Student actor's own attempt to call `assignTeacherIntervention` was rejected), and PARENT+TEACHER-actor-with-real-relationships-to-other-students-still-denied-for-an-unowned-student (12).

## Canonical Evidence Proof

Exactly one new `learning_evidence` row appeared after the simulated submission (before/after count asserted); F11-C1's own source code contains zero references to `learning_evidence`/`mastery_records`/`INSERT`/`updateMastery` (source-guard test), so that row was produced entirely by the real, unmodified Practice engine. No duplicate.

## Cancellation-After-Start Semantics (implemented and proven)

Cancelling after an execution has already started: the linked `quiz_sessions` row is left untouched (`status` still `'active'`, never abandoned), the `teacher_intervention_executions` row remains historically `ACTIVE` (never mutated), a new start attempt is blocked (`NOT_STARTABLE`), and — proven concretely — completing that pre-existing execution afterward still writes real evidence normally, while the Teacher Intervention itself remains `CANCELLED` (never resurrected to `COMPLETED`).

## Bugs Discovered

One, in the **certification fixture**, not in F11-C1's own code: `updateMastery` (F5, unmodified) requires an `ACTIVE` row in `mastery_policies`, which no migration seeds by default — every certification script that exercises real evidence writing must seed one itself. Fixed by adding `seedMasteryPolicy()` to this cert runner. Separately (not a bug, an accepted environmental limitation): AI question generation returns zero questions without provider credentials in this environment — `generatePracticeQuestions` degrades gracefully (returns `[]` rather than throwing, per its own existing, unmodified behavior), so orchestration still succeeds in creating a real `quiz_sessions` row; question-content quality is out of scope here, matching the standing `AI_REAL_PROVIDER: DEFERRED` pattern every prior phase has carried.

## Regression Results

F2 (58 unit + real-Postgres cert), F5/F8/F9/quiz/mastery/evidence-related suites (49 files / 691 tests total across the named regression set), F10 (31 unit + real-Postgres cert + multi-role check), F11-A (13 unit + real-Postgres cert), F11-B (20 unit + real-Postgres cert) — **all PASS, unchanged**. Full repository suite: **5563/5563 PASS** (18 net new). `tsc --noEmit`: clean. `next build`: clean, both new routes present.

## Deferred Execution Adapters (explicit, not implemented here)

- **F11-C2 — Skill Practice execution adapter**: requires resolving `skill_id` → `canonical_concept_skills` → `resolveStudentConceptForCanonicalConcept` (may return `null` for a given student) before any launch is possible.
- **F11-C3 — Competency Practice execution adapter**: same resolution chain, one hop further (`skill_competencies`/`canonical_concept_competencies`).
- **F11-C4 — Exam Practice execution adapter**: native support exists in F9's `getSimulationEligibility({..., learningObjectiveId})`, conditional on the student having an active, blueprint-matching Exam Profile.
- **Future decision — optional F8 remediation adapter**: whether/how a Teacher Intervention should ever launch an F8 `intervention_session` (which itself requires a pre-existing `learner_gap_diagnoses` row, currently owner-gated at the route level) remains an open architectural question, not resolved or implemented in F11-C1.

None of these are implemented; `SKILL_PRACTICE`/`COMPETENCY_PRACTICE`/`EXAM_PRACTICE` all correctly return `NOT_EXECUTABLE_YET` today, proven in certification.

## Commit SHA

`3f52320` on `f11c1/concept-reinforcement-execution` (implementation + certification + documentation, one commit).
