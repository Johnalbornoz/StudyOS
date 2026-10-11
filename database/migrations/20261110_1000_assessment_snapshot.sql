-- B3 -- Assessment Execution & Evidence Loop: the frozen assessment snapshot.
--
-- One nullable JSONB column on each EXISTING record an attempt executes from:
--
--   quiz_sessions.assessment_snapshot    LEARNING assessments built by the Blueprint Core (B2)
--   exam_instances.assessment_snapshot   EXAM_PREPARATION / OFFICIAL_EXAM instances built by it
--
-- It holds the FrozenAssessment (src/lib/assessment-execution/frozen-assessment.ts): the selected question
-- references in their frozen order, the coverage each had at selection time, the policy / depth / activity /
-- curriculum / exam context, and what the blueprint could not satisfy. Written once, when the assessment is
-- generated; never updated afterwards (the service refuses a second, different snapshot).
--
-- No new table: the session and the exam instance stay the records of truth. `exam_instances.form` stays
-- the frozen official form; this column adds the blueprint's audit context beside it.
--
-- ADDITIVE ONLY. Nullable, no default, no backfill: every existing row keeps NULL and reads exactly as
-- before (a legacy session or instance simply has no B2 snapshot). No existing column, constraint or row
-- is changed. Idempotent.
--
-- Rollback:
--   ALTER TABLE public.quiz_sessions  DROP CONSTRAINT IF EXISTS quiz_sessions_assessment_snapshot_check,  DROP COLUMN IF EXISTS assessment_snapshot;
--   ALTER TABLE public.exam_instances DROP CONSTRAINT IF EXISTS exam_instances_assessment_snapshot_check, DROP COLUMN IF EXISTS assessment_snapshot;


ALTER TABLE public.quiz_sessions ADD COLUMN IF NOT EXISTS assessment_snapshot jsonb;
ALTER TABLE public.quiz_sessions DROP CONSTRAINT IF EXISTS quiz_sessions_assessment_snapshot_check;
ALTER TABLE public.quiz_sessions
  ADD CONSTRAINT quiz_sessions_assessment_snapshot_check
  CHECK (assessment_snapshot IS NULL OR (jsonb_typeof(assessment_snapshot) = 'object' AND assessment_snapshot ? 'snapshotId' AND assessment_snapshot ? 'items'));

ALTER TABLE public.exam_instances ADD COLUMN IF NOT EXISTS assessment_snapshot jsonb;
ALTER TABLE public.exam_instances DROP CONSTRAINT IF EXISTS exam_instances_assessment_snapshot_check;
ALTER TABLE public.exam_instances
  ADD CONSTRAINT exam_instances_assessment_snapshot_check
  CHECK (assessment_snapshot IS NULL OR (jsonb_typeof(assessment_snapshot) = 'object' AND assessment_snapshot ? 'snapshotId' AND assessment_snapshot ? 'items'));

COMMENT ON COLUMN public.quiz_sessions.assessment_snapshot IS 'B3: FrozenAssessment of a Blueprint-Core LEARNING assessment. Written once at generation. NULL for sessions not built by it.';
COMMENT ON COLUMN public.exam_instances.assessment_snapshot IS 'B3: FrozenAssessment (blueprint audit context) of a Blueprint-Core exam instance. Written once. NULL otherwise. The form column stays the frozen official form.';

