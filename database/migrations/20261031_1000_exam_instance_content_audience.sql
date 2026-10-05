-- QB-0 -- content audience of an exam instance (additive, non-destructive).
--
-- STUDENT (default): the instance draws real content only; DEV fixtures never qualify.
-- TECHNICAL_DEMO: an in-process engine demo / certification scenario may run on fixtures.
-- No Student route writes TECHNICAL_DEMO; every existing row is a Student instance.
--
-- Rollback:
--   ALTER TABLE public.exam_instances DROP CONSTRAINT IF EXISTS exam_instances_content_audience_check;
--   ALTER TABLE public.exam_instances DROP COLUMN IF EXISTS content_audience;

ALTER TABLE public.exam_instances ADD COLUMN IF NOT EXISTS content_audience text NOT NULL DEFAULT 'STUDENT';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exam_instances_content_audience_check') THEN
    ALTER TABLE public.exam_instances ADD CONSTRAINT exam_instances_content_audience_check
      CHECK (content_audience IN ('STUDENT', 'TECHNICAL_DEMO'));
  END IF;
END $$;
