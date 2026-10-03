-- Track B -- Exam Prep profile remove / restart (DEV).
--
-- Strictly additive. Never applied automatically -- governed runner only.
--
-- "Quitar de mi preparación" archives the Student's exam preparation profile
-- (status ARCHIVED already exists since F7). It never deletes exam
-- definitions, banks, curriculum, results, responses, scoring audit, learning
-- evidence or learner state. "Empezar de nuevo" archives it and links the new,
-- clean profile that replaces it (replaced_by_profile_id), which also makes a
-- repeated restart idempotent.
--
-- At most ONE non-archived profile per Student and exam definition: a double
-- click or a retry can never create two active preparations for the same exam.
-- The migration refuses (with a clear message) if duplicates already exist, so
-- they are resolved deliberately instead of silently.
--
-- Rollback (DEV only, manual):
--   DROP INDEX IF EXISTS public.uq_student_exam_profiles_one_active;
--   ALTER TABLE public.student_exam_profiles DROP CONSTRAINT IF EXISTS student_exam_profiles_archived_check;
--   ALTER TABLE public.student_exam_profiles DROP COLUMN IF EXISTS replaced_by_profile_id;
--   ALTER TABLE public.student_exam_profiles DROP COLUMN IF EXISTS archive_reason;
--   ALTER TABLE public.student_exam_profiles DROP COLUMN IF EXISTS archived_at;
--   DELETE FROM public.schema_migrations WHERE version = '20261023_1000';
-- ---------------------------------------------------------------------

ALTER TABLE public.student_exam_profiles ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.student_exam_profiles ADD COLUMN IF NOT EXISTS archive_reason text;
ALTER TABLE public.student_exam_profiles ADD COLUMN IF NOT EXISTS replaced_by_profile_id uuid REFERENCES public.student_exam_profiles(id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_exam_profiles_archived_check') THEN
    ALTER TABLE public.student_exam_profiles ADD CONSTRAINT student_exam_profiles_archived_check
      CHECK ((archived_at IS NULL OR status = 'ARCHIVED')
         AND (archive_reason IS NULL OR length(archive_reason) <= 200)
         AND (replaced_by_profile_id IS NULL OR (status = 'ARCHIVED' AND replaced_by_profile_id <> id)));
  END IF;
END $$;

DO $$
DECLARE dup integer;
BEGIN
  SELECT count(*) INTO dup FROM (
    SELECT 1 FROM public.student_exam_profiles WHERE status <> 'ARCHIVED' GROUP BY student_id, exam_definition_id HAVING count(*) > 1
  ) d;
  IF dup > 0 THEN
    RAISE EXCEPTION 'student_exam_profiles: % Student/exam pairs have more than one non-archived profile; resolve them before applying 20261023_1000', dup;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_student_exam_profiles_one_active
  ON public.student_exam_profiles (student_id, exam_definition_id) WHERE status <> 'ARCHIVED';
