-- REM-T1-03 correction -- canonical awarding-body examination series (ADDITIVE / WIDENING ONLY).
--
-- student_academic_profile.exam_series now stores the awarding body's OWN series identifiers:
--   IB        : MAY, NOVEMBER
--   Cambridge : MARCH, JUNE, NOVEMBER
-- The identifiers accepted by 20261106_1000 for Cambridge (FEB_MARCH, MAY_JUNE, OCT_NOV) were calendar
-- windows, not series names. They remain VALID here (legacy rows stay readable and are never rewritten;
-- the application reads them as MARCH / JUNE / NOVEMBER via LEGACY_SERIES_ALIASES) but the application
-- no longer writes them. The CHECK is only widened: no existing row can be invalidated.
--
-- 20261106_1000 is already applied (DEV) and immutable; this is the correction migration that follows it.
--
-- Rollback (only while no row stores MARCH / JUNE):
--   ALTER TABLE public.student_academic_profile DROP CONSTRAINT IF EXISTS student_academic_profile_exam_series_check;
--   ALTER TABLE public.student_academic_profile ADD CONSTRAINT student_academic_profile_exam_series_check
--     CHECK (exam_series IS NULL OR exam_series IN ('MAY', 'NOVEMBER', 'FEB_MARCH', 'MAY_JUNE', 'OCT_NOV'));
--   DELETE FROM schema_migrations WHERE version = '20261106_1100';

ALTER TABLE public.student_academic_profile DROP CONSTRAINT IF EXISTS student_academic_profile_exam_series_check;
ALTER TABLE public.student_academic_profile ADD CONSTRAINT student_academic_profile_exam_series_check
  CHECK (exam_series IS NULL OR exam_series IN ('MAY', 'NOVEMBER', 'MARCH', 'JUNE', 'FEB_MARCH', 'MAY_JUNE', 'OCT_NOV'));
