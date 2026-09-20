# F13 — Progress / Readiness Presentation

## F9 exclusively for anything new (INV-F13-05/09, task section 13/17)

Every NEW surface this phase built that touches readiness (`teacher.student.readiness` on the Teacher Student Detail page) reads F9's real `latestReadinessStatus` (via `getTeacherStudentOverview`, which itself reads `getLatestReadinessSnapshot`) — never the legacy `exam-readiness.service.ts`, never a recomputed value. Structurally guarded (`f13-ux-consolidation-source-guard.test.ts`).

## Never collapsed into one number (task section 13)

`StatusBadge` renders the named `OverallReadinessStatus` string itself (`FULL_MOCK_ELIGIBLE`, `SIMULATION_READY`, `DEVELOPING`, `EARLY_PREPARATION`, `INSUFFICIENT_EVIDENCE`) or the explicit `NO_ACTIVE_EXAM_PROFILE` sentinel — never a synthesized percentage. No new code anywhere in this phase computes an average across F9's 7 named dimensions.

## No fabricated score projection (INV-F13-18, task section 14) — not exercised by a NEW page this phase, but the pattern is established

No new page this phase renders `scoreProjectionAvailability` (the Teacher Student Detail page shows `overallStatus` only) — but the `StatusBadge`/tone-mapping pattern established here is exactly what a future page rendering it must reuse: render `NOT_AVAILABLE_NO_CALIBRATION`/`NOT_AVAILABLE_INSUFFICIENT_DATA` as their own literal, honest labels (already present verbatim in F9's own type, `src/lib/readiness/types.ts`), never substitute a raw percent or readiness percent in their place.

## Insufficient Evidence stays visible, never styled as failure (INV-F13-11/16, task section 13)

`toneForReadinessStatus('INSUFFICIENT_EVIDENCE')` returns `'neutral'` (the same tone as a plain, unremarkable status) — deliberately never `'critical'`/`'warn'`. The Institution Learners page renders `evidencePresence.value.noEvidence` as its own labeled count (`institution.learners.noEvidence`), never merged into or styled like a negative metric.

## Platform-not-ready vs learner-not-ready (INV-F13-12, task section 12)

Directly exercised end-to-end by the Teacher Exam-assignment flow this phase built: assigning a PAA FULL_MOCK intervention succeeds (Teacher intent), but starting it fails via F9's real `getSimulationEligibility` — this is a platform-capability fact, never rendered as a claim about the learner. No new page this phase yet surfaces this specific denial reason text to the Teacher UI (the form currently shows a generic `teacher.assign.error` on any rejection, including this one) — a real, disclosed follow-up: differentiating `PLATFORM_NOT_READY`/`LEARNER_NOT_READY`/`MORE_EVIDENCE_NEEDED` in the UI requires surfacing F9's own `reasonCodes` array through the assignment error response, which this phase's minimal form does not yet parse. See `F13_NEXT_PHASE_HANDOFF.md`.
