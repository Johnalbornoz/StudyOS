# F11-C2 — Concurrency Report

Reuses F11-C1's exact idempotency mechanism (row-lock claim + `UNIQUE(teacher_intervention_id, idempotency_key)` as the final concurrency guard) — no new concurrency primitive was introduced for Skill execution.

## Sequential duplicate start (Case N)

Two sequential calls with the same `idempotencyKey` against the same Skill intervention: first `STARTED`, second `RECOVERED` with the **identical** `executionId`. Exactly one `teacher_intervention_executions` row.

## Real concurrent duplicate start (Case O)

Two genuinely simultaneous (`Promise.all`) calls with the same `idempotencyKey`: both resolve to the **identical** `executionId`; exactly one `teacher_intervention_executions` row exists afterward. This is a real database-level race resolved by the `UNIQUE` constraint's `23505` conflict-recovery path (the loser re-reads and returns the winner's row) — not a design assumption, confirmed by an actual orphaned `quiz_sessions` row appearing in this exact run (see `F11_C2_EVIDENCE_RECONCILIATION.md`'s residual section).

## No duplicated legitimate Skill Evidence

Because only the ONE canonical execution reference is ever submitted (in this certification, and in real use — a client only ever sees the reference the server returned), only one evidence-writing event occurs per real student action, regardless of how many `teacher_intervention_executions` rows a race could theoretically produce (it never produces more than one, per above).

## Verdict

**PASS.** Identical guarantee to F11-C1: one deterministic execution reference, one registry row, under both sequential retry and genuine concurrency.
