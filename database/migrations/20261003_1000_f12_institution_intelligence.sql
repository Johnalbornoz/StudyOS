-- F12 -- Institution Intelligence.
--
-- F12 is primarily a read/analytics layer over already-certified domain
-- authorities (F2 institutions, F5 learner state, F6 curriculum
-- coverage, F8 diagnosis, F9 readiness, F11 interventions) -- it
-- introduces no new academic-truth table. The ONE schema addition this
-- migration makes is a versioned policy table for institution-analytics
-- governance decisions (currently: small-cohort suppression), mirroring
-- F5/F8/F9's own established "aggregation_policy_versions"/
-- "diagnostic_policy_versions"/"readiness_policy_versions" idiom.
--
-- Deliberately seeded with ZERO rows (task section 27: "Do NOT invent a
-- production privacy threshold... If no approved threshold exists:
-- report MIN_COHORT_POLICY: OPEN_DECISION"). getActiveAnalyticsPolicy()
-- throws when no ACTIVE row exists, so cohort-suppression-dependent
-- aggregates fail closed in a fresh/Production database until a real
-- product decision inserts one -- never a silently-invented default.
-- Real-Postgres certification inserts its own explicit TEST POLICY row,
-- exactly as F11-C1 had to seed mastery_policies itself.

CREATE TABLE IF NOT EXISTS public.institution_analytics_policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version integer NOT NULL UNIQUE,
  rules jsonb NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  effective_from timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT institution_analytics_policy_versions_status_check CHECK (status IN ('ACTIVE', 'RETIRED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_institution_analytics_policy_versions_one_active
  ON public.institution_analytics_policy_versions ((1)) WHERE status = 'ACTIVE';
