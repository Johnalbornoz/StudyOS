# F11-C4 — Failure Recovery Report

## Mid-chain failure (Case T)

An exam profile with no resolvable exam version (no pinned `exam_version_id`, and its exam definition has no `PUBLISHED` version) is assigned as an Exam Reinforcement intervention. Starting it:

1. Passes the row lock, ownership check, effective-status check, type/target check, and idempotency-key check (no existing row).
2. Fails at exam-version resolution: `examVersionId` resolves to `null` → `StudentInterventionNotStartableError` is thrown, and the enclosing transaction is `ROLLBACK`ed.

Verified in the real-Postgres run:
- The intervention remains `ASSIGNED` (never falsely `IN_PROGRESS` or `COMPLETED`).
- Zero `teacher_intervention_executions` rows were created.
- Zero `learning_evidence` rows were produced.
- After correcting the underlying resource (pinning a real, PUBLISHED exam version onto the profile) and retrying with a FRESH idempotency key, the start succeeds normally — no permanent lockout from one failure, and retry/recovery follows existing F9 semantics exactly as task §33 requires.

## Cancelled intervention (Case U, task §34)

A `CANCELLED` Exam Reinforcement intervention cannot be started — `getEffectiveStatus` returns `CANCELLED`, which is neither `ASSIGNED` nor `IN_PROGRESS`, so `startExamReinforcementExecution` throws `StudentInterventionNotStartableError` before any exam-context work begins. No destructive behavior was invented for the "cancelled while an attempt might already be underway" scenario described in task §34 — this codebase's existing `cancelTeacherIntervention` (F11-B, unmodified) only permits cancelling `ASSIGNED`/`IN_PROGRESS` rows, and cancellation never deletes or mutates any already-created `simulation_attempts`/`exam_attempts` row; a Student's real attempt history is never destroyed by a later cancellation.

## Expired intervention (Case V, task §35)

An intervention whose `due_at` is in the past is never persisted with a fake `EXPIRED` status — `getEffectiveStatus` (F11-C1's own, unmodified derivation) computes it lazily on every read, exactly as for Concept/Skill/Competency. Starting it is rejected the same way as CANCELLED.

## Completed intervention re-start (task §36)

Not separately exercised as a distinct case in this certification run beyond what the lifecycle proof already covers: once `topicIntervention` reaches `COMPLETED` (Case N/O), no code path in `startExamReinforcementExecution` treats `COMPLETED` as a startable effective status — it falls outside the `ASSIGNED`/`IN_PROGRESS` allow-list identically to CANCELLED/EXPIRED, so a second execution can never be silently created through the same assignment.

## No orphan real F9 attempt from a genuine CONCURRENCY race (task §31)

As documented in `F11_C4_CONCURRENCY_REPORT.md`, the concurrency model eliminates this class of orphan entirely — the only way a real, execution-registry-unreferenced `exam_attempts`/`simulation_attempts` row can appear is a genuine FAILURE after `startSimulationAttempt` succeeds but before the enclosing transaction commits (a narrower, rarer window than a full attempt-creation race). No such orphan was produced in this certification run; if one occurred in production, it would carry zero Evidence (nothing was ever submitted against it) and would never be discoverable by the Student (no generic "list my simulation attempts" endpoint exists in F9 today, confirmed by inspection), matching the same "never surfaced, never contributes evidence" property C1-C3's own orphan residual has.
