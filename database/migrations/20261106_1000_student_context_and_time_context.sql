-- REM-T1-02 / REM-T1-03 -- Student context type + structured time context (ADDITIVE ONLY).
--
-- 1. students.student_context_type -- what best describes the Student's CURRENT situation:
--      'ACADEMIC'  : currently studying in a school / formal academic programme (academic profiling path);
--      'EXAM_PREP' : the primary StudyUs context is preparing for an exam (the exam itself is the context;
--                    no school / grade / national curriculum is required).
--    NULL = not chosen yet. This is NOT a role: the primary role stays STUDENT in both cases, and class /
--    institution memberships are unaffected (they keep governing their own class experience).
--    Both contexts keep Learn, practice, reinforcement, Exam Prep and progress.
--
--    Backfill (no profile, preparation, class membership or history is modified or erased):
--      - a COMPLETED academic profile -> 'ACADEMIC' (existing Students keep behaving as Academic Students
--        and are never sent through the choice again);
--      - otherwise, a non-archived exam target (the J0 independent exam student) -> 'EXAM_PREP';
--      - everyone else stays NULL and is asked once, while their onboarding is still incomplete.
--
-- 2. student_academic_profile -- the final profile step stores a STRUCTURED, controlled time context:
--      academic_year_start / academic_year_end : a school year (2026-2027, or 2026 for calendar-year systems);
--      exam_series / exam_year                 : an examination session (IB May 2027, Cambridge Oct/Nov 2027).
--    The legacy free-text `academic_year` column is kept and still written (canonical display string), so
--    every existing reader keeps working and previously saved values stay readable. No value is rewritten.
--
-- Rollback (data in the new columns is lost; nothing else is affected):
--   ALTER TABLE public.student_academic_profile DROP CONSTRAINT IF EXISTS student_academic_profile_time_context_shape_check;
--   ALTER TABLE public.student_academic_profile DROP COLUMN IF EXISTS exam_year, DROP COLUMN IF EXISTS exam_series,
--     DROP COLUMN IF EXISTS academic_year_end, DROP COLUMN IF EXISTS academic_year_start;
--   ALTER TABLE public.students DROP COLUMN IF EXISTS student_context_selected_at, DROP COLUMN IF EXISTS student_context_type;
--   DELETE FROM schema_migrations WHERE version = '20261106_1000';

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS student_context_type text
    CHECK (student_context_type IS NULL OR student_context_type IN ('ACADEMIC', 'EXAM_PREP')),
  ADD COLUMN IF NOT EXISTS student_context_selected_at timestamptz;

UPDATE public.students s
   SET student_context_type = 'ACADEMIC'
 WHERE s.student_context_type IS NULL
   AND EXISTS (SELECT 1 FROM public.student_academic_profile p WHERE p.student_id = s.id AND p.profile_completed = true);

UPDATE public.students s
   SET student_context_type = 'EXAM_PREP'
 WHERE s.student_context_type IS NULL
   AND EXISTS (SELECT 1 FROM public.student_exam_profiles ep WHERE ep.student_id = s.id AND ep.status <> 'ARCHIVED');

ALTER TABLE public.student_academic_profile
  ADD COLUMN IF NOT EXISTS academic_year_start smallint CHECK (academic_year_start IS NULL OR academic_year_start BETWEEN 2000 AND 2100),
  ADD COLUMN IF NOT EXISTS academic_year_end smallint CHECK (academic_year_end IS NULL OR academic_year_end BETWEEN 2000 AND 2100),
  ADD COLUMN IF NOT EXISTS exam_series text CHECK (exam_series IS NULL OR exam_series IN ('MAY', 'NOVEMBER', 'FEB_MARCH', 'MAY_JUNE', 'OCT_NOV')),
  ADD COLUMN IF NOT EXISTS exam_year smallint CHECK (exam_year IS NULL OR exam_year BETWEEN 2000 AND 2100);

-- One shape at a time: either a school year, an exam session, or nothing (legacy rows keep only the text).
ALTER TABLE public.student_academic_profile
  ADD CONSTRAINT student_academic_profile_time_context_shape_check CHECK (
    (academic_year_start IS NULL AND academic_year_end IS NULL AND exam_series IS NULL AND exam_year IS NULL)
    OR (academic_year_start IS NOT NULL AND academic_year_end IS NOT NULL AND academic_year_end >= academic_year_start
        AND academic_year_end - academic_year_start <= 1 AND exam_series IS NULL AND exam_year IS NULL)
    OR (exam_series IS NOT NULL AND exam_year IS NOT NULL AND academic_year_start IS NULL AND academic_year_end IS NULL)
  );
