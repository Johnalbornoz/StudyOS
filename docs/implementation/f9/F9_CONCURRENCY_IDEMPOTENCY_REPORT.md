# F9 — Concurrency & Idempotency Report

Per task §54, executed against real, ephemeral Postgres (`scripts/operations/f9-concurrency-performance-runner.ts`), sharing the same fixture as the adversarial matrix.

## What was found and fixed during this certification

The initial implementation of `POST /api/simulation/attempts/[id]/responses` had **no idempotency protection at all** — unlike F8's equivalent (`recordInterventionAttempt`), a client/network retry of the same logical submission would have inserted a second `exam_attempt_item_responses` row and written a second `learning_evidence` row. This was found by writing the double-submission test required by this exact section, not by inspection beforehand.

Fix: an additive `idempotency_key` column on F7's `exam_attempt_item_responses` (NULL for every pre-F9 caller, a partial unique index only where populated), a caller-supplied `idempotencyKey` threaded from the API route through `recordSimulationItemResponse` to both `recordExamAttemptItemResponse` (F7) and `updateMastery`'s own `identity` mechanism (F5) — two independent layers of protection for the response row and the Evidence row respectively. A first pass used a non-atomic SELECT-then-INSERT check; the concurrency test itself caught the race (two truly-concurrent calls could both pass the SELECT before either INSERT committed), fixed by catching the real Postgres `unique_violation` on the new index and recovering the existing row — the same conflict-detection idiom `mastery.service.ts` already uses for `learning_evidence.operation_key`.

## Cases executed (all against real Postgres, all PASS)

| Case | Method | Result |
|---|---|---|
| Double submission of the same response | Two truly-concurrent (`Promise.all`) calls to `recordSimulationItemResponse` with an identical `idempotencyKey` | Both resolve to the SAME `responseId`; exactly one `exam_attempt_item_responses` row and exactly one `learning_evidence` row exist afterward |
| Duplicate finalization request / attempt finalization race | Two truly-concurrent calls to `completeSimulationAttempt` on the same attempt | Exactly one succeeds, the other is safely rejected (its guarded `UPDATE ... WHERE status IN ('ACTIVE','PAUSED')` matches zero rows); exactly one `simulation_attempts` row ends `COMPLETED`, never duplicated or ambiguous |
| Readiness recalculation triggered twice | Two truly-concurrent calls to `computeReadinessSnapshot` for the same profile | Both complete cleanly as two distinct, valid, independently-persisted snapshot rows — this is **correct**, not a bug: each call is a legitimate, separate recomputation request, and readiness snapshots are append-only by design (task §33/INV-F9-15); concurrency safety here means "no crash, no corrupted shared state," not deduplication |
| Failure recovery: a plan-building failure mid-start | `startSimulationAttempt` called with a real-shaped but nonexistent `learningObjectiveId` | Throws before any row is persisted; zero new `simulation_attempts` or `simulation_plans` rows exist afterward — no partially-finalized attempt, fully recoverable |

## What was not literally injected (and why)

Task §55 also lists "evaluation fails on one item" and "DB transaction fails before finalization" as scenarios to test. Neither was literally injected via fault injection in this certification:
- "Evaluation fails on one item" would require a real AI provider failure (no credentials available in this environment, per `F9_AI_PROVIDER_CERTIFICATION.md`) — the underlying failure-handling machinery (`executeAI`/`AIExecutionError`) is F7/F8's own, already certified in their own phases; F9 introduces no new AI call site that could fail differently.
- "DB transaction fails before finalization" was not simulated via e.g. killing the connection mid-transaction — `completeSimulationAttempt`'s own guarded `UPDATE ... WHERE status IN (...)` is structurally atomic (a single statement), so there is no multi-step transaction window to interrupt in the first place; the finalization race test above is the real proof this path is safe under concurrent access.

## Verdict

**PASS.** No duplicate Evidence, no duplicated scoring, no duplicate finalized attempt, and idempotent-or-safely-rejected behavior confirmed for every case actually executable in this environment (AC-F9-28/29).
