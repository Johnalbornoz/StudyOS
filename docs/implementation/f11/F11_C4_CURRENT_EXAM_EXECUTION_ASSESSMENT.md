# F11-C4 — Current Exam Execution Assessment (inspect-first)

Real inspection of F7/F8/F9/F11-B/C1-C3 before any source change, per task §3.

## Reusable F7 contracts (verified by direct code reading)

- `exam-definition.service.ts`: `getExamVersion(id, client?)` (accepts an executor, so callable inside a transaction), `getPublishedExamVersion(examDefinitionId)`.
- `student-exam-profile.service.ts`: `getStudentExamProfile(id)` — returns `studentId`/`examDefinitionId`/`examVersionId` (the last is **nullable** — a profile need not pin a version).
- `full-mock-guard.service.ts`: `canFullMockBeOffered(examVersionId)` — the real, structural Full Mock platform-capability check (component support/timing/tool-rule configuration + objective mapping).
- `evidence-bridge.service.ts`: `bridgeExamResponseToEvidence` exists but has **zero callers anywhere in `src/`** other than its own file — F9's real simulation-response path (`recordSimulationItemResponse`) writes Evidence inline itself, never through this bridge. Not used by F11-C4 either; noted for accuracy, not assumed to be the active path.

## Reusable F9 contracts (verified by direct code reading)

- `eligibility.service.ts`: `getSimulationEligibility({studentId, examVersionId, simulationType, learningObjectiveId?, academicSubjectId?})` — dispatches to `getFullMockEligibility` for FULL_MOCK, `canFullMockBeOffered`-derived logic for MINI_MOCK, and blueprint-target-driven logic for TOPIC_EXAM/DOMAIN_EXAM. **This single function is the entire Full Mock Guard surface F11-C4 depends on** — calling it unconditionally, for every simulation_type, is what keeps the guard unbypassable.
- `plan.service.ts`: `buildSimulationPlan(...)` — pure DB reads/writes, **zero AI/external calls**. Throws `TimingConfigurationError` only when `timingMode !== 'UNTIMED'` and a component lacks configured timing.
- `attempt.service.ts`: `startSimulationAttempt(...)` — calls `buildSimulationPlan` + F7's real `startExamAttempt`, then inserts one `simulation_attempts` row. Also pure DB work, no AI. `completeSimulationAttempt(id)` finalizes both `exam_attempts` (F7) and `simulation_attempts` (F9) atomically-in-effect (two sequential status-guarded UPDATEs), throwing if not ACTIVE/PAUSED — this is F9's own, already-certified double-finalization guard.
- `scoring.service.ts`: `recordSimulationItemResponse(...)` — the REAL grading + Evidence-writing path for a simulation response. Grades via the four existing graders, persists via F7's `recordExamAttemptItemResponse` (idempotency-key protected), then calls the real, unmodified `updateMastery` with `sourceType: 'EXAM_SIMULATION'` — metadata (`skillIds`, `framework.examVersionId`, `commandTermId`, `questionType`) attached **only when genuinely resolved** via `resolveActivityMetadataForObjective`/`resolveStudentConceptForCanonicalConcept`, never fabricated. Notably: this path never attaches `competencyIds` — only Skill metadata flows through simulation responses today (a real, current-state fact, not a design choice F11-C4 makes).
- `post-exam-diagnosis.service.ts`: `runPostExamDiagnosis(examAttemptId, studentId, examVersionId)` — calls F8's real `runDiagnosis` per distinct (concept, scope) touched by the attempt. Never a second post-exam classifier.
- `readiness/readiness.service.ts`: `computeReadinessSnapshot({studentId, examProfileId, examVersionId})` — append-only, inserts a NEW snapshot row every call, never mutates a prior one.
- The real `/api/simulation/attempts/[id]/complete` route's own body is the canonical reference for "what a legitimate completion does": `completeSimulationAttempt` → `getSimulationScoreSummary` → `runPostExamDiagnosis` → `computeReadinessSnapshot` → `determineNextAction`. F11-C4 never calls any of these itself (source-guard proven) — they remain the Student's own real completion flow's responsibility.

## Student Exam Profile requirements

A profile (`student_exam_profiles`) is a real, per-student row (`student_id` FK) with an OPTIONAL `exam_version_id`. Ownership is a plain equality check (`profile.studentId === targetStudentId`) — there is no additional status gate relevant to F11-C4 beyond that.

