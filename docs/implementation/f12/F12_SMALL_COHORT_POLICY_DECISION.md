# F12 — Small-Cohort Policy Decision

## MIN_COHORT_POLICY: OPEN_DECISION

No approved production minimum-cohort threshold exists (task section 27 explicitly forbids inventing one). `institution_analytics_policy_versions` is created by F12's own migration and seeded with **zero rows**. `getActiveAnalyticsPolicy()` throws `NoActiveAnalyticsPolicyError` (message: `MIN_COHORT_POLICY: OPEN_DECISION -- no ACTIVE institution_analytics_policy_versions row exists`) when no ACTIVE row exists — meaning, in a fresh or Production database with no policy inserted, every cohort-suppression-dependent aggregate (`getInstitutionLearnerSummary`, `getClassLearningSummary`, `getInstitutionReadiness`) fails closed with a `409 MIN_COHORT_POLICY_OPEN_DECISION` response rather than silently displaying a potentially re-identifying small-cohort aggregate.

## What was found during discovery, and why it is NOT treated as approved

The pre-existing `origin/f12/institution-intelligence-discovery` branch (predates final F11 certification, not used as this implementation's baseline — see `F12_CURRENT_INSTITUTION_INTELLIGENCE_ASSESSMENT.md`) recorded a candidate minimum cohort of 10, attributed to a "user clarification" in that prior session. This session did not independently re-obtain that approval, so it is not promoted to a product default here. Using it silently would violate task section 27's explicit instruction ("Do not silently make the test threshold a product policy").

## The TEST POLICY used for THIS certification only

Real-Postgres certification inserts its own explicit row: `version 1, rules: { minimumCohortSize: 3 }, status: 'ACTIVE'`. This value was chosen to be small enough to exercise BOTH the suppressed and non-suppressed code paths within a practically-sized certification fixture (a 3-learner cohort passes; a 1-learner cohort is suppressed) — it is a certification convenience, explicitly labeled, versioned, and trivially replaceable by a real product decision without any code change (only a new `institution_analytics_policy_versions` row, following F5/F8/F9's own established policy-versioning workflow).

## Architecture supports governance without a code change (AC-F12-25)

Changing the effective threshold in Production requires only inserting a new `ACTIVE` policy row (and marking the prior one `RETIRED`, mirroring F5/F9's own precedent) — no application code change, no redeploy. This is what "the aggregation layer CAN suppress or generalize sensitive aggregates" (task section 27) means in this implementation: the mechanism is real and load-bearing (real-Postgres proven, Case X: a 1-learner cohort is suppressed under the TEST POLICY), while the actual number remains a governed, versioned, swappable decision.

## Suppression, not generalization, in this implementation

F12 currently implements binary suppression (`{ suppressed: true, reason: 'SMALL_COHORT' }` vs. the real value) rather than statistical generalization (e.g., bucketing into ranges). Task section 27 allows either ("suppress OR generalize"); suppression was chosen as the simpler, more conservative first implementation. A future phase could add range-based generalization as an alternative `AnalyticsPolicyRules` shape without changing the suppression call site's contract.
