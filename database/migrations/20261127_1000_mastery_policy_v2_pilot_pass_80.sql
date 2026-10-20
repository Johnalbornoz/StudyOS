-- LEARNING -- Mastery Policy v2: the 2026-10-17 pilot pass policy (ADDITIVE ONLY). Follows 20261126_1000.
--
-- Operator decision (STUDYOS PEDAGOGICAL JOURNEY, section 2): PASS_THRESHOLD = 80_PERCENT_INCLUSIVE for every
-- pedagogical dimension, superseding the mixed v1 thresholds (Application 75, Retention 75, Transfer 70):
--   Understanding >= 80, Independence >= 80, Application >= 80, Retention >= 80, Transfer >= 80
-- No compensating average between dimensions (determineMasteryState checks each one). Preserved unchanged from v1:
-- requires_transfer, maximum_critical_misconceptions = 0, the evidence-count minimums, the validation window.
--
-- What this migration does: inserts mastery_policies version 2 (the highest version is the active policy --
-- getActiveMasteryPolicy). Version 1 is never modified or deleted (auditable history). No other table is touched.
--
-- Rollback (restores v1 as the active policy):
--   DELETE FROM public.mastery_policies WHERE version = 2;
--   DELETE FROM schema_migrations WHERE version = '20261127_1000';

INSERT INTO public.mastery_policies (
  version, minimum_understanding, minimum_independence, minimum_application,
  minimum_retention, minimum_transfer, requires_transfer, maximum_critical_misconceptions,
  minimum_evidence_count, minimum_independent_evidence_count, retention_min_gap_days,
  validation_window_days
)
SELECT 2, 80, 80, 80, 80, 80, v1.requires_transfer, v1.maximum_critical_misconceptions,
       v1.minimum_evidence_count, v1.minimum_independent_evidence_count, v1.retention_min_gap_days,
       v1.validation_window_days
  FROM public.mastery_policies v1
 WHERE v1.version = 1
ON CONFLICT (version) DO NOTHING;
