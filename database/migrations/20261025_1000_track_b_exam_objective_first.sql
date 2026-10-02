-- Track B -- Exam preparation, objective first (DEV).
--
-- Strictly additive (one NOT NULL is relaxed, nothing is dropped or rewritten).
-- Never applied automatically -- governed runner only.
--
-- 1. A preparation profile may now target ANY governed catalogue objective,
--    including one with no configured exam yet (catalogue only): the profile
--    keeps the objective's canonical key (e.g. 'pisa.2022', 'ib.dp.physics.hl',
--    'cie.asal.9709.as', 'cie.aice.diploma') and a snapshot of its context.
--    exam_definition_id becomes optional; every row still names an exam
--    definition OR an objective. Existing profiles are untouched and keep
--    opening exactly as before.
-- 2. At most ONE non-archived profile per Student and objective (the existing
--    one-per-exam-definition index stays): a retry or double click returns the
--    same preparation.
-- 3. exam_instances.purpose: 'DIAGNOSTIC' marks the preparation diagnostic (a
--    practice instance sampling the practice-ready areas). NULL = as before.
-- 4. exam_gap_concept_links also records concepts added from the preparation
--    plan (source EXAM_PREPARATION, with the profile). Still one link per
--    Student and canonical concept: the provenance is recorded once.
--
-- Rollback (DEV only, manual; only valid while no row relies on the relaxed column):
--   ALTER TABLE public.exam_gap_concept_links DROP CONSTRAINT IF EXISTS exam_gap_concept_links_source_check;
--   ALTER TABLE public.exam_gap_concept_links ADD CONSTRAINT exam_gap_concept_links_source_check CHECK (source = 'EXAM_GAP');
--   ALTER TABLE public.exam_gap_concept_links DROP COLUMN IF EXISTS exam_profile_id;
--   ALTER TABLE public.exam_instances DROP CONSTRAINT IF EXISTS exam_instances_purpose_check;
--   ALTER TABLE public.exam_instances DROP COLUMN IF EXISTS purpose;
--   DROP INDEX IF EXISTS public.uq_student_exam_profiles_one_active_objective;
--   ALTER TABLE public.student_exam_profiles DROP CONSTRAINT IF EXISTS student_exam_profiles_target_check;
--   ALTER TABLE public.student_exam_profiles DROP CONSTRAINT IF EXISTS student_exam_profiles_source_check;
--   ALTER TABLE public.student_exam_profiles DROP COLUMN IF EXISTS source, DROP COLUMN IF EXISTS target_qualification,
--     DROP COLUMN IF EXISTS target_institution_name, DROP COLUMN IF EXISTS objective_context, DROP COLUMN IF EXISTS objective_node_id,
--     DROP COLUMN IF EXISTS objective_framework, DROP COLUMN IF EXISTS objective_key;
--   ALTER TABLE public.student_exam_profiles ALTER COLUMN exam_definition_id SET NOT NULL;
--   DELETE FROM public.schema_migrations WHERE version = '20261025_1000';
-- ---------------------------------------------------------------------

-- --- 1. Objective-first preparation profiles ---
ALTER TABLE public.student_exam_profiles ADD COLUMN IF NOT EXISTS objective_key text;
ALTER TABLE public.student_exam_profiles ADD COLUMN IF NOT EXISTS objective_framework text;
ALTER TABLE public.student_exam_profiles ADD COLUMN IF NOT EXISTS objective_node_id uuid REFERENCES public.assessment_structure_nodes(id);
ALTER TABLE public.student_exam_profiles ADD COLUMN IF NOT EXISTS objective_context jsonb;
ALTER TABLE public.student_exam_profiles ADD COLUMN IF NOT EXISTS target_institution_name text;
ALTER TABLE public.student_exam_profiles ADD COLUMN IF NOT EXISTS target_qualification text;
ALTER TABLE public.student_exam_profiles ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE public.student_exam_profiles ALTER COLUMN exam_definition_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_exam_profiles_target_check') THEN
    ALTER TABLE public.student_exam_profiles ADD CONSTRAINT student_exam_profiles_target_check
      CHECK (exam_definition_id IS NOT NULL OR objective_key IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_exam_profiles_source_check') THEN
    ALTER TABLE public.student_exam_profiles ADD CONSTRAINT student_exam_profiles_source_check
      CHECK (source IS NULL OR source IN ('STUDENT', 'EXAM_INSTANCE', 'INSTITUTION'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_exam_profiles_objective_key_format') THEN
    ALTER TABLE public.student_exam_profiles ADD CONSTRAINT student_exam_profiles_objective_key_format
      CHECK (objective_key IS NULL OR objective_key ~ '^[a-z0-9._-]{1,120}$');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_student_exam_profiles_one_active_objective
  ON public.student_exam_profiles (student_id, objective_key) WHERE status <> 'ARCHIVED' AND objective_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_student_exam_profiles_objective ON public.student_exam_profiles (objective_key) WHERE objective_key IS NOT NULL;

-- --- 3. Diagnostic instances ---
ALTER TABLE public.exam_instances ADD COLUMN IF NOT EXISTS purpose text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exam_instances_purpose_check') THEN
    ALTER TABLE public.exam_instances ADD CONSTRAINT exam_instances_purpose_check
      CHECK (purpose IS NULL OR (purpose = 'DIAGNOSTIC' AND mode = 'PRACTICE'));
  END IF;
END $$;

-- --- 4. Concepts added from the preparation plan ---
ALTER TABLE public.exam_gap_concept_links ADD COLUMN IF NOT EXISTS exam_profile_id uuid REFERENCES public.student_exam_profiles(id);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exam_gap_concept_links_source_check' AND pg_get_constraintdef(oid) NOT LIKE '%EXAM_PREPARATION%') THEN
    ALTER TABLE public.exam_gap_concept_links DROP CONSTRAINT exam_gap_concept_links_source_check;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exam_gap_concept_links_source_check') THEN
    ALTER TABLE public.exam_gap_concept_links ADD CONSTRAINT exam_gap_concept_links_source_check
      CHECK (source IN ('EXAM_GAP', 'EXAM_PREPARATION'));
  END IF;
END $$;
