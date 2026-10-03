-- Track B -- Cambridge AICE Diploma plan + results + grade thresholds, and the
-- exam-gap provenance used by "Reforzar ahora" (all exam verticals) (DEV).
--
-- Strictly additive. Never applied automatically -- governed runner only.
--
-- * aice_diploma_plans / aice_plan_entries: the Student's own Diploma PLAN
--   (subjects, AS / A Level, the group a multi-group subject counts in, the
--   expected exam series). Credits are never stored -- always derived from the
--   level by the versioned policy (src/lib/exam-core/aice/policy.ts).
-- * cambridge_results: recorded Cambridge results. Never written by the Student
--   (coordinator / StudyUS admin only); withdrawn, never deleted.
-- * cambridge_grade_thresholds: official thresholds per syllabus, series, level
--   and component option, exactly as published. Empty until real tables are
--   loaded -- no threshold is ever assumed or extrapolated across series.
-- * exam_gap_concept_links: one row per Student and canonical concept added
--   from an exam gap (source EXAM_GAP); a repeated gap never duplicates it.
--
-- Rollback (DEV only, manual):
--   DROP TABLE IF EXISTS public.exam_gap_concept_links;
--   DROP TABLE IF EXISTS public.cambridge_grade_thresholds;
--   DROP TABLE IF EXISTS public.cambridge_results;
--   DROP TABLE IF EXISTS public.aice_plan_entries;
--   DROP TABLE IF EXISTS public.aice_diploma_plans;
--   DELETE FROM public.schema_migrations WHERE version = '20261024_1000';
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.aice_diploma_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id),
  policy_version text NOT NULL CHECK (length(policy_version) BETWEEN 1 AND 60),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_aice_diploma_plans_one_active ON public.aice_diploma_plans (student_id) WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS public.aice_plan_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.aice_diploma_plans(id),
  syllabus_code text NOT NULL CHECK (syllabus_code ~ '^[0-9]{4}$'),
  level text NOT NULL CHECK (level IN ('AS', 'A')),
  counted_group text CHECK (counted_group IN ('CORE', 'GROUP_1', 'GROUP_2', 'GROUP_3', 'GROUP_4')),
  expected_series_year integer CHECK (expected_series_year BETWEEN 2020 AND 2100),
  expected_series_month integer CHECK (expected_series_month IN (3, 6, 11)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aice_plan_entries_series_pair CHECK ((expected_series_year IS NULL) = (expected_series_month IS NULL)),
  CONSTRAINT aice_plan_entries_one_per_syllabus UNIQUE (plan_id, syllabus_code)
);

CREATE TABLE IF NOT EXISTS public.cambridge_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id),
  syllabus_code text NOT NULL CHECK (syllabus_code ~ '^[0-9]{4}$'),
  level text NOT NULL CHECK (level IN ('AS', 'A')),
  series_year integer NOT NULL CHECK (series_year BETWEEN 2000 AND 2100),
  series_month integer NOT NULL CHECK (series_month IN (3, 6, 11)),
  grade text NOT NULL,
  source text NOT NULL CHECK (source IN ('OFFICIAL_STATEMENT', 'COORDINATOR_VERIFIED', 'DEV_FIXTURE')),
  recorded_by_user_id uuid REFERENCES public.users(id),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'WITHDRAWN')),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  -- AS Level grades a-e (no A*), A Level A*-E; U for both.
  CONSTRAINT cambridge_results_grade_check CHECK ((level = 'AS' AND grade IN ('a', 'b', 'c', 'd', 'e', 'U')) OR (level = 'A' AND grade IN ('A*', 'A', 'B', 'C', 'D', 'E', 'U'))),
  CONSTRAINT cambridge_results_one_per_series UNIQUE (student_id, syllabus_code, level, series_year, series_month)
);
CREATE INDEX IF NOT EXISTS idx_cambridge_results_student ON public.cambridge_results (student_id) WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS public.cambridge_grade_thresholds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  syllabus_code text NOT NULL CHECK (syllabus_code ~ '^[0-9]{4}$'),
  series_year integer NOT NULL CHECK (series_year BETWEEN 2000 AND 2100),
  series_month integer NOT NULL CHECK (series_month IN (3, 6, 11)),
  level text NOT NULL CHECK (level IN ('AS', 'A')),
  option_code text NOT NULL CHECK (length(option_code) BETWEEN 1 AND 20),
  grade text NOT NULL,
  min_mark numeric NOT NULL CHECK (min_mark >= 0),
  max_total numeric NOT NULL CHECK (max_total > 0),
  source_url text NOT NULL CHECK (source_url LIKE 'https://www.cambridgeinternational.org/%'),
  retrieved_at timestamptz NOT NULL,
  CONSTRAINT cambridge_grade_thresholds_grade_check CHECK ((level = 'AS' AND grade IN ('a', 'b', 'c', 'd', 'e')) OR (level = 'A' AND grade IN ('A*', 'A', 'B', 'C', 'D', 'E'))),
  CONSTRAINT cambridge_grade_thresholds_mark CHECK (min_mark <= max_total),
  CONSTRAINT cambridge_grade_thresholds_unique UNIQUE (syllabus_code, series_year, series_month, level, option_code, grade)
);

CREATE TABLE IF NOT EXISTS public.exam_gap_concept_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id),
  canonical_concept_id uuid NOT NULL REFERENCES public.canonical_concepts(id),
  student_concept_id uuid NOT NULL REFERENCES public.concepts(id),
  learning_objective_id uuid NOT NULL REFERENCES public.learning_objectives(id),
  exam_attempt_id uuid REFERENCES public.exam_attempts(id),
  source text NOT NULL DEFAULT 'EXAM_GAP' CHECK (source = 'EXAM_GAP'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exam_gap_concept_links_one_per_concept UNIQUE (student_id, canonical_concept_id)
);
