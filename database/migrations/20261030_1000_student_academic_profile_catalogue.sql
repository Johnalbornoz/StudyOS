-- Student Academic Profile -> canonical curriculum catalogue (Phase A).
--
-- Additive: new nullable columns + one new table + a governed fill of NULL
-- programme grade ranges. Nothing is dropped, no existing value is changed.
-- Never applied automatically -- governed runner only (DEV first, then
-- Preview; this release never targets Production).
--
--   student_academic_profile  + curriculum_scope (NATIONAL | INTERNATIONAL),
--                             academic_programme_id, academic_qualification_id
--                             (catalogue identity -- the authority is the
--                             programme's organisation, never duplicated),
--                             grade_level (normalised years of schooling, US
--                             scale) and curriculum_selected_at. The legacy
--                             columns (country_of_study, school_year,
--                             curriculum_type, ib_*) stay and stay filled.
--   student_academic_subjects the academic subjects the Student follows in
--                             that programme. A change ENDS rows (ended_at),
--                             never deletes them; learner state, attempts,
--                             results and evidence are never touched.
--   academic_programmes       + grade_min / grade_max: the stage a curriculum
--                             programme serves, so a Student is offered only
--                             compatible programmes (NULL = unknown = offered).
--                             Filled below for the catalogued CURRICULUM
--                             programmes, by exact name, NULLs only.
--
-- Rollback (only if nothing depends on it yet):
--   DROP TABLE IF EXISTS public.student_academic_subjects;
--   ALTER TABLE public.student_academic_profile DROP COLUMN IF EXISTS curriculum_selected_at, DROP COLUMN IF EXISTS grade_level,
--     DROP COLUMN IF EXISTS academic_qualification_id, DROP COLUMN IF EXISTS academic_programme_id, DROP COLUMN IF EXISTS curriculum_scope;
--   ALTER TABLE public.academic_programmes DROP COLUMN IF EXISTS grade_max, DROP COLUMN IF EXISTS grade_min;

ALTER TABLE public.student_academic_profile
  ADD COLUMN IF NOT EXISTS curriculum_scope text,
  ADD COLUMN IF NOT EXISTS academic_programme_id uuid REFERENCES public.academic_programmes(id),
  ADD COLUMN IF NOT EXISTS academic_qualification_id uuid REFERENCES public.academic_qualifications(id),
  ADD COLUMN IF NOT EXISTS grade_level smallint,
  ADD COLUMN IF NOT EXISTS curriculum_selected_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_academic_profile_curriculum_scope_check') THEN
    ALTER TABLE public.student_academic_profile
      ADD CONSTRAINT student_academic_profile_curriculum_scope_check CHECK (curriculum_scope IS NULL OR curriculum_scope IN ('NATIONAL', 'INTERNATIONAL'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_academic_profile_grade_level_check') THEN
    ALTER TABLE public.student_academic_profile
      ADD CONSTRAINT student_academic_profile_grade_level_check CHECK (grade_level IS NULL OR grade_level BETWEEN 1 AND 13);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_academic_profile_qualification_needs_programme') THEN
    ALTER TABLE public.student_academic_profile
      ADD CONSTRAINT student_academic_profile_qualification_needs_programme CHECK (academic_qualification_id IS NULL OR academic_programme_id IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_student_academic_profile_programme ON public.student_academic_profile (academic_programme_id) WHERE academic_programme_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.student_academic_subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id),
  academic_subject_id uuid NOT NULL REFERENCES public.academic_subjects(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);

-- One current selection of a subject per Student; ended rows are history.
CREATE UNIQUE INDEX IF NOT EXISTS uq_student_academic_subjects_current
  ON public.student_academic_subjects (student_id, academic_subject_id) WHERE ended_at IS NULL;

COMMENT ON TABLE public.student_academic_subjects IS
  'Academic subjects a Student follows in their Academic Profile programme. Changes end rows (ended_at), never delete them.';

ALTER TABLE public.academic_programmes
  ADD COLUMN IF NOT EXISTS grade_min smallint,
  ADD COLUMN IF NOT EXISTS grade_max smallint;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'academic_programmes_grade_range_check') THEN
    ALTER TABLE public.academic_programmes
      ADD CONSTRAINT academic_programmes_grade_range_check CHECK (
        (grade_min IS NULL OR grade_min BETWEEN 1 AND 13) AND (grade_max IS NULL OR grade_max BETWEEN 1 AND 13)
        AND (grade_min IS NULL OR grade_max IS NULL OR grade_min <= grade_max));
  END IF;
END $$;

-- Governed stage ranges (years of schooling, US scale) of the catalogued curriculum
-- programmes. Exact names only; existing values are never overwritten.
--   IB Diploma Programme             DP1-DP2                          -> 11-12
--   Cambridge IGCSE / Upper Secondary  IGCSE, ages 14-16              -> 9-10
--   Cambridge Advanced / AICE Diploma  AS & A Level, ages 16-19       -> 11-12
--   SEP Primaria / Secundaria / MCCEMS  1.º-6.º / 1.º-3.º / Bachillerato -> 1-6 / 7-9 / 10-12
--   MEN Estándares Básicos y DBA     grados 1.º-11.º                  -> 1-11
--   Educación Básica Secundaria (6.º-9.º) / Educación Media (10.º-11.º) -> 6-9 / 10-11
UPDATE public.academic_programmes p SET grade_min = v.gmin, grade_max = v.gmax
  FROM (VALUES
    ('IB Diploma Programme', 11, 12),
    ('Cambridge IGCSE', 9, 10),
    ('Cambridge Upper Secondary', 9, 10),
    ('Cambridge Advanced', 11, 12),
    ('Cambridge AICE Diploma', 11, 12),
    ('Educación Primaria — Plan de Estudio 2022', 1, 6),
    ('Educación Secundaria — Plan de Estudio 2022', 7, 9),
    ('Educación Media Superior — Marco Curricular Común (MCCEMS)', 10, 12),
    ('Estándares Básicos de Competencias y DBA', 1, 11),
    ('Educación Básica Secundaria (6.º–9.º)', 6, 9),
    ('Educación Media (10.º–11.º)', 10, 11)
  ) AS v(name, gmin, gmax)
 WHERE p.name = v.name AND p.programme_type = 'CURRICULUM' AND p.grade_min IS NULL AND p.grade_max IS NULL;
