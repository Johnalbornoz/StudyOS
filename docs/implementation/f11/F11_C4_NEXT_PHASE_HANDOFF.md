# F11-C4 — Next Phase Handoff

## What F11-C4 delivered

- `startExamReinforcementExecution` + one new dispatcher branch, in the same orchestration file F11-C1/C2/C3 established, reusing the same Student routes, the same lifecycle/adversarial patterns.
- Generic support for all four F9 simulation levels (TOPIC_EXAM/DOMAIN_EXAM/MINI_MOCK/FULL_MOCK), gated entirely by F9's own real, unconditional `getSimulationEligibility` — never a bespoke per-level special case, never a bypassable Full Mock Guard.
- A materially STRONGER concurrency model than C1-C3's own (the entire claim-and-create sequence runs inside one row-locked transaction, structurally eliminating the attempt-creation race rather than tolerating a harmless orphan) — justified by, and only possible because of, the verified fact that F9's attempt-creation path involves zero AI/external calls.
- Real, certified proof of framework/version isolation and shared canonical knowledge (PAA vs Cambridge) through the SAME orchestrator, and the mandatory PAA Full Mock NOT_READY negative proof using F9's own real, honest fixture.

## What F11 execution-layer integration (or any future exam-adjacent phase) should know

1. **The eligibility-gate pattern generalizes cleanly.** If a future phase needs another F9-adjacent activity type, prefer calling the real, unconditional eligibility/capability check exactly once, rather than hand-coding per-variant admission logic.
2. **Re-evaluate the "entire sequence under one lock" pattern before reusing it elsewhere.** It was safe here specifically because `buildSimulationPlan`/`startExamAttempt` are pure DB work; if a future activity type's creation path involves any AI/external call, the C1-C3 "claim under lock, create after release, UNIQUE-constraint recovery" pattern is the correct one instead — never hold a DB lock across external I/O.
3. **`academic_subject_id` and `simulation_type` on `teacher_interventions` are now real, general-purpose columns** — any future phase adding a fifth intervention type should check whether these are reusable before adding new, narrower columns of its own.
4. **Simulation responses currently never tag Competency evidence** (only Skill) — if a future phase needs Exam-derived Competency Evidence, that is an F9 (`scoring.service.ts`) change, not an F11 orchestration change; F11-C4 deliberately made no attempt to work around this from the orchestration layer.
5. **No generic "list my simulation attempts" endpoint exists in F9** — if one is added later, re-examine the mid-flight-failure orphan residual (`F11_C4_RESIDUAL_RISK_REGISTER.md` item 1) to confirm it remains non-discoverable/non-actionable by the Student.

## What a future phase should NOT do

- Do not create a second Student pending-intervention list or a second start route.
- Do not create a second idempotency mechanism — reuse `UNIQUE(teacher_intervention_id, idempotency_key)`.
- Do not derive Exam-Evidence dimensions (Skill/Competency) from any graph traversal after the fact — the explicit-target-only discipline this phase established for Exam context (and every prior phase established for Concept/Skill/Competency) must hold.
- Do not special-case any `simulation_type` at the orchestration layer, including FULL_MOCK — the unconditional `getSimulationEligibility` call is what keeps the Full Mock Guard unbypassable; adding an `if (simulationType === 'FULL_MOCK')` branch anywhere in `startExamReinforcementExecution` would be a regression even if well-intentioned.
- Do not build final Teacher/Student UI, class-batch assignment, or automatic intervention generation from this phase — all explicitly out of scope, per task §65 and the STOP condition.
