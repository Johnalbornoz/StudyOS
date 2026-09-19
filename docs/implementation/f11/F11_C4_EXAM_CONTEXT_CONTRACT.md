# F11-C4 — Exam Context Contract

## What "exam context" means for an Exam Reinforcement execution

| Field | Source | Required when |
|---|---|---|
| `exam_profile_id` | Teacher's explicit intervention target | Always (target_type=EXAM) |
| `simulation_type` | Teacher's explicit intervention target | Always (target_type=EXAM) |
| `learning_objective_id` | Teacher's explicit intervention target (reuses F11-B's pre-existing column) | `simulation_type = 'TOPIC_EXAM'` only |
| `academic_subject_id` | Teacher's explicit intervention target (new, F11-C4) | `simulation_type = 'DOMAIN_EXAM'` only |
| `exam_definition_id` | Derived from the profile, never duplicated | n/a |
| `exam_version_id` | Derived from the profile (pinned) or the definition's PUBLISHED version (fallback), never duplicated, never client-resupplied at start time | n/a |

Enforced structurally by the widened `teacher_interventions_target_consistency_check`: an EXAM-targeted row can never have both `learning_objective_id` and `academic_subject_id` populated, and MINI_MOCK/FULL_MOCK rows can never have either.

## Resolution order at start time (`startExamReinforcementExecution`)

1. Read `exam_profile_id`/`simulation_type`/`learning_objective_id`/`academic_subject_id` directly off the locked `teacher_interventions` row — never from a caller-supplied parameter (the function's own signature takes only `actorUserId`/`interventionId`/`idempotencyKey`, verified by source guard).
2. Load the profile (`getStudentExamProfile`); verify `profile.studentId === intervention.student_id`.
3. Resolve `examVersionId = profile.examVersionId ?? getPublishedExamVersion(profile.examDefinitionId)?.id`; verify the resolved version exists and is `PUBLISHED`.
4. Call `getSimulationEligibility({studentId, examVersionId, simulationType, learningObjectiveId, academicSubjectId})` — the ONLY gate.
5. Call `startSimulationAttempt` with the exact same resolved values.

## Explicit exam context test (task §40) — proven

A Teacher assigning a PAA TOPIC_EXAM intervention creates a `simulation_attempts` row whose `exam_version_id` is the PAA version; a Cambridge TOPIC_EXAM intervention for the same student creates one whose `exam_version_id` is the Cambridge version — verified as genuinely different ids in the real-Postgres certification, despite both objectives resolving to the identical canonical concept.

## Shared knowledge test (task §41) — proven

`objective_concept_mappings` confirms PAA's `PAA-M-F9-1` and Cambridge's `C-ALG-F9-1` map to the SAME canonical concept id (one row, `distinctConcepts.size === 1`). The two Exam Reinforcement executions built from these two objectives remain structurally separate contexts (different exam version, different simulation attempt, different frozen configuration) — one shared knowledge identity, two genuinely separate assessment contexts, never conflated.
