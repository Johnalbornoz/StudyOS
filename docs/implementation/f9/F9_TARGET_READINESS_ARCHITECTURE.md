# F9 — Target Readiness & Simulation Architecture

## Data flow (task §2, restated as implemented)

```
student_exam_profiles (F7) → exam_versions/assessment_blueprints (F7)
        |
        v
blueprint-coverage.service.ts  -- classifies every objective target
        |
        v
student-concept-resolution.service.ts -- canonical concept -> student's own concept
        |
        v
F8's real runDiagnosis() per evidenced target  -- NEVER re-derived, always invoked
        |
        v
dimension-classification.algorithms.ts (pure) -- aggregates diagnoses into 7 dimensions
        |
        v
readiness_snapshots row (append-only, versioned)
        |
        v
simulation/eligibility.service.ts -- combines readiness + F7's canFullMockBeOffered
        |
        v
simulation/plan.service.ts -- deterministic, frozen Simulation Plan
        |
        v
simulation/attempt.service.ts -- wraps F7's startExamAttempt, adds pause/resume/navigation
        |
        v
simulation/scoring.service.ts -- existing graders + F7's recordExamAttemptItemResponse
        |
        v
new learning_evidence (via the SAME writers F7/F8 already use)
        |
        v
simulation/post-exam-diagnosis.service.ts -- F8's real runDiagnosis again, post-exam scope
        |
        v
simulation/next-action.service.ts -- F9's own "what activity next" contract
        |
        v
Canonical V2 (unchanged, reads learning_evidence under its own existing rules)
```

F9 owns everything above the Canonical V2 line except the boxes explicitly marked "F7"/"F8" (called, never reimplemented).

## New modules

| Module | Responsibility |
|---|---|
| `src/lib/readiness/types.ts` | Dimension/status vocabulary, snapshot shape, policy rule shape |
| `src/lib/readiness/policy.service.ts` | Versioned readiness policy CRUD (F5/F8 idiom) |
| `src/lib/readiness/student-concept-resolution.service.ts` | Canonical concept → the student's own matched concept |
| `src/lib/readiness/blueprint-coverage.service.ts` | Classifies every blueprint objective target (task §10) |
| `src/lib/readiness/dimension-classification.algorithms.ts` | Pure aggregation of F8 diagnoses + coverage + simulation history into 7 dimensions + overall status |
| `src/lib/readiness/readiness.service.ts` | Orchestrates fetch → (re-)diagnose via F8 → classify → persist |
| `src/lib/readiness/score-projection.service.ts` | `CAN_PROJECT_OFFICIAL_SCORE` gate + `score_conversion_models` CRUD |
| `src/lib/readiness/institution-policy-comparison.service.ts` | Factual threshold comparison, never a probability (task §38) |
| `src/lib/simulation/types.ts` | Simulation level/type vocabulary, plan/attempt shapes |
| `src/lib/simulation/eligibility.service.ts` | Per-level eligibility, composing F7's `canFullMockBeOffered` for FULL_MOCK |
| `src/lib/simulation/plan.service.ts` | Deterministic, frozen Simulation Plan builder |
| `src/lib/simulation/attempt.service.ts` | Wraps F7's `startExamAttempt`; adds pause/resume/navigation (genuine new schema) |
| `src/lib/simulation/scoring.service.ts` | Grades via the four existing graders, persists via F7's `recordExamAttemptItemResponse` |
| `src/lib/simulation/post-exam-diagnosis.service.ts` | Invokes F8's real `runDiagnosis` post-simulation, never a new classifier |
| `src/lib/simulation/next-action.service.ts` | F9's own "what activity next" contract (task §32) — distinctly named from F8's `InterventionType` and from the legacy Phase-2 `remediation.service.ts`/`RemediationPattern`, which answer different questions at different scopes |

## Non-negotiable boundaries restated as implementation rules

1. No F9 file writes to any Canonical-V2-owned table or calls a Canonical V2 progression function.
2. No F9 file writes to `learning_evidence` directly — only via the existing writers (`updateMastery()`, called through F7's evidence-bridge pattern / F8's `writeInterventionEvidence` pattern, reused as-is for simulation responses — see `F9_POST_EXAM_DIAGNOSIS.md`).
3. No F9 file re-implements `canFullMockBeOffered`, F6's coverage service, F8's gap classifiers, or any of the four existing graders.
4. No F9 file writes to `exam-readiness.service.ts` or its route — that legacy system is left untouched (see current-state assessment §2).
5. Every readiness snapshot and simulation plan is append-only/frozen; historical rows are never rewritten (INV-F9-14/15).
6. No score is ever presented as an official scaled score without a real, versioned `score_conversion_models` row backing it (INV-F9-16/17).

## One small additive change to an F7 file

`src/lib/assessment/blueprint.service.ts` gains one new exported function, `listComponentAllocations(blueprintId)` — a read-only getter for `blueprint_component_allocations`, which today is write-only (`addComponentAllocation` upserts but nothing reads it back). This is additive only; no existing export's behavior changes. F9's Simulation Plan builder needs to read allocations to know each component's item-count/weight target.
