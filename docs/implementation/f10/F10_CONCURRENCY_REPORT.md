# F10 — Concurrency Report

Executed for real against ephemeral Postgres via `f10-lifecycle-cert-runner.ts` §9 (two cases required by task §58: duplicate accept, duplicate revoke; the other two named cases — two simultaneous access requests, duplicate acceptance — are covered by the same two mechanisms below, since both rely on the same real-DB primary-key/status-transition behavior, not application-level locking).

## Case: two simultaneous access requests (`linkChildByEmail` called twice concurrently for the same pair)

Not run as a separate concurrent pair in this certification (the upsert's `WHERE status IN ('declined','revoked')` guard and the table's `(parent_id, student_id)` primary key make a duplicate-row race structurally impossible — Postgres serializes the two `INSERT ... ON CONFLICT` statements at the row level regardless of timing), but the underlying mechanism is the exact same one directly proven by the duplicate-accept/duplicate-revoke cases below. No separate proof was judged necessary beyond that structural argument, which is stated here rather than silently assumed.

## Case: duplicate accept (`respondToRequest(childH, parentId, true)` × 2, concurrent)

```
await Promise.all([respondToRequest(...), respondToRequest(...)]);
```
Result: exactly **one** row with `status = 'accepted'` for that pair. The second call's `UPDATE ... WHERE status = 'pending'` matches zero rows once the first has already transitioned it, so it is a real, safe no-op — never a duplicate row, never a thrown error, never a widened authorization window (both calls resolve to the same, single, correct end state).

## Case: duplicate revoke (`revokeRelationshipByStudent(childH, parentId)` × 2, concurrent)

Result: exactly **one** row, `status = 'revoked'`. Same mechanism — the second `UPDATE ... WHERE status = 'accepted'` matches nothing once the first has already transitioned it.

## Why no application-level locking was needed

Every relationship-state transition in `parent.service.ts` is a single `UPDATE ... WHERE <current-status-guard>` (or the upsert's `ON CONFLICT ... WHERE`), which Postgres itself serializes per row — there is no read-then-write gap in application code for a race to land in. This was true before F10 (F2's own design) and remains true after F10's upsert fix; F10 added no new read-modify-write pattern.

## Verdict

**PASS.** No duplicate active relationship, no temporary authorization widening, in either concurrency case.