## Supported simulation levels (current repository truth)

All four (`TOPIC_EXAM`, `DOMAIN_EXAM`, `MINI_MOCK`, `FULL_MOCK`) have real, working, already-certified F9 service contracts (`getSimulationEligibility`/`buildSimulationPlan`/`startSimulationAttempt` all dispatch generically on `simulationType`, with no missing branch for any of the four). **Full Mock Guard is a real, data-driven check, not a hard-coded PAA special case** — `canFullMockBeOffered`/`getFullMockEligibility` return `eligible: false` for PAA in this environment specifically because F9's own real fixture (`f9-seed-pilot-dataset.ts`) leaves the Reading component genuinely UNSUPPORTED — this is honest current platform state, not a fabricated blocker, and Cambridge's separate, fully-configured exam version in the SAME fixture proves the FULL_MOCK path itself works correctly when the underlying data is complete.

## Current PAA limitations (verified, not assumed)

PAA Full Mock is genuinely NOT_READY today: Reading Section is `support_status = 'UNSUPPORTED'`, has no timing/tool-rule configuration, and its objective has no F6 mapping. Mathematics is fully configured and mapped. This is real, current, honest platform state — F11-C4 must never work around it.

## Exam-attempt ownership model

`exam_attempts.student_exam_profile_id` → `student_exam_profiles.student_id` is the real ownership chain; `simulation_attempts.student_id` additionally denormalizes it directly onto the wrapper row for convenient querying (both point to the same real student).

## Evidence-producing path

Simulation responses produce Evidence through `recordSimulationItemResponse` → real, unmodified `updateMastery` (`sourceType: 'EXAM_SIMULATION'`). This is the ONLY Evidence-writing path a simulation attempt has; F11-C4 never calls it, never duplicates it, and never needs to for its own orchestration responsibilities (starting an execution, observing completion).

## Idempotency model — and why F11-C4's needs to be STRONGER (task §31)

F9's own idempotency exists only at the RESPONSE level (`exam_attempt_item_responses.idempotency_key`) — there is no idempotency protection at all on `POST /api/simulation/attempts` (attempt CREATION). C1/C2/C3's own idempotency model (claim-check under a row lock, but do the slow AI-generation work AFTER releasing the lock, relying on a `UNIQUE(teacher_intervention_id, idempotency_key)` constraint to catch a genuine race) is **not strict enough here**: a race that creates two real `exam_attempts`/`simulation_attempts` rows is not the same harmless orphan as an unreferenced `quiz_sessions` row, because an exam attempt is a real, potentially-finalizable resource. However, `buildSimulationPlan`/`startExamAttempt` (unlike `generatePracticeQuestions`) involve **zero AI/external calls** — pure DB work — so F11-C4's entire claim-and-create sequence can safely run INSIDE the same row-locked transaction that guards the idempotency check, eliminating the race structurally rather than merely tolerating its residue. This is the one deliberate architectural departure from C1-C3's pattern, and it is possible only because of this specific, verified fact about F9's attempt-creation cost profile.

## Potential overlap with F9 APIs

None found: F11-C4 calls the exact same service functions the real `/api/simulation/attempts` and `/api/simulation/attempts/[id]/complete` routes call, never the routes themselves (no route-to-route HTTP), and never re-implements any part of eligibility, planning, attempt lifecycle, scoring, diagnosis, or readiness.

## Smallest additive extension required

1. `teacher_interventions` target model gains a fourth branch, `target_type = 'EXAM'`, with three new nullable columns (`exam_profile_id`, `simulation_type`, `academic_subject_id`) — `learning_objective_id` (already existing, added by F11-B, never yet used) is reused for TOPIC_EXAM's objective target.
2. `teacher_intervention_executions.execution_type` gains a fifth value, `EXAM_PRACTICE`, whose `execution_reference` is a real `simulation_attempts.id`.
3. One new orchestration function, `startExamReinforcementExecution`, and one new dispatcher branch.
4. `reconcileCompletionsForStudent` branches by `execution_type` to observe `simulation_attempts.status` instead of `quiz_sessions.status` for EXAM_PRACTICE rows.

No new table. No new Evidence writer. No new scoring/generation/readiness/diagnostic engine.
