# F12 — Intervention Intelligence Model

## F11's own table, directly (task section 22)

`getInstitutionInterventionSummary` reads `teacher_interventions` directly, filtered by its own real `institution_id`/`class_id`/`intervention_type`/`assigned_at` columns — no join needed to scope it, and no second intervention registry.

## Effective status reused verbatim, never re-derived (INV-F12-22)

`EXPIRED` status is computed by calling F11-C1's own `getEffectiveStatus(status, dueAt)` function directly — the identical derivation the Student's own pending-list surface uses. F12 introduces no second lifecycle rule.

## Known dependency: F11's completion observation is lazy (documented limitation)

F11's `reconcileCompletionsForStudent` (private to `teacher-intervention-execution.service.ts`) only runs when a Student's OWN pending-intervention list is read (e.g., when they open their dashboard) — there is no background job that proactively flips `teacher_interventions.status` to `COMPLETED` the instant the underlying quiz/exam attempt finishes. `getInstitutionInterventionSummary` reads `teacher_interventions.status` directly and does **not** trigger reconciliation itself (doing so per-learner would reintroduce the exact N+1 pattern task section 45 forbids, and doing it in bulk would require exporting/duplicating F11's private reconciliation function — a second lifecycle authority, INV-F12-22). **Consequence**: an institution admin's view of intervention status reflects whatever was last reconciled by the Student's own activity, not necessarily the instant the underlying activity finished. This is a real, disclosed limitation (see `F12_RESIDUAL_RISK_REGISTER.md`), not a defect — the underlying data is never wrong, only potentially not-yet-observed.

## Completion means activity completed, never a performance claim (task section 22)

Real-Postgres proven (Case T): an intervention whose underlying quiz was submitted INCORRECTLY still reaches `COMPLETED` once F11's own reconciliation runs — `getInstitutionInterventionSummary` counts it as `COMPLETED`, with no separate "quality" annotation anywhere in the result shape.

## Causality language discipline (task section 22)

This implementation does not currently attempt outcome-linkage claims ("intervention X was followed by evidence Y") — the `InstitutionInterventionSummary` shape reports only status/type distributions, deliberately scoped narrowly for this phase. If a future phase adds outcome-linkage reporting, task section 22's own required language discipline ("followed by"/"associated with"/"subsequent", never "caused") applies, and no validated causal methodology exists yet to justify a causal claim.

## Teacher operational metrics, purely operational (task section 23, INV-F12-13/14)

`getTeacherOperationalSummary` reports `activeAssignmentCount`, `activeLearnerCount`, `interventionsAssigned`, `interventionsCompleted`, and `lastInterventionAssignedAt` — five operational counts, zero scores, zero rankings. No function anywhere in the module sorts, compares, or ranks teachers against each other; no "BEST/WORST TEACHER" or quality score exists (structurally guarded).
