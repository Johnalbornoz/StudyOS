# F11 — Integrated Architecture

Certifies F11 as ONE integrated Teacher Workspace system — not four individually-passing adapters glued together by coincidence, but one dispatcher, one Student read model, one authorization discipline, and one set of underlying engines shared across all four intervention types.

## One system, four adapters

```
teacher_interventions (F11-B)             = pedagogical intent / assignment for ALL FOUR types
teacher_intervention_executions (F11-C1+) = ONE execution registry, ONE UNIQUE(intervention, idempotency_key) guard, widened vocabulary only
startTeacherInterventionExecution          = ONE dispatcher, branches on intervention_type:
  CONCEPT_REINFORCEMENT   -> startConceptReinforcementExecution      -> Practice engine  -> F5
  SKILL_PRACTICE          -> startSkillReinforcementExecution        -> Practice engine  -> F5
  COMPETENCY_PRACTICE     -> startCompetencyReinforcementExecution   -> Practice engine  -> F5
  EXAM_PRACTICE           -> startExamReinforcementExecution         -> F9 simulation    -> F7/F9/F8
getStudentPendingTeacherInterventions       = ONE Student read model for ALL FOUR types
reconcileCompletionsForStudent              = ONE reconciliation loop, branching only on HOW to observe completion (quiz_sessions vs simulation_attempts), never a second lifecycle
listTeacherInterventionsForStudent          = ONE Teacher read model for ALL FOUR types (F11-B, unmodified since F11-B)
isOwner                                     = the ONE authorization primitive every start function gates on, identically
```

No intervention type has its own route, its own pending-list query, its own idempotency mechanism, or its own authorization primitive. The four `start*ReinforcementExecution` functions are structurally parallel (verified by direct comparison across all four in this gate's certification run) — they differ only in which underlying engine they hand off to and what target-specific validation that engine requires.

## F9 self-service is untouched and independent (task §1/§9)

`POST /api/simulation/attempts` and its underlying service chain (`getSimulationEligibility` → `startSimulationAttempt`) have zero awareness of `teacher_interventions`/`teacher_intervention_executions` — confirmed by source guard (the route file contains no reference to `teacher_intervention`) and by real-Postgres proof: a Student's own self-service TOPIC_EXAM/DOMAIN_EXAM/MINI_MOCK attempts succeed with zero `teacher_intervention_executions` rows referencing them, and PAA FULL_MOCK is NOT_READY through the identical `getSimulationEligibility` authority a Teacher-assigned attempt would hit. F11 is an ADDITIONAL orchestration origin, never a required gateway.

## Two coexisting entry points, one assessment authority

```
ENTRY A: Student -> POST /api/simulation/attempts -> getSimulationEligibility -> startSimulationAttempt -> F7/F9
ENTRY B: Teacher -> assignTeacherIntervention -> Student -> startTeacherInterventionExecution -> startExamReinforcementExecution -> getSimulationEligibility -> startSimulationAttempt -> F7/F9
```

Both entry points terminate in the exact same F7/F9 functions, verified in this gate by directly comparing two real attempts (one from each entry point) for the SAME student against the SAME exam version — same authority, same eligibility guard, same Evidence pathway, genuinely independent orchestration origins.

## Underlying engine authority preserved (task §6)

- Concept/Skill/Competency Reinforcement: the existing Practice engine (`generatePracticeQuestions`/`storeQuiz`/`getQuizSession`) and F5's real `updateMastery`/projectors — unchanged since F11-C1.
- Exam Reinforcement: F7/F9's real assessment/simulation machinery (`getSimulationEligibility`/`startSimulationAttempt`/`recordSimulationItemResponse`/`completeSimulationAttempt`/`runPostExamDiagnosis`/`computeReadinessSnapshot`) — unchanged since F11-C4.
- F11 itself performs zero direct writes to `learning_evidence`, `learner_skill_state`, `learner_competency_state`, `readiness_snapshots`, diagnostic state, or any Canonical V2 stage table — verified by source guard across both orchestration files (`teacher-intervention-execution.service.ts`, `intervention.service.ts`) in this gate's own certification run, in addition to each sub-phase's own prior source guards.

## Canonical V2 boundary (task §10)

Assigning ANY of the four intervention types performs zero Canonical stage writes (no Canonical table is referenced anywhere in the assignment path). Starting ANY of the four performs zero direct F11 Canonical writes. Completing any of them only ever lets legitimate Evidence flow into the existing, certified Canonical machinery through the exact same paths F5/F7/F8/F9 already own — F11 never becomes a second Canonical authority. The full named Canonical V2 regression suite (all `canon-*.test.ts` files, part of the 347-file/5589-test full suite) passes unchanged.
