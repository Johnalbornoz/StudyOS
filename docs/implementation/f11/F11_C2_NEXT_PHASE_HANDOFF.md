# F11-C2 — Next Phase Handoff

## What F11-C2 delivered

- `startSkillReinforcementExecution` + `startTeacherInterventionExecution` (dispatcher) in the same orchestration file F11-C1 established, reusing the same Student routes, the same Practice engine, the same idempotency/lifecycle/reconciliation patterns.
- One additive, optional extension to `storeQuiz`/`getQuizSession`/the submit route's metadata construction — the pattern any future execution-type adapter needing to tag evidence should follow.
- Real, certified proof that F5's Skill Evidence/State pipeline is already fully automatic once `metadata.skillIds` is populated correctly — no F11-C2 code triggers aggregation directly.

## What F11-C3 (Competency) and F11-C4 (Exam) should know

1. **Follow the exact same dispatcher pattern.** Add `startCompetencyReinforcementExecution`/`startExamReinforcementExecution` to the same orchestration file; extend `startTeacherInterventionExecution`'s dispatch condition; do not create new routes, new registries, or new lifecycles.
2. **Competency's concept-resolution chain is one hop longer** than Skill's: `skill_competencies`/`canonical_concept_competencies` → `canonical_concepts` → `resolveStudentConceptForCanonicalConcept`. The same "exactly one candidate, else fail controlled" rule should apply — do not weaken it for Competency just because the chain is longer.
3. **Competency's metadata key is already `metadata.competencyIds`** (confirmed real, already wired into `updateMastery` via `projectCompetencyStateForNewEvidence`, exactly mirroring Skill's `skillIds`/`projectSkillStateForNewEvidence`). The same additive `storeQuiz`/submit-route extension pattern applies — likely reusable as a SECOND optional parameter on the same functions (`targetCompetencyIds`), or a generalized `targetTags: {skillIds?, competencyIds?}` shape if both need to coexist on one quiz eventually. Decide deliberately; do not default to whichever is fastest to type.
4. **Exam's execution mechanism is F9's `TOPIC_EXAM` simulation, not the Practice engine** — a materially different reuse target (`getSimulationEligibility`/simulation `plan.service.ts`, not `generatePracticeQuestions`/`storeQuiz`). Do not assume the same `quiz_sessions`-based execution registry entry shape applies; F11-C4 will need its own `execution_type` value (e.g. `'TOPIC_EXAM_SIMULATION'`) with a different `execution_reference` target table (an `exam_attempts`/simulation-attempt id, not a `quiz_sessions.id`), and must additionally handle the "student has no active Exam Profile" zero-state, which Skill/Concept never needed to.
5. **The `getActiveExamProfile`-equivalent duplication note** (carried forward since F10) becomes directly relevant for F11-C4 — a fourth call site would strongly justify finally promoting a shared canonical export.
6. **The optional F8 remediation adapter** (Teacher Intervention → F8 `intervention_session`) remains explicitly deferred — F11-C2 did not need it and did not build it. If a future phase decides it's needed, the `learner_gap_diagnoses` owner-only-creation gap (documented in F11-B's reconnaissance) must be resolved first.

## What F11-C3/C4 should NOT do

- Do not create a second Student pending-intervention list or a second start route.
- Do not create a second idempotency mechanism — reuse `UNIQUE(teacher_intervention_id, idempotency_key)`.
- Do not derive Competency/Exam-objective evidence from any graph traversal after the fact — the explicit-target-only discipline this phase established for Skill must hold for every future type.
