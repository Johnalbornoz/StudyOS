# F11-C4 — Concurrency Report

Reported separately per task §62, never folded into a generic pass count.

## START_IDEMPOTENCY (sequential, Case P)

Two sequential calls with the same `idempotencyKey` against the same Exam intervention: first `STARTED`, second `RECOVERED` with the **identical** `executionId`. Exactly one `teacher_intervention_executions` row.

## ATTEMPT_CREATION_RACE (real concurrent, Case Q) — the critical departure from C1-C3

Two genuinely simultaneous (`Promise.all`) calls with the same `idempotencyKey` against the same Exam intervention: both resolve to the **identical** `executionId`, exactly one `teacher_intervention_executions` row, and — verified by an explicit before/after count of `simulation_attempts` for that exam profile/simulation type — **exactly ONE new real F9 `simulation_attempts` row was created, not two.**

This is a materially different (and stronger) guarantee than C1/C2/C3's own model. Those functions check the idempotency key under a row lock, then release the lock BEFORE the slow, AI-dependent `generatePracticeQuestions` call, relying on the final `UNIQUE(teacher_intervention_id, idempotency_key)` constraint to catch a genuine race (accepting one harmless orphaned `quiz_sessions` row as a documented trade-off). F11-C4 cannot accept an orphaned real exam attempt as harmless (task §31: "for exam attempts, harmless orphan must be proven, not assumed" — and an extra, unreferenced-but-real `simulation_attempts` row is not obviously harmless the way an unreferenced practice quiz is). Because `buildSimulationPlan`/`startExamAttempt` involve **zero AI/external calls** (pure DB work, verified in `F11_C4_CURRENT_EXAM_EXECUTION_ASSESSMENT.md`), `startExamReinforcementExecution` performs its ENTIRE claim-and-create sequence — idempotency check, exam-context validation, eligibility check, `startSimulationAttempt`, and the execution-registry insert — inside ONE row-locked transaction. A concurrent second caller's `SELECT ... FOR UPDATE` on the same `teacher_interventions` row blocks until the first caller's transaction fully commits (including its `teacher_intervention_executions` insert); once unblocked, it finds the existing row and returns `RECOVERED` **without ever calling `startSimulationAttempt`**. The race is structurally eliminated, not merely tolerated.

## RESPONSE_DOUBLE_SUBMIT (Case R)

Two identical `recordSimulationItemResponse` calls with the same `idempotencyKey`: the second returns `{ duplicate: true }` with the SAME `responseId` as the first, and the real-Postgres run confirms exactly one `learning_evidence` row exists afterward — F9's own, already-certified `exam_attempt_item_responses` idempotency index (`idx_exam_attempt_item_responses_idempotency`) is the actual guard; F11-C4 introduces no new protection here because it never calls this function itself, only observes its real behavior in certification.

## FINALIZATION_RACE (Case S)

A second `completeSimulationAttempt` call on an already-`COMPLETED` attempt throws (F9's own `status IN ('ACTIVE','PAUSED')` guard rejects it) — never re-scored, never re-diagnosed, never a duplicate F11 completion.

## EVIDENCE_DUPLICATION

Zero duplicate Evidence observed across all of the above: one legitimate response submission (even when retried with the same idempotency key) produces exactly one `learning_evidence` row; a real concurrent attempt-creation race produces exactly one attempt, so there is no second attempt to (mis)submit against in the first place.

## READINESS_RECOMPUTE_DUPLICATION

Not exercised as a race in this phase (readiness recomputation is entirely the Student's own real completion flow's responsibility, invoked once per completion in the certification) — F11-C4 itself never calls `computeReadinessSnapshot`, so it cannot introduce a duplication here; F9's own append-only snapshot design (each call inserts a new row, never mutates a prior one) is the relevant guarantee, already certified by F9 itself.
