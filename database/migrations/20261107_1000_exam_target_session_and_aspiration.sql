-- T1 final delta (C / D) -- Exam Preparation: canonical exam session + academic aspiration area.
--
-- Additive only: four NULLABLE columns on student_exam_profiles plus CHECK constraints that apply to
-- the new columns only. Nothing is dropped, renamed, backfilled or reinterpreted:
--   - `exam_date` keeps its meaning (a date the Student typed) and every existing row keeps it;
--   - `target_institution_name` / `target_qualification` are unchanged;
--   - `official_session_key` (Journey: a Blueprint ExamSessionV2 reference) is NOT reused -- a series the
--     Student intends to sit is not an official session record and must never be read as one.
--
--   target_exam_series        the awarding body's series the Student aims for, CANONICAL identifiers only
--                             (programme-sessions.ts: MAY | NOVEMBER | MARCH | JUNE). Availability per
--                             programme / syllabus / region / year is governed in code (availableSeries);
--                             the CHECK only guards the identifier set.
--   target_exam_year          the year of that series (both-or-neither with the series)
--   interest_area             academic / professional area of interest: a stable canonical ID
--                             (src/lib/student/interest-areas.ts), never a translated label
--   interest_area_detail      optional free text, only with interest_area = 'OTHER'
--
-- Why a migration (no reusable field): exam_date is a day, not a series; estimated_exam_month is the
-- Student's month estimate (YYYY-MM), not a governed series; target_qualification is free text and
-- cannot hold a canonical taxonomy ID.
--
-- Never applied automatically -- governed runner only (DEV first; Stage / Production by their own release).
--
-- Rollback (only if nothing depends on it yet):
--   ALTER TABLE public.student_exam_profiles
--     DROP CONSTRAINT IF EXISTS student_exam_profiles_target_session_pair_check,
--     DROP CONSTRAINT IF EXISTS student_exam_profiles_target_series_check,
--     DROP CONSTRAINT IF EXISTS student_exam_profiles_target_year_check,
--     DROP CONSTRAINT IF EXISTS student_exam_profiles_interest_area_format_check,
--     DROP CONSTRAINT IF EXISTS student_exam_profiles_interest_area_detail_check,
--     DROP COLUMN IF EXISTS interest_area_detail, DROP COLUMN IF EXISTS interest_area,
--     DROP COLUMN IF EXISTS target_exam_year, DROP COLUMN IF EXISTS target_exam_series;

ALTER TABLE public.student_exam_profiles
  ADD COLUMN IF NOT EXISTS target_exam_series text,
  ADD COLUMN IF NOT EXISTS target_exam_year integer,
  ADD COLUMN IF NOT EXISTS interest_area text,
  ADD COLUMN IF NOT EXISTS interest_area_detail text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_exam_profiles_target_session_pair_check') THEN
    ALTER TABLE public.student_exam_profiles ADD CONSTRAINT student_exam_profiles_target_session_pair_check
      CHECK ((target_exam_series IS NULL) = (target_exam_year IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_exam_profiles_target_series_check') THEN
    ALTER TABLE public.student_exam_profiles ADD CONSTRAINT student_exam_profiles_target_series_check
      CHECK (target_exam_series IS NULL OR target_exam_series IN ('MAY', 'NOVEMBER', 'MARCH', 'JUNE'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_exam_profiles_target_year_check') THEN
    ALTER TABLE public.student_exam_profiles ADD CONSTRAINT student_exam_profiles_target_year_check
      CHECK (target_exam_year IS NULL OR target_exam_year BETWEEN 2000 AND 2100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_exam_profiles_interest_area_format_check') THEN
    ALTER TABLE public.student_exam_profiles ADD CONSTRAINT student_exam_profiles_interest_area_format_check
      CHECK (interest_area IS NULL OR interest_area ~ '^[A-Z][A-Z_]{1,59}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_exam_profiles_interest_area_detail_check') THEN
    ALTER TABLE public.student_exam_profiles ADD CONSTRAINT student_exam_profiles_interest_area_detail_check
      CHECK (interest_area_detail IS NULL OR (interest_area = 'OTHER' AND char_length(interest_area_detail) BETWEEN 1 AND 200));
  END IF;
END $$;
