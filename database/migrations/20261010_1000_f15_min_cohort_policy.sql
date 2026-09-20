-- F15 -- resolves IVG-F12-04 (MIN_COHORT_POLICY: OPEN_DECISION). See
-- docs/implementation/f15/ADR-F15-MIN-COHORT-POLICY.md for the full
-- rationale. F12 deliberately shipped `institution_analytics_policy_versions`
-- with zero rows so this threshold would never be invented casually --
-- this migration is the real, documented product decision, seeded the
-- exact same way every other *_policy_versions table in this codebase
-- seeds its own initial version (readiness_policy_versions,
-- diagnostic_policy_versions, coverage_policy_versions, etc.).

INSERT INTO public.institution_analytics_policy_versions (version, rules, status)
SELECT 1, $POLICY$
{
  "minimumCohortSize": 10
}
$POLICY$::jsonb, 'ACTIVE'
WHERE NOT EXISTS (SELECT 1 FROM public.institution_analytics_policy_versions);
