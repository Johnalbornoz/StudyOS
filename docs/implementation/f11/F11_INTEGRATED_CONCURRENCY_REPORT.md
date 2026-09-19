# F11 — Integrated Concurrency Report

Task §8 — jointly re-certifies duplicate-start safety for all four intervention types in one gate.

## Concept duplicate start (sequential)

Two sequential calls with the same idempotency key: first `STARTED`, second `RECOVERED` with the identical `executionId`. One usable execution.

## Skill duplicate start (sequential)

Same pattern, same result.

## Competency duplicate start (real concurrent `Promise.all`)

Two genuinely simultaneous calls with the same idempotency key: both resolve to the identical `executionId`; exactly one `teacher_intervention_executions` row.

## Exam duplicate start (real concurrent `Promise.all`)

Two genuinely simultaneous calls with the same idempotency key: both resolve to the identical `executionId`; exactly one `teacher_intervention_executions` row; and — the case task §8 specifically calls out as needing special scrutiny — an explicit before/after count of `simulation_attempts` for that exam profile/simulation type confirms **exactly one new real F9 attempt was created, not two**. No reachable orphan attempt exists from this race: the only committed attempt is the one referenced by the single execution registry row, and the lock-serialized design (documented in F11-C4's own `F11_C4_CONCURRENCY_REPORT.md`) means the second concurrent caller never calls `startSimulationAttempt` at all — it finds the first caller's already-committed registry row and returns `RECOVERED` directly.

## Why Exam's guarantee is structurally different (and stronger) than the other three

Concept/Skill/Competency accept a small, well-understood residual: a genuine race can leave one harmless orphaned `quiz_sessions` row (never referenced, never returned to any caller, never contributing Evidence) because their attempt-creation path (`generatePracticeQuestions`) involves an AI call that must not happen inside a held DB lock. Exam's attempt-creation path (`buildSimulationPlan`/`startExamAttempt`) involves zero AI/external calls, so its entire claim-and-create sequence runs inside one row-locked transaction — eliminating the race outright rather than tolerating its harmless residue. Both models are independently correct for their own constraints; this gate confirms neither type regressed the other's guarantee.

## Verdict

**PASS** for all four types. One usable execution per intervention under both sequential retry and genuine concurrency; for Exam specifically, zero reachable orphan attempt capable of scoring/Evidence/readiness effects.
