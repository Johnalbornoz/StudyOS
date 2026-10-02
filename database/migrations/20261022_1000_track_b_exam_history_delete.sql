-- Track B -- Exam history delete (DEV).
--
-- Strictly additive. Never applied automatically -- governed runner only.
--
-- An attempt that predates Exam V2 instances (no exam_instances row) can now be
-- removed from the Student's visible history. It is a soft hide: the attempt,
-- its responses, its result and any consolidated learning evidence stay as
-- they are (an in-progress attempt is first ABANDONED, exactly as a deleted
-- V2 instance does). Attempts that belong to an exam instance keep using the
-- instance's own DELETED status.
--
-- Rollback (DEV only, manual):
--   DROP INDEX IF EXISTS public.idx_simulation_attempts_profile_visible;
--   ALTER TABLE public.simulation_attempts DROP CONSTRAINT IF EXISTS simulation_attempts_hidden_reason_check;
--   ALTER TABLE public.simulation_attempts DROP COLUMN IF EXISTS hidden_reason;
--   ALTER TABLE public.simulation_attempts DROP COLUMN IF EXISTS hidden_at;
--   DELETE FROM public.schema_migrations WHERE version = '20261022_1000';
-- ---------------------------------------------------------------------

ALTER TABLE public.simulation_attempts ADD COLUMN IF NOT EXISTS hidden_at timestamptz;
ALTER TABLE public.simulation_attempts ADD COLUMN IF NOT EXISTS hidden_reason text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'simulation_attempts_hidden_reason_check') THEN
    ALTER TABLE public.simulation_attempts ADD CONSTRAINT simulation_attempts_hidden_reason_check
      CHECK ((hidden_at IS NULL AND hidden_reason IS NULL) OR (hidden_at IS NOT NULL AND hidden_reason IS NOT NULL AND length(hidden_reason) <= 200));
  END IF;
END $$;

-- The Exam Prep history reads visible attempts per profile, newest first.
CREATE INDEX IF NOT EXISTS idx_simulation_attempts_profile_visible ON public.simulation_attempts (exam_profile_id, created_at DESC) WHERE hidden_at IS NULL;
