# F10 — Parent Exam Preparation Model

## Source: F9 exclusively (INV-F10-19, task §15)

`getParentExamPreparation` calls `src/lib/readiness/readiness.service.ts` (`getLatestReadinessSnapshot`/`computeReadinessSnapshot`) and `src/lib/simulation/*` directly. It never imports, calls, or transitively depends on `src/services/exam-readiness.service.ts`. Enforced by a structural guard test (see F10_LEGACY_READINESS_CONTAINMENT.md).

## Dimensions preserved verbatim

Knowledge, Skill, Technique, Speed, Fluency, Evidence Sufficiency, Blueprint Evidence Coverage, Simulation Performance — F9's own 7(+1) dimensions, each surfaced with F9's own status classification (e.g. `INSUFFICIENT_EVIDENCE` shown honestly, never hidden or replaced — INV-F10-21).

## Full Mock status (task §18/INV-F10-22)

F9's `full-mock-eligibility.service.ts` already distinguishes *why* `NOT_READY`: a platform-configuration/coverage reason (e.g. no calibrated exam version, blueprint incomplete) versus a learner-evidence reason (e.g. insufficient attempts). The Parent DTO carries this distinction through as two literal reason categories, `PLATFORM_NOT_READY` and `LEARNER_NOT_READY`, with F9's own human-readable reason string — never collapsed into a single "not ready" that could be misread as the learner's fault when it's a platform limitation.

## Score projection (task §19/INV-F10-23)

`CAN_PROJECT_OFFICIAL_SCORE` is read and passed through unchanged: `AVAILABLE` (with F9's calibrated score) or `NOT_AVAILABLE_NO_CALIBRATION` (with no numeric substitute — no raw percentage, readiness score, or AI estimate is ever shown in its place).

## What Parent cannot do

Parent read-model routes are GET-only; no route allows setting/changing the learner's Exam Profile, exam date, or target framework (task §17's explicit prohibition).
