# F12 — Aggregation Policy

## What F12 aggregates and how

Every aggregate is a `GROUP BY`/`COUNT` over already-materialized rows scoped by a real institutional relationship (`class_enrollments`/`teacher_assignments`/`institution_id` columns) — never a per-row service re-invocation (task section 45). No aggregate recomputes classification; it only counts existing, real classification values (`mastery_state`, `state`, `overall_status`, `primary_gap_type`, intervention `status`).

## Unique-learner vs enrollment-row counting (INV-F12-16, task section 30)

`INSTITUTION_UNIQUE_ACTIVE_LEARNERS` uses `COUNT(DISTINCT student_id)`; `INSTITUTION_ACTIVE_ENROLLMENT_COUNT` uses `COUNT(*)` over the same join. A learner enrolled in two ACTIVE classes within one institution contributes 1 to the former and 2 to the latter — both are reported, both are explicitly labeled, and no code path in the codebase silently substitutes one for the other. Real-Postgres proven (Case I/J): 3 unique learners, one of whom is enrolled in 2 classes, produce `uniqueActiveLearnerCount = 3` and `activeEnrollmentCount = 4`.

## Incompatible exam versions never averaged (INV-F12-17, task section 18)

`getInstitutionReadiness` takes exactly one `examVersionId` per call and its SQL join filters on `rs.exam_version_id = $2` — there is no code path that aggregates two different exam versions into one result set. Calling it once for PAA and once for Cambridge produces two separate, independently-labeled results; nothing in the codebase combines them (real-Postgres proven, Case Q).

## Latest-row-only for time-varying dimensions

Readiness (`readiness_snapshots`) and diagnosis (`learner_gap_diagnoses`) are both append-only/replay-capable, so every aggregation query uses `DISTINCT ON (...) ORDER BY ... DESC` to count only the LATEST row per (profile) or (student, concept, scope) key — a superseded historical row never double-counts against a learner who has since been re-evaluated.

## Small-cohort suppression is the final step (task section 27)

`applyCohortSuppression` is applied AFTER the real aggregate is computed, comparing the actual population size against the ACTIVE `institution_analytics_policy_versions` policy. See `F12_SMALL_COHORT_POLICY_DECISION.md` for the full policy contract.
