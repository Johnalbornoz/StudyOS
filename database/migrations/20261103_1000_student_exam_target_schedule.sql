-- Student Exam Journey -- J3.1 / J3.2: Exam Target schedule (official session vs personal date).
--
-- Additive only: new NULLABLE columns (and one defaulted jsonb) on
-- student_exam_profiles, plus CHECK constraints that apply to the new columns
-- only. Nothing is dropped or renamed, no existing column changes meaning, and
-- nothing is backfilled: `exam_date` keeps its meaning (the exam date as the
-- Student typed it) and stays the only date of every existing row.
-- Never applied automatically -- governed runner only (DEV first, then Preview;
-- this release never targets Production).
--
-- Why (no equivalent exists): `exam_date` is a single unsourced date;
-- exam_versions.exam_session is per VERSION, not per Student target;
-- preparation_goals holds target results, not dates; class_exam_assignments
-- has no session. The approved priority (official session > authoritative date
-- > personal target date > estimated month > UNKNOWN) needs each value apart,
-- with its source, so a personal date can never be read as an official one.
--
--   official_session_key               Blueprint ExamSessionV2.sessionKey (a REFERENCE; the session
--                                      catalogue is not persisted yet, so no FK and no copied label/dates)
--   official_session_source            INSTITUTION_ASSIGNED | STUDENT_SELECTED (both-or-neither with the key)
--   authoritative_exam_date            a sitting date from an authoritative source ...
--   authoritative_exam_date_provenance ... OFFICIAL_PUBLIC | OFFICIAL_LICENSED | INSTITUTION_SUPPLIED (both-or-neither)
--   personal_target_date               the Student's own planning deadline (never official)
--   estimated_exam_month               the Student's estimate, month precision only (YYYY-MM; never a day)
--   field_provenance                   per-field provenance of the target ({} = legacy row)
--
-- Rollback (only if nothing depends on it yet):
--   ALTER TABLE public.student_exam_profiles
--     DROP CONSTRAINT IF EXISTS student_exam_profiles_session_pair_check,
--     DROP CONSTRAINT IF EXISTS student_exam_profiles_session_source_check,
--     DROP CONSTRAINT IF EXISTS student_exam_profiles_session_key_format_check,
--     DROP CONSTRAINT IF EXISTS student_exam_profiles_authoritative_date_pair_check,
--     DROP CONSTRAINT IF EXISTS student_exam_profiles_authoritative_date_provenance_check,
--     DROP CONSTRAINT IF EXISTS student_exam_profiles_estimated_month_format_check,
--     DROP CONSTRAINT IF EXISTS student_exam_profiles_field_provenance_object_check,
--     DROP COLUMN IF EXISTS field_provenance, DROP COLUMN IF EXISTS estimated_exam_month,
--     DROP COLUMN IF EXISTS personal_target_date, DROP COLUMN IF EXISTS authoritative_exam_date_provenance,
--     DROP COLUMN IF EXISTS authoritative_exam_date, DROP COLUMN IF EXISTS official_session_source,
--     DROP COLUMN IF EXISTS official_session_key;

ALTER TABLE public.student_exam_profiles
  ADD COLUMN IF NOT EXISTS official_session_key text,
  ADD COLUMN IF NOT EXISTS official_session_source text,
  ADD COLUMN IF NOT EXISTS authoritative_exam_date date,
  ADD COLUMN IF NOT EXISTS authoritative_exam_date_provenance text,
  ADD COLUMN IF NOT EXISTS personal_target_date date,
  ADD COLUMN IF NOT EXISTS estimated_exam_month text,
  ADD COLUMN IF NOT EXISTS field_provenance jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_exam_profiles_session_pair_check') THEN
    ALTER TABLE public.student_exam_profiles ADD CONSTRAINT student_exam_profiles_session_pair_check
      CHECK ((official_session_key IS NULL) = (official_session_source IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_exam_profiles_session_source_check') THEN
    ALTER TABLE public.student_exam_profiles ADD CONSTRAINT student_exam_profiles_session_source_check
      CHECK (official_session_source IS NULL OR official_session_source IN ('INSTITUTION_ASSIGNED', 'STUDENT_SELECTED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_exam_profiles_session_key_format_check') THEN
    ALTER TABLE public.student_exam_profiles ADD CONSTRAINT student_exam_profiles_session_key_format_check
      CHECK (official_session_key IS NULL OR char_length(official_session_key) BETWEEN 1 AND 80);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_exam_profiles_authoritative_date_pair_check') THEN
    ALTER TABLE public.student_exam_profiles ADD CONSTRAINT student_exam_profiles_authoritative_date_pair_check
      CHECK ((authoritative_exam_date IS NULL) = (authoritative_exam_date_provenance IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_exam_profiles_authoritative_date_provenance_check') THEN
    ALTER TABLE public.student_exam_profiles ADD CONSTRAINT student_exam_profiles_authoritative_date_provenance_check
      CHECK (authoritative_exam_date_provenance IS NULL OR authoritative_exam_date_provenance IN ('OFFICIAL_PUBLIC', 'OFFICIAL_LICENSED', 'INSTITUTION_SUPPLIED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_exam_profiles_estimated_month_format_check') THEN
    ALTER TABLE public.student_exam_profiles ADD CONSTRAINT student_exam_profiles_estimated_month_format_check
      CHECK (estimated_exam_month IS NULL OR estimated_exam_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_exam_profiles_field_provenance_object_check') THEN
    ALTER TABLE public.student_exam_profiles ADD CONSTRAINT student_exam_profiles_field_provenance_object_check
      CHECK (jsonb_typeof(field_provenance) = 'object');
  END IF;
END $$;
