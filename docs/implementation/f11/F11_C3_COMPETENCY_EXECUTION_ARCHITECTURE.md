# F11-C3 — Competency Execution Architecture

## Canonical separation preserved

```
teacher_interventions (F11-B)          = pedagogical intent / assignment, unchanged
teacher_intervention_executions (C1)   = references to real executions, widened vocabulary only
quiz/Practice engine (frozen)          = the sole question-generation/grading/evidence-trigger engine
learning_evidence / learner_competency_state = canonical academic truth, written ONLY by F5's own updateMastery
```

F11-C3 adds no new table type, no new lifecycle, no new Student API, no new Evidence writer, no new Competency State engine — it extends the same three surfaces F11-C2 extended (additively, § Data Model) and adds one new orchestration function (`startCompetencyReinforcementExecution`) plus one new `if` branch in the existing `startTeacherInterventionExecution` dispatcher.

## Practice is sufficient — verified, not assumed (task §4)

Before choosing an execution adapter, F5's real Competency State contract was read directly (`src/lib/learner-state/competency-state.service.ts`, `algorithms/state-classification.ts`). It is structurally identical to Skill's: `computeDimensionState` classifies purely on evidence count + independence + correctness within a policy-defined `minimumEvidenceCount` window. Grepping the entire `learner-state` module and `mastery.service.ts` for `context_id`/`contexts\b` returns zero matches — no context-diversity, multi-concept, or transfer-context dimension exists in the current, real implementation. Practice therefore legitimately produces qualifying Competency Evidence today; no F7/F8/F9 adapter was needed. This finding is documented (not assumed either way) in `F11_C3_CURRENT_COMPETENCY_EXECUTION_ASSESSMENT.md`, and if F5's policy is ever extended with a context-diversity dimension, this phase's Practice-only adapter would need re-evaluation — flagged in the Residual Risk Register.

## The critical invariant, verified structurally and behaviorally, in BOTH directions

**Neither Concept→Competency nor Skill→Competency graph traversal ever creates Competency Evidence.**

- `startConceptReinforcementExecution` (F11-C1) and `startSkillReinforcementExecution` (F11-C2), both byte-for-byte unchanged, never read `canonical_concept_competencies`/`skill_competencies` and never pass `competencyIds` to `storeQuiz` — proven by source guard and by real-Postgres negative proofs (Cases D and E).
- `startCompetencyReinforcementExecution` is the *only* function in the codebase that ever populates `quiz_sessions.target_competency_ids`, and it only does so from the intervention's own explicit `competency_id` target column — never derived from a graph edge after generation.

## Data Model / Migration (additive only, two changes)

1. `teacher_intervention_executions.execution_type` CHECK widened again, from `('TOPIC_PRACTICE', 'SKILL_PRACTICE')` to `('TOPIC_PRACTICE', 'SKILL_PRACTICE', 'COMPETENCY_PRACTICE')` — `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT`, same name, idempotent.
2. `quiz_sessions` gains one nullable column, `target_competency_ids uuid[]` — deliberately **separate** from F11-C2's `target_skill_ids` (never conflated), `NULL` for every pre-existing row and every non-Competency quiz.

No new table. F11-B/F11-C1/F11-C2 data and certifications are unaffected (re-running all four regression scripts against the post-F11-C3 schema produces the same passing results).

## Explicit Competency Target

`teacher_interventions.competency_id` (F11-B) is F4's own canonical `competencies.id` — no Teacher-local Competency table. Checked twice: F11-B's assign-time FK (existence only) and F11-C3's new start-time status check (`competencies.status = 'ACTIVE'`), mirroring F11-C2's Skill status check.

## Concept Context Resolution — the DIRECT edge, not routed through Skill

`resolveDeterministicConceptForCompetency` walks `canonical_concept_competencies` (F4's own direct Competency↔canonical-concept edge — the migration comment for that table explicitly states it "does NOT require routing through a skill"), resolves each candidate to *this specific student's own* `concepts.id` via F9's existing `resolveStudentConceptForCanonicalConcept`, and requires **exactly one** surviving candidate. Zero or more than one → fail controlled (`StudentInterventionNotStartableError`). `skill_competencies` is never read by this function — confirmed by source guard.

## Practice Engine Integration

Same reused functions as F11-C1/C2: `generatePracticeQuestions`/`storeQuiz`/`getQuizSession`/`completeQuiz`, called with the deterministically-resolved concept and the explicit competency. See `F11_C3_COMPETENCY_EVIDENCE_CONTRACT.md` for the additive metadata-propagation extension.

## Lifecycle

Identical to F11-C1/C2: `ASSIGNED → IN_PROGRESS` on a real execution being created; `IN_PROGRESS → COMPLETED` when the linked `quiz_sessions` row completes via the real, unmodified submit route. `reconcileCompletionsForStudent`'s filter widened by one more value (`'COMPETENCY_PRACTICE'`), not duplicated.

## Authorization

Unchanged primitives (`isOwner`, F11-A/F11-B Teacher-side checks). No new authorization boundary was introduced for Competency — every adversarial case (cross-student, Parent, assigning/unrelated Teacher, multi-role) is denied by the same lock-and-check pattern shared by all three `start*ReinforcementExecution` functions.
