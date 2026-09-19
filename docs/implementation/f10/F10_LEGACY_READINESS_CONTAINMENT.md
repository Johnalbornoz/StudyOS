# F10 — Legacy Readiness Containment

## Full inventory of `calculateExamReadiness` (`src/services/exam-readiness.service.ts`) callers, verified by grep against F10's worktree

| Caller | Kind | Notes |
|---|---|---|
| `src/app/api/exam-readiness/score/route.ts` | Direct import + call | Writes result to `assessment_occurrences.exam_readiness` via `cacheReadinessScore` |
| `src/app/api/quizzes/generate-and-take/route.ts` | Direct import + call | Uses the predicted score only for post-hoc calibration comparison (`calculateExamReadinessCalibration`), not displayed as-is to the learner as a readiness figure |
| `src/services/assessment-verification.service.ts` | Comment reference only | `calculateExamReadinessCalibration` here takes a `predictedReadiness: number` parameter whose *caller* (generate-and-take route, above) happens to source it from the legacy service; this file itself does not import `exam-readiness.service.ts` |
| `src/lib/readiness/types.ts` (F9) | Comment reference only | Documents the anti-pattern F9 replaces; no import |

**Transitive leak into the existing Parent surface**: `assessment.service.ts::getUpcomingForStudent` reads the cached `assessment_occurrences.exam_readiness` column (populated only by the `score/route.ts` path above) and returns it as `examReadiness`; `parent.service.ts::getChildOverview` forwards it unchanged into `upcomingExams[].examReadiness`. This is the one existing Parent-facing exposure of the legacy number, and it predates F10.

## F10's containment commitment

- Zero new files added in F10 import `@/services/exam-readiness.service` — verified by `tests/unit/f10-legacy-readiness-noninterference.test.ts`, a source-grep guard test (the same pattern used by every prior phase's `*-canonical-v2-noninterference.test.ts`) scoped to `src/lib/parent/**` and `src/app/api/parent/**`.
- `getChildOverview`/`child-overview/route.ts` are left untouched (task §16 — no immediate safety requirement forces their retirement now); their pre-existing legacy exposure is documented here, not hidden, and not expanded.
- F10's own new exam-preparation surface (`getParentExamPreparation`) is built exclusively on F9's `readiness.service.ts`, proven by the same guard test asserting the read-model file imports only from `@/lib/readiness/*` and `@/lib/simulation/*` for readiness/exam data, never `@/services/exam-readiness.service` or `@/services/assessment.service`'s `examReadiness`/`getUpcomingForStudent` export.

## Retirement

Deferred, per task §16, to a later phase (F13/F14 candidate) — retiring `score/route.ts`/`generate-and-take/route.ts`'s use of the legacy service is a Student-flow change outside F10's Parent-only scope and carries its own regression risk that F10's mandate does not require taking on now.
