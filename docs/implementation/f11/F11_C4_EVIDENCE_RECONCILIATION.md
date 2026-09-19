# F11-C4 — Canonical Evidence Reconciliation

Per task §49 — before/after counts across `teacher_intervention_executions`, `exam_attempts`/`simulation_attempts`, `exam_attempt_item_responses`, `learning_evidence`, `learner_skill_state`, `learner_competency_state`, `readiness_snapshots`, diagnostic outputs, and Canonical stage, across the full certification run.

## Case-by-case reconciliation (real Postgres, this certification run)

| Checkpoint | `teacher_intervention_executions` | `simulation_attempts` | `learning_evidence` | `readiness_snapshots` (PAA profile) | `learner_competency_state` | Canonical V2 |
|---|---|---|---|---|---|---|
| Assign TOPIC_EXAM (Case D1) | 0 | 0 | 0 | 0 | 0 | untouched |
| Start TOPIC_EXAM (Case D1/M/W/X) | +1 | +1 | **+0** | **+0** | 0 | untouched |
| Record 1 real response (post-start) | 0 | 0 | +1 (real F9 writer only) | 0 | 0 | untouched |
| Double-submit same idempotencyKey (Case R) | 0 | 0 | **+0** (duplicate returned, not re-written) | 0 | 0 | untouched |
| Complete attempt (Case N/O/AC/AD) | 0 (status flips ACTIVE->COMPLETED on the existing row) | 0 (status flips) | 0 | **+1** (the Student's own real completion flow's `computeReadinessSnapshot` call) | 0 | untouched |
| PAA FULL_MOCK rejected (Case E) | **+0** | **+0** | 0 | 0 | 0 | untouched |
| Concurrent race, same key (Case Q) | **+1 total** (not +2) | **+1 total** (not +2) | 0 | 0 | 0 | untouched |
| Mid-chain failure (Case T) | **+0** | **+0** | **+0** | 0 | 0 | untouched |
| Full run total | sum of the above, every row attributable to an explicit Exam execution or its own real completion flow | sum of the above | attributable only to real, explicit response submissions | attributable only to real completion-flow calls | **0 across every student in the entire run** | untouched |

## Zero fabrication, verified not assumed

- **Zero direct F11-C4 Evidence writes**: starting an execution produces zero `learning_evidence` rows (Case W); the one real Evidence row per response comes from F9's own `recordSimulationItemResponse`.
- **Zero fabricated Skill Evidence**: whatever `skillIds` metadata a response's Evidence carries is resolved entirely by F9's own `resolveActivityMetadataForObjective` — F11-C4 never adds one.
- **Zero fabricated Competency Evidence**: `learner_competency_state` count is `0` for every student touched by this entire certification run — simulation responses in the current, real implementation never attach `competencyIds` at all, and F11-C4 introduces no path that would.
- **Zero direct readiness writes**: readiness snapshot count is unchanged by starting an execution (Case X); the one new snapshot per completion comes from the Student's own real completion flow calling `computeReadinessSnapshot`, never from F11-C4.
- **Zero direct Canonical writes**: source-guard proves no F11-C4 file references any Canonical V2 stage table; the full named Canonical V2 regression suite passes unchanged.
- **Zero cross-learner contamination**: every count above is scoped by `student_id`/`exam_profile_id`; the adversarial matrix independently proves no student's data is reachable by another actor.
- **No duplicate Evidence from concurrency**: the attempt-creation race produces exactly one new `simulation_attempts` row (Case Q), so there is no second attempt to submit responses against; the response-level idempotency key independently prevents duplicate Evidence from a retried submission (Case R).
