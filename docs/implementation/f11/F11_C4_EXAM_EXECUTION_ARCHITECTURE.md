# F11-C4 — Exam Execution Architecture

## Canonical separation preserved

```
teacher_interventions (F11-B)          = pedagogical intent / assignment, unchanged
teacher_intervention_executions (C1)   = references to real executions, widened vocabulary only
F7 Assessment Configuration            = exam_definitions/exam_versions/blueprints/components (frozen, reused)
F9 Simulation Planning/Attempt         = buildSimulationPlan/startSimulationAttempt/completeSimulationAttempt (frozen, reused)
F9 Scoring/Evidence                    = recordSimulationItemResponse -> real, unmodified updateMastery (frozen, reused)
F8 Post-Exam Diagnosis                 = runPostExamDiagnosis -> real, unmodified runDiagnosis (frozen, reused)
F9 Readiness                           = computeReadinessSnapshot (frozen, reused)
```

F11-C4 adds no new table type, no new lifecycle, no new Student API, no new Evidence writer, no new Assessment/Simulation/Scoring/Readiness/Diagnostic engine. It extends `teacher_interventions`/`teacher_intervention_executions` additively and adds one new orchestration function, `startExamReinforcementExecution`, plus one new dispatcher branch.

## The core principle, verified structurally

```
Teacher Intervention Intent (exam_profile_id + simulation_type [+ learning_objective_id | academic_subject_id])
        v
F11 Execution Orchestrator (startExamReinforcementExecution)
        v
getSimulationEligibility (F9's real, unconditional Full Mock Guard + structural gate)
        v
startSimulationAttempt -> buildSimulationPlan (F9) + startExamAttempt (F7)
        v
[Student's own real, unmodified recordSimulationItemResponse / completeSimulationAttempt flow]
        v
Existing Evidence path (updateMastery, sourceType EXAM_SIMULATION)
        v
F8 post-exam diagnosis / F9 readiness recompute react normally, invoked by the Student's own completion flow, never by F11-C4
```

## Data Model / Migration (additive only)

1. `teacher_interventions.target_type` CHECK widened to add `'EXAM'`.
2. Three new nullable columns: `exam_profile_id` (FK to `student_exam_profiles`), `simulation_type` (CHECK'd to F9's `SimulationType` enum), `academic_subject_id` (FK to `academic_subjects`, DOMAIN_EXAM only).
3. The existing target-consistency CHECK widened with an EXAM branch: none of the F4 target FKs populated; `exam_profile_id`/`simulation_type` always populated; `learning_objective_id` populated only for TOPIC_EXAM; `academic_subject_id` populated only for DOMAIN_EXAM; neither populated for MINI_MOCK/FULL_MOCK.
4. `teacher_intervention_executions.execution_type` CHECK widened to add `'EXAM_PRACTICE'`, whose `execution_reference` is a real `simulation_attempts.id`.

No new table. F11-B/C1/C2/C3 data and certifications are unaffected (all four re-run unchanged against the post-F11-C4 schema).

## Scope decision: all four simulation levels are structurally admissible, gated by real eligibility (not "enable all four" — verify each)

Rather than hand-building four separate Teacher-assignable "modes" with bespoke logic, `startExamReinforcementExecution` is written once, generically, and calls the SAME `getSimulationEligibility` for every `simulation_type`. Whether a given assignment can actually START depends entirely on F9's own real, already-certified eligibility computation — which for PAA Full Mock is honestly `NOT_READY` in this repository's current state, and for TOPIC_EXAM/DOMAIN_EXAM/MINI_MOCK against the fully-configured Mathematics domain is genuinely eligible. This satisfies the task's own instruction not to force all four to succeed uniformly, while avoiding a bespoke, harder-to-audit special case for each level.

## Explicit Exam Target (task §6/§40/§41)

The Teacher's own intervention row is the single source of truth for exam context — `exam_profile_id` (whose profile), `simulation_type` (which level), and `learning_objective_id`/`academic_subject_id` (scope, when the level requires one). Nothing is inferred from a shared Canonical Concept, a shared Skill, or any other cross-framework signal — PAA and Cambridge, which certifiably share one canonical concept (task §41, verified via `objective_concept_mappings`), never accidentally cross-start each other's simulations because the `exam_profile_id`/`examVersionId` chain is always resolved from the intervention's own explicit target, never from concept identity.

## Exam Profile / Version Validation (task §7/§8)

- Profile ownership (`profile.studentId === intervention.student_id`) is checked TWICE: once at Teacher assignment time (`assignTeacherIntervention`, F11-B, new `TeacherInterventionExamProfileMismatchError`), and again at Student start time (`startExamReinforcementExecution`), defense in depth, matching this codebase's convention of never trusting an earlier layer alone for a security-relevant check.
- Exam version is resolved from the profile (`profile.examVersionId`, falling back to the exam definition's currently PUBLISHED version) — never duplicated onto `teacher_interventions`. Only a `PUBLISHED` version may be started; DRAFT/SUPERSEDED/RETIRED is a controlled rejection.

## Full Mock Safety (task §10/§11) — see `F11_C4_FULL_MOCK_SAFETY.md`

## Student Execution / Lifecycle (task §14-18)

Reuses the exact same Student routes/dispatcher C1-C3 established (`GET /api/student/teacher-interventions`, `POST /api/student/teacher-interventions/[id]/start`). `startTeacherInterventionExecution` gains one new dispatch branch for `EXAM_PRACTICE`. Lifecycle is identical: `ASSIGNED -> IN_PROGRESS` on real execution creation; `IN_PROGRESS -> COMPLETED` observed lazily by `reconcileCompletionsForStudent`, which now branches by `execution_type` to read `simulation_attempts.status` (via `getSimulationAttempt`) instead of `quiz_sessions.status` for EXAM_PRACTICE rows — completion is derived from F9's own real, canonical status, never a second F11 "exam completed" truth.

## Concurrency Model — deliberately stronger than C1-C3 (task §31) — see `F11_C4_CONCURRENCY_REPORT.md`

## Authorization (task §26/§27/§28/§29)

Unchanged primitive (`isOwner`), unchanged Teacher-side primitives (F11-A/F11-B). No new authorization boundary introduced for Exam specifically — every adversarial case (cross-student, Parent, assigning/unrelated Teacher, multi-role) is denied by the exact same lock-and-check pattern shared by all four `start*ReinforcementExecution` functions.
