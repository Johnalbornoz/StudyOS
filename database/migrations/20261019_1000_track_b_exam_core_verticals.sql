-- Track B -- Exam Core + verticals (PAA / PISA / IB / CAMBRIDGE / AICE / ICFES).
--
-- Strictly additive on top of F6/F7/F9 (see docs/exams/EXAM_CORE_IMPLEMENTATION.md):
--   * no table is dropped, no column is dropped or retyped, no existing CHECK is
--     narrowed for existing rows;
--   * every new column is NULLable (or has a default) so every existing caller
--     keeps its exact behaviour;
--   * no CHECK is narrowed and no existing value is rewritten (the exam-family
--     taxonomy is enforced by the application layer, see below).
--
-- Never applied automatically -- governed runner only (`npm run db:migrate`).
--
-- Rollback (DEV only, manual, in this order):
--   DROP TABLE IF EXISTS public.exam_attempt_results;
--   DROP INDEX IF EXISTS public.idx_exam_attempt_item_responses_target;
--   ALTER TABLE public.exam_attempt_item_responses DROP COLUMN IF EXISTS item_source, DROP COLUMN IF EXISTS target_index;
--   DROP INDEX IF EXISTS public.idx_assessment_components_version_section_key;
--   ALTER TABLE public.assessment_components DROP COLUMN IF EXISTS section_key, DROP COLUMN IF EXISTS sequence_order;
--   ALTER TABLE public.exam_versions DROP CONSTRAINT IF EXISTS exam_versions_exam_year_check,
--     DROP CONSTRAINT IF EXISTS exam_versions_exam_session_check, DROP COLUMN IF EXISTS exam_session, DROP COLUMN IF EXISTS exam_year;
--   DROP INDEX IF EXISTS public.idx_exam_definitions_config_key;
--   ALTER TABLE public.exam_definitions DROP COLUMN IF EXISTS aggregation_group, DROP COLUMN IF EXISTS academic_subject_id, DROP COLUMN IF EXISTS config_key;
--   DELETE FROM public.schema_migrations WHERE version = '20261019_1000';
-- ---------------------------------------------------------------------

-- --- B2: exam-family taxonomy + configuration identity ---

-- Stable natural key for configuration-driven verticals: applying the same
-- vertical configuration twice updates/reuses the same definition instead of
-- creating a duplicate. NULL for every hand-made / legacy definition.
ALTER TABLE public.exam_definitions ADD COLUMN IF NOT EXISTS config_key text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_exam_definitions_config_key
  ON public.exam_definitions (config_key) WHERE config_key IS NOT NULL;

-- Optional subject anchor (Cambridge / IB / AICE: Qualification -> Subject).
-- Multi-area exams (PAA, PISA, ICFES) leave it NULL and carry areas as components.
ALTER TABLE public.exam_definitions ADD COLUMN IF NOT EXISTS academic_subject_id uuid REFERENCES public.academic_subjects(id);

-- Qualification aggregation (AICE = a group of Cambridge subjects): the
-- subject-group label this definition counts toward inside its
-- qualification. Grouping only -- no certificate rule is stored or implied.
ALTER TABLE public.exam_definitions ADD COLUMN IF NOT EXISTS aggregation_group text;

-- The exam-family taxonomy (PAA, PISA, IB, CAMBRIDGE, AICE, ICFES) is
-- enforced by the application layer (createExamDefinition, the vertical
-- configuration schema, the admin API). A DB CHECK is deliberately NOT added
-- here: DEV is shared with the parallel Roles track, whose foundation
-- scenarios still create definitions with a test family label. The CHECK is
-- a post-merge follow-up (docs/exams/EXAM_CORE_IMPLEMENTATION.md, P3).

-- --- Year / session: OPTIONAL Exam Version metadata ---
-- Audited first: effective_from/effective_to are validity dates and
-- version_label is free text -- neither is a sitting year or session, so two
-- nullable columns are added. Families that do not need them leave them NULL.

