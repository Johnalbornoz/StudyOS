# F11-C2 — Skill Execution Architecture

## Canonical separation preserved

```
teacher_interventions (F11-B)          = pedagogical intent / assignment, unchanged
teacher_intervention_executions (C1)   = references to real executions, widened vocabulary only
quiz/Practice engine (frozen)          = the sole question-generation/grading/evidence-trigger engine
learning_evidence / learner_skill_state = canonical academic truth, written ONLY by F5's own updateMastery
```

F11-C2 adds no new table type, no new lifecycle, no new Student API, no new Evidence writer, no new Skill State engine — it extends three existing surfaces additively (§ Data Model below) and adds one new orchestration function (`startSkillReinforcementExecution`) plus a thin dispatcher (`startTeacherInterventionExecution`) that the existing Student route now calls instead of the Concept-only function directly.

## The critical invariant, verified structurally and behaviorally

**Concept→Skill graph traversal never creates Skill Evidence.** `startConceptReinforcementExecution` (F11-C1, byte-for-byte unchanged) never reads `canonical_concept_skills` and never passes `skillIds` to `storeQuiz` — proven by a source-guard test extracting its exact function body and asserting no `skillId` substring appears in its `storeQuiz(...)` call. `startSkillReinforcementExecution` is the *only* function in the entire codebase that ever populates `quiz_sessions.target_skill_ids`, and it only does so from the intervention's own explicit `skill_id` target column — never derived after the fact from a graph edge.

## Data Model / Migration (additive only, two changes)

1. `teacher_intervention_executions.execution_type` CHECK widened from `('TOPIC_PRACTICE')` to `('TOPIC_PRACTICE', 'SKILL_PRACTICE')` — via `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT` (idempotent, same constraint name, safe to re-run).
2. `quiz_sessions` gains one nullable column, `target_skill_ids uuid[]` — `NULL` for every pre-existing row and every ordinary or Concept-reinforcement quiz going forward.

No new table. No destructive change. No F11-B/F11-C1 data invalidated (confirmed: re-running both certifications produces byte-identical results).

## Explicit Skill Target

`teacher_interventions.skill_id` (F11-B, already existed) is F4's own canonical `skills.id` — no teacher-local Skill table. Validity is checked twice, at two different times, for two different reasons: F11-B's assign-time FK (existence only) and F11-C2's new start-time status check (`skills.status = 'ACTIVE'`, added because F11-B never checked it and F11-B is frozen).

## Concept Context Validation

Since F11-B's own CHECK constraint makes `concept_id` structurally `NULL` for a `target_type='SKILL'` row, F11-C2 never reads a stored concept context — it always resolves one deterministically at execution-start time via `resolveDeterministicConceptForSkill`: walk `canonical_concept_skills` (skill → canonical concepts, F4), resolve each to *this specific student's own* `concepts.id` via F9's existing `resolveStudentConceptForCanonicalConcept` (never fabricates a match), and require **exactly one** surviving candidate. Zero or more than one → fail controlled (`StudentInterventionNotStartableError`), never an arbitrary/AI pick.

## Practice Engine Integration

`generatePracticeQuestions`/`storeQuiz`/`getQuizSession`/`completeQuiz` — the exact same functions F11-C1 already reuses, called with the deterministically-resolved concept and the explicit skill. See `F11_C2_SKILL_EVIDENCE_CONTRACT.md` for the one additive extension required to propagate the Skill tag into evidence metadata.

## Lifecycle

Identical to F11-C1: `ASSIGNED → IN_PROGRESS` on a real execution being created; `IN_PROGRESS → COMPLETED` on the linked `quiz_sessions` reaching `'completed'` via the real, unmodified submit route — reconciliation loop widened (one filter clause) to cover both execution types, not duplicated.

## Authorization

Unchanged primitive (`isOwner`), unchanged Teacher-side primitives (`canAccessClass`/`canTeacherManageIntervention`, F11-A/F11-B). No new authorization boundary was introduced for Skill specifically — every adversarial case (cross-student, Parent, assigning/unrelated Teacher, multi-role) is denied by the exact same lock-and-check pattern F11-C1 established, now shared by both `start*ReinforcementExecution` functions.
