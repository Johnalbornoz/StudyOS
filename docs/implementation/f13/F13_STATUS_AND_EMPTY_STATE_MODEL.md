# F13 — Status and Empty State Model

## Status vocabulary (task section 25) — one mapping, never a generic "error" standing in for a real state

`src/components/ui/StatusBadge.tsx` is the SINGLE place that decides which of 5 tones (`neutral`/`good`/`warn`/`critical`/`info`) a domain status renders as, via two pure mapping functions:

- `toneForInterventionStatus`: `ASSIGNED`→neutral, `IN_PROGRESS`→info, `COMPLETED`→good, `CANCELLED`→neutral, `EXPIRED`→warn.
- `toneForReadinessStatus`: `FULL_MOCK_ELIGIBLE`/`SIMULATION_READY`→good, `DEVELOPING`→info, `EARLY_PREPARATION`→warn, `INSUFFICIENT_EVIDENCE`/`NO_ACTIVE_EXAM_PROFILE`→**neutral, deliberately never critical** (INV-F13-11).

No two new pages render the same underlying status with two different tones — both mapping functions are imported, never re-implemented, everywhere a status is shown.

## Never color-only (task section 32)

Every `StatusBadge` renders its literal label text alongside the tone color — a screen reader or a colorblind user gets the same information a sighted user relying on color would (no status is EVER represented by color alone).

## Empty states (task section 26) — every one names the empty thing and, where applicable, the next action

| Surface | Empty state | Next action |
|---|---|---|
| Teacher: no assigned classes | `teacher.classes.empty` | (none yet -- assignment is admin-driven, no Teacher self-service onboarding CTA exists) |
| Teacher: class with no active students | `teacher.roster.empty` | n/a |
| Teacher: student with no assignments | `teacher.interventions.empty` | the Assign form is rendered directly below it |
| Institution: admin of zero institutions | `institution.mine.empty` | n/a (institution creation is StudyUS-admin-only, F2) |
| Institution: attention areas, none detected | `institution.attention.empty` | (a genuinely good state -- rendered as calm, not alarming) |
| Institution: cohort below the small-cohort policy threshold | `institution.learners.suppressedSmallCohort` | n/a (a deliberate, safe non-disclosure, not a "try again" situation) |
| Institution: no ACTIVE small-cohort policy configured at all | `empty.smallCohortSuppressed` (a distinct message from the above -- this is the OPEN_DECISION case, not a real suppression decision) | documented as a governance gap, not a UI bug |

## Loading / error states (task section 27)

This phase's new pages are Server Components with no client-side loading spinner needed for their own data (the page itself does not render until the data is ready, Next.js's own model) — the ONE client-side async action introduced (`AssignInterventionForm`'s submit, `WorkspaceSwitcher`'s switch) both show a distinct "submitting" label (`teacher.assign.submitting`) and a generic, non-leaking error message (`teacher.assign.error`/`error.generic`) on failure — never a raw stack trace or internal error string (task section 27's own explicit requirement, verified: neither component ever renders `error.message` or any caught exception's own text).
