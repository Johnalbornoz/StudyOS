# F13 — Exam Prep Experience

## Status: not built as a dedicated Student-facing surface this phase (disclosed scope decision)

Task section 11/12/13/14 describe a coherent Student Exam Prep navigation (Exam Profile / Readiness / Practice by Topic/Domain / Mini Mock / Full Mock / Exam Skills / Results / Recommendations). This phase prioritized building the Teacher and Institution workspaces (which had zero UI at all) over a new Student-facing Exam Prep surface (which has zero UI today but a fully self-service-capable backend, task section 45's own confirmation). This is a real, disclosed gap, not a silently-dropped requirement.

## What IS real and certified today, ready for that future page to consume without new backend work

- `getSimulationEligibility`/`startSimulationAttempt` (F9) — Topic/Domain/Mini/Full Mock, self-service, independent of Teacher assignment (re-verified in this phase's regression run).
- `readiness_snapshots` (F9) — 7 named dimensions, `overallStatus`, `scoreProjectionAvailability` — the exact shape `F13_PROGRESS_READINESS_PRESENTATION.md`'s presentation rules already describe and that `toneForReadinessStatus`/`StatusBadge` (built this phase) already know how to render.
- PAA Full Mock NOT_READY (F9) — a real, honest, already-certified fact, re-verified unchanged in this phase's regression run and directly exercised by the Teacher assignment flow this phase DID build (`F13_TEACHER_EXPERIENCE.md`), which already proves the presentation-layer pattern (StatusBadge + neutral tone, never styled as failure) works end-to-end for this exact status.

## What a future Exam Prep page should reuse from this phase's own work

`StatusBadge`/`toneForReadinessStatus` (already handle `FULL_MOCK_ELIGIBLE`/`SIMULATION_READY`/`DEVELOPING`/`EARLY_PREPARATION`/`INSUFFICIENT_EVIDENCE` correctly, INV-F13-11/12 already satisfied), `MetricCard` (for dimension-by-dimension display, never collapsed into one number, task section 13), and the exact server-component-calls-service-directly pattern every new page in this phase established.
