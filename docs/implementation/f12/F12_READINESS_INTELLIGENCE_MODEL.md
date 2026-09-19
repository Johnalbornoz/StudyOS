# F12 — Readiness Intelligence Model

## F9 exclusively, never legacy (INV-F12-08/09, AC-F12-15/16)

`getInstitutionReadiness` reads ONLY `readiness_snapshots` (F9's real, append-only table, one row per `computeReadinessSnapshot` call) — the latest row per `exam_profile_id` for the requested `examVersionId`. It never imports or calls `src/services/exam-readiness.service.ts` (the live, pre-F9 legacy module) — structurally guarded (`f12-institution-intelligence-source-guard.test.ts`) and real-Postgres proven (Case O: the legacy module's `getOverallExamReadiness` is called directly in the certification to prove it EXISTS and is live elsewhere, then F12's own module is confirmed to never reference it).

## Seven dimensions preserved, never collapsed (task section 17)

`dimensionStatusDistribution` is keyed by `ReadinessDimension` (`KNOWLEDGE_READINESS`, `SKILL_READINESS`, `EXAM_TECHNIQUE_READINESS`, `SPEED_FLUENCY_READINESS`, `BLUEPRINT_EVIDENCE_COVERAGE`, `SIMULATION_PERFORMANCE`, `EVIDENCE_SUFFICIENCY`), each with its OWN `DimensionStatus` distribution (`STRONG`/`DEVELOPING`/`WEAK`/`INSUFFICIENT_EVIDENCE`/`NOT_APPLICABLE`) — never averaged into one overall number beyond F9's own already-computed `overallStatus`.

## One exam version per call, structurally (INV-F12-17, AC-F12-17)

The function signature takes exactly one `examVersionId`; the SQL filters `rs.exam_version_id = $2`. There is no parameter or code path that accepts more than one exam version in a single aggregation — comparing PAA and Cambridge readiness requires two separate calls, each independently labeled with its own `examVersionId` in the result (real-Postgres proven, Case Q).

## Score projection never fabricated (INV-F12-18-adjacent, task section 19, AC-F12-18)

`scoreProjectionAvailabilityDistribution` reports F9's own real `ScoreProjectionAvailability` enum values (`AVAILABLE`/`NOT_AVAILABLE_NO_CALIBRATION`/`NOT_AVAILABLE_INSUFFICIENT_DATA`/`NOT_APPLICABLE`) verbatim — F12 never computes a raw-percent/readiness-percent/AI-estimate substitute for an official score.

## PAA Full Mock platform-not-ready vs learner-not-ready (task section 20)

F12 does not implement Full Mock eligibility itself; it reports whatever `overallStatus`/`BLUEPRINT_EVIDENCE_COVERAGE` F9's own real snapshot already computed for a given learner. The PLATFORM-level guard (`canFullMockBeOffered`/`getFullMockEligibility`) is verified directly in certification (Case P) to remain `NOT_READY` for PAA — this is a fact about the platform's own content completeness, orthogonal to any individual learner's readiness distribution, and F12 never conflates the two.

## Small-cohort suppression applies here too

Readiness aggregates go through the identical `applyCohortSuppression` used by learning intelligence — real-Postgres proven (Case N in this certification run): a 1-learner PAA readiness cohort against the TEST POLICY's `minimumCohortSize=3` is correctly suppressed rather than shown.
