# F11-C4 — Full Mock Safety

## The guard, and why it cannot be bypassed by Teacher assignment

`getSimulationEligibility` is called unconditionally by `startExamReinforcementExecution` for EVERY `simulation_type`, including `FULL_MOCK` — there is no `if (simulationType !== 'FULL_MOCK')` branch anywhere in the orchestration file (source-guard proven). For `FULL_MOCK`, `getSimulationEligibility` delegates to F9's real `getFullMockEligibility`, which itself wraps F7's real `canFullMockBeOffered` (the Full Mock Guard) plus F9's own domain-coverage check. A Teacher's intent to assign a Full Mock is recorded (the assignment itself succeeds — product semantics: intent is not capability), but STARTING it runs through the identical, unmodified guard a Student-initiated Full Mock would.

## PAA truth preservation (task §11)

The real-Postgres certification uses F9's own actual fixture (`f9-seed-pilot-dataset.ts`) — the SAME data F9's own certification depends on. In that fixture, PAA's Reading component is genuinely `support_status = 'UNSUPPORTED'`, has no timing/tool-rule configuration, and its objective carries no F6 mapping. This is honest, current platform state, not something F11-C4 seeds differently to make a point. `getFullMockEligibility(PAA_EXAM_VERSION_ID).eligible` is `false` for this real reason before F11-C4 ever runs, and remains `false` after.

## Mandatory negative proof (task §42, Case E)

1. A Teacher assigns a `FULL_MOCK` Exam Reinforcement intervention targeting the PAA exam profile — the assignment succeeds (F11-B's own target-consistency CHECK admits it; assigning intent is not the same as platform readiness).
2. The Student attempts to START it. `startExamReinforcementExecution` calls `getSimulationEligibility`, which returns `eligible: false` with reasons `UNSUPPORTED_COMPONENT: Reading Section`, `TIMING_NOT_CONFIGURED: Reading Section`, `TOOL_RULES_NOT_CONFIGURED: Reading Section`, `OBJECTIVE_NOT_MAPPED: ...` (x2), `MANDATORY_DOMAIN_INCOMPLETE: ...`, `COMPONENT_UNSUPPORTED: Reading Section`.
3. `StudentInterventionNotStartableError` is thrown. Verified in the real-Postgres run: **zero** `teacher_intervention_executions` rows and **zero** `simulation_attempts` rows of type `FULL_MOCK` exist anywhere for this student afterward.

No fake readiness update, no fabricated official timing/scoring, no seeded missing-domain workaround — the Student never receives a runnable Full Mock while PAA is genuinely NOT_READY.

## Positive contrast, not conflated with the PAA result

The same fixture's Cambridge exam version is separately, fully configured and structurally Full-Mock-eligible (proven by F9's own certification, `F9_lifecycle-cert-runner.ts` case L). F11-C4 does not need to re-certify that positive path itself (F9 already owns and certifies it) — this document exists to prove F11-C4's own orchestration never weakens or bypasses the guard, not to re-derive F9's own eligibility logic.