ALTER TABLE public.exam_versions ADD COLUMN IF NOT EXISTS exam_year integer;
ALTER TABLE public.exam_versions ADD COLUMN IF NOT EXISTS exam_session text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exam_versions_exam_year_check') THEN
    ALTER TABLE public.exam_versions
      ADD CONSTRAINT exam_versions_exam_year_check CHECK (exam_year IS NULL OR exam_year BETWEEN 1990 AND 2100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exam_versions_exam_session_check') THEN
    ALTER TABLE public.exam_versions
      ADD CONSTRAINT exam_versions_exam_session_check CHECK (exam_session IS NULL OR char_length(exam_session) BETWEEN 1 AND 60);
  END IF;
END $$;

-- --- Sections: deterministic order + a stable key per version ---
-- section_key is what a scoring policy's sectionWeights and a delivery
-- policy's breaks refer to (never a display name, never a UUID in config).
ALTER TABLE public.assessment_components ADD COLUMN IF NOT EXISTS sequence_order integer;
ALTER TABLE public.assessment_components ADD COLUMN IF NOT EXISTS section_key text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_assessment_components_version_section_key
  ON public.assessment_components (exam_version_id, section_key) WHERE section_key IS NOT NULL;

-- --- Server-authoritative delivery: one committed response per delivered item ---
-- target_index is the position of the item in the attempt's frozen plan. The
-- partial UNIQUE index makes a second commit for the same item impossible even
-- under concurrent submissions carrying different idempotency keys. NULL for
-- every pre-Track-B row.
ALTER TABLE public.exam_attempt_item_responses ADD COLUMN IF NOT EXISTS target_index integer;
CREATE UNIQUE INDEX IF NOT EXISTS idx_exam_attempt_item_responses_target
  ON public.exam_attempt_item_responses (exam_attempt_id, target_index) WHERE target_index IS NOT NULL;

ALTER TABLE public.exam_attempt_item_responses ADD COLUMN IF NOT EXISTS item_source text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exam_attempt_item_responses_item_source_check') THEN
    ALTER TABLE public.exam_attempt_item_responses
      ADD CONSTRAINT exam_attempt_item_responses_item_source_check
      CHECK (item_source IS NULL OR item_source IN ('APPROVED_BANK', 'AI_GENERATED'));
  END IF;
END $$;

-- --- B1: scored result with full provenance (exam truth, never cognition) ---
-- One row per exam attempt (UNIQUE): a retried submission can never create a
-- second result. Append-only in spirit: a result is never re-scored in place;
-- invalidation only stamps status/invalidated_at/invalidation_reason.
CREATE TABLE IF NOT EXISTS public.exam_attempt_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_attempt_id uuid NOT NULL UNIQUE REFERENCES public.exam_attempts(id),
  student_id uuid NOT NULL REFERENCES public.students(id),
  exam_version_id uuid NOT NULL REFERENCES public.exam_versions(id),
  scoring_model_id uuid REFERENCES public.scoring_models(id),
  scoring_engine_version text NOT NULL,
  scoring_policy_hash text,
  status text NOT NULL DEFAULT 'SCORED',
  scoring_status text NOT NULL,
  raw_score numeric NOT NULL,
  max_score numeric NOT NULL,
  final_score numeric,
  final_label text,
  section_results jsonb NOT NULL,
  objective_results jsonb NOT NULL,
  provenance jsonb NOT NULL,
  response_set_hash text NOT NULL,
  scored_at timestamptz NOT NULL DEFAULT now(),
  invalidated_at timestamptz,
  invalidation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exam_attempt_results_status_check CHECK (status IN ('SCORED', 'INVALIDATED')),
  CONSTRAINT exam_attempt_results_scoring_status_check CHECK (scoring_status IN ('SCORED', 'NO_SCORING_POLICY')),
  CONSTRAINT exam_attempt_results_invalidation_consistency CHECK (
    (status = 'SCORED' AND invalidated_at IS NULL AND invalidation_reason IS NULL) OR
    (status = 'INVALIDATED' AND invalidated_at IS NOT NULL AND invalidation_reason IS NOT NULL)
  ),
  CONSTRAINT exam_attempt_results_score_bounds CHECK (raw_score >= 0 AND max_score >= 0 AND raw_score <= max_score)
);

CREATE INDEX IF NOT EXISTS idx_exam_attempt_results_student ON public.exam_attempt_results (student_id, scored_at DESC);
CREATE INDEX IF NOT EXISTS idx_exam_attempt_results_version ON public.exam_attempt_results (exam_version_id);
