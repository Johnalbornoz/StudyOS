-- L10 schema batch (2/3, Orchestrator change request CR-L9-02) --
-- a closed class enrolment is history, never reopened. Closes L4-18.
--
-- Ruling (Orchestrator, 2026-10-11): an ENDED or DECLINED enrolment must
-- never be reactivated in place. A coordinator may start a NEW enrolment or
-- invitation; it follows the canonical lifecycle (PENDING until the Student
-- accepts, where acceptance is required) and the old row stays exactly as it
-- ended -- the departure or the refusal is not rewritten.
--
-- Two things stood in the way:
--
-- 1. class_enrollments_unique UNIQUE (class_id, student_id) allowed only ONE
--    row per learner per class, ever. Re-adding a learner could only be done
--    by overwriting the closed row. It is replaced by a partial unique index:
--    at most one OPEN row (PENDING or ACTIVE) per learner per class, and any
--    number of closed rows (ENDED, DECLINED) beside it as history.
--
-- 2. Nothing stopped a writer from flipping a closed row back to ACTIVE
--    (the single-add path did exactly that). A trigger now refuses any
--    status change on a row that is ENDED or DECLINED, whoever writes it:
--    CLASS_ENROLLMENT_CLOSED_ROW_IS_HISTORY.
--
-- No row changes. Every existing (class, learner) pair has exactly one row,
-- so the new index is satisfied by construction.
--
-- Effect on SQL that named the old constraint: `ON CONFLICT (class_id,
-- student_id)` no longer has a constraint to infer and fails. The
-- application's writers and the Track A fixture scripts were changed in the
-- same commit to not depend on it.
--
-- Rollback (only possible while no learner has two rows for one class):
--   DROP TRIGGER IF EXISTS trg_class_enrollments_closed_row_guard ON public.class_enrollments;
--   DROP FUNCTION IF EXISTS public.class_enrollments_closed_row_guard();
--   DROP INDEX IF EXISTS public.uq_class_enrollments_one_open;
--   DROP INDEX IF EXISTS public.idx_class_enrollments_class_student;
--   ALTER TABLE public.class_enrollments ADD CONSTRAINT class_enrollments_unique UNIQUE (class_id, student_id);
--   DELETE FROM schema_migrations WHERE version = '20261120_1100';

ALTER TABLE public.class_enrollments DROP CONSTRAINT IF EXISTS class_enrollments_unique;

CREATE UNIQUE INDEX IF NOT EXISTS uq_class_enrollments_one_open
  ON public.class_enrollments (class_id, student_id)
  WHERE status IN ('PENDING', 'ACTIVE');

CREATE INDEX IF NOT EXISTS idx_class_enrollments_class_student
  ON public.class_enrollments (class_id, student_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.class_enrollments_closed_row_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('ENDED', 'DECLINED') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'CLASS_ENROLLMENT_CLOSED_ROW_IS_HISTORY: enrolment % is % and cannot become %; start a new enrolment instead', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_class_enrollments_closed_row_guard ON public.class_enrollments;
CREATE TRIGGER trg_class_enrollments_closed_row_guard
  BEFORE UPDATE OF status ON public.class_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.class_enrollments_closed_row_guard();
