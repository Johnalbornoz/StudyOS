# F14 — Parent Readiness Migration (Workstream C)

## Before

`src/app/dashboard/parent/page.tsx` rendered, per upcoming exam:

```tsx
{e.examReadiness !== null && (
  <> · {t['parent.readiness']}: <strong>{Math.round(e.examReadiness)}%</strong></>
)}
```

sourced from `parent.service.ts::getChildOverview` → `assessment.service.ts::getUpcomingForStudent` → the raw `assessment_occurrences.exam_readiness` column, a pre-F9 percentage set only by `cacheReadinessScore()` when a student actively triggers `/api/exam-readiness/score` — never recomputed for the Parent flow, so Parent could see a stale or `null` cached value with no F9 provenance at all.

## After

The legacy percentage line was **removed**. In its place, the Parent page now fetches `GET /api/parent/learners/[studentId]/exam-prep` per child (an existing F10 route, `getParentExamPreparation`, whose own header comment already states it is "Sourced exclusively from F9's readiness/simulation engines... never the legacy exam-readiness.service.ts") and renders:

- The active Exam Profile's name/date.
- Every F9 dimension's status via the new `toneForDimensionStatus` (`StatusBadge`).
- Full Mock eligibility, with the real `PLATFORM_NOT_READY`/`LEARNER_NOT_READY` distinction `getParentExamPreparation` already computes from F9's own `structuralReadiness.ready` field — never guessed from reason text.
- `scoreProjectionAvailability`, rendered honestly (never a fabricated score).
- `data: null` (no active Exam Profile) is rendered as a real, distinct empty state (`parent.noActiveExamProfile`) — never silently mapped to zero, never hidden.

This is a genuine migration of *presentation*, not a new backend build: the F9-sourced replacement already existed (F10) and had simply never been wired into the Parent dashboard page.

## Read-only preserved

No new fetch, form, or button in this change performs a write. `GET /api/parent/learners/[studentId]/exam-prep` is GET-only. Parent's existing link/unlink-child forms are untouched.

## Remaining consumers of the legacy field (grep evidence)

```
src/services/assessment.service.ts       — 32, 51, 89, 137, 149, 256, 289, 305 (defines column / cacheReadinessScore) — shared infra, left alone
src/services/parent.service.ts           — 175, 219 (ChildOverview.examReadiness field) — LEFT ALONE, see below
src/app/api/exam-readiness/score/route.ts — the legacy engine's own real route — left alone
src/app/dashboard/subjects/[id]/AssessmentPanel.tsx — the Student's OWN self-service legacy-engine consumer — left alone (different feature, not this migration's scope)
src/lib/learner-twin/readers.ts (readAssessmentPressure) — reads exam_readiness by explicit design, documented as deliberately not assessment.service.ts — left alone
src/services/exam-result.service.ts (recordExamResult) — compares actual score vs. the cached prediction for calibration at exam completion time — left alone, this is the intentional use of the cached prediction
src/app/api/quizzes/generate-and-take/route.ts + dashboard/quiz/page.tsx — the Student's own Mock Exam calibration display (examReadinessCalibration) — a different, self-contained feature; leave-alone confirmed by F13's own prior audit and re-confirmed here
```

**After this migration, a grep for `examReadiness` across `src/app/dashboard/` returns exactly one match** — `dashboard/quiz/page.tsx`'s unrelated `examReadinessCalibration` (a Student's own post-exam calibration number, not a Parent-facing "readiness" percentage; classified `leave-alone` by both F13 and this phase's independent re-check).

## Why `parent.service.ts`'s `ChildOverview.examReadiness` field itself was NOT removed

Other real consumers of `getChildOverview` exist beyond the Parent dashboard page: `src/app/dashboard/admin/[studentId]/page.tsx` and `src/app/api/learners/[id]/summary/route.ts` (confirmed by grep). Neither renders `.examReadiness` (confirmed by direct inspection), so removing the field from the shared service's return type carries real risk (potential test/consumer breakage under `tests/unit/f2-api-routes-security.test.ts`, which also references `getChildOverview`) for zero additional presentation benefit. The field is now inert (unused by any frontend), documented here, and left as a small, disclosed residual rather than a risky, unnecessary structural change (see F14_RESIDUAL_RISK_REGISTER.md).

## Verification

`tests/unit/f14-experience-completion-source-guard.test.ts` asserts `dashboard/parent/page.tsx` no longer matches `/examReadiness/` and does reference the new `/api/parent/learners/.../exam-prep` route.
