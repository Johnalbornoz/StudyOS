-- L10 SF-12 (2/5 of the L10 schema batch) -- Institution -> Student as a
-- first-class membership. Findings: L3 P1-8 (carrier part), L3 F-02.
--
-- Until now "this learner belongs to this institution" existed only as a
-- derivation: some ACTIVE class_enrollments row in some class of that
-- institution. Nothing could attach to the relationship itself -- in
-- particular a sponsored licence seat (EN-1, next file).
--
-- institution_student_memberships is that carrier: one row per
-- (institution, learner), ACTIVE while the learner holds at least one ACTIVE
-- enrolment in a class of the institution, ENDED otherwise.
--
-- It is DERIVED, and kept derived by the database: a trigger on
-- class_enrollments re-evaluates the pair on every insert, status change or
-- delete. No application code writes this table, so no enrolment writer
-- (present or future, in any lane) can leave it out of step, and it can
-- never grant anything an enrolment does not:
--   - enrolling (enrolment becomes ACTIVE)      -> membership ACTIVE
--   - the LAST active enrolment ends            -> membership ENDED
--   - a PENDING or DECLINED enrolment           -> no membership (consent
--     has not been given; same rule every authorization check already uses)
--   - one learner, two institutions             -> two independent rows;
--     a row never spans institutions (the institution is the class's own).
--
-- The membership follows the ENROLMENT only. Institution or class status
-- (suspended, archived) is not copied into it: those are read live by the
-- guards, as before.
--
-- Backfill: one ACTIVE row for every (institution, learner) pair that has an
-- ACTIVE enrolment today. Nothing else is created.
--
-- Rollback (run in one transaction):
--   DROP TRIGGER IF EXISTS trg_class_enrollments_sync_institution_membership ON public.class_enrollments;
--   DROP FUNCTION IF EXISTS public.class_enrollments_sync_institution_membership();
--   DROP FUNCTION IF EXISTS public.sync_institution_student_membership(uuid, uuid);
--   DROP TABLE IF EXISTS public.institution_student_memberships;
--   DELETE FROM schema_migrations WHERE version = '20261120_1100';
--   (apply the rollback of 20261120_1200 first: its seats reference this table)

CREATE TABLE IF NOT EXISTS public.institution_student_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES public.institutions(id),
  student_id uuid NOT NULL REFERENCES public.students(id),
  status text NOT NULL DEFAULT 'ACTIVE',
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT institution_student_memberships_status_check CHECK (status IN ('ACTIVE', 'ENDED')),
  CONSTRAINT institution_student_memberships_unique UNIQUE (institution_id, student_id),
  CONSTRAINT institution_student_memberships_ended_consistent CHECK (
    (status = 'ACTIVE' AND ended_at IS NULL) OR (status = 'ENDED' AND ended_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_institution_student_memberships_student
  ON public.institution_student_memberships (student_id) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_institution_student_memberships_institution
  ON public.institution_student_memberships (institution_id) WHERE status = 'ACTIVE';

COMMENT ON TABLE public.institution_student_memberships IS
  'L10 SF-12: derived carrier of the Institution -> Student relationship. Maintained only by the class_enrollments trigger; never written by application code.';

-- Re-evaluates ONE (institution, learner) pair from its enrolments.
CREATE OR REPLACE FUNCTION public.sync_institution_student_membership(p_institution_id uuid, p_student_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  has_active boolean;
BEGIN
  IF p_institution_id IS NULL OR p_student_id IS NULL THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.class_enrollments ce
    JOIN public.classes c ON c.id = ce.class_id
    WHERE c.institution_id = p_institution_id AND ce.student_id = p_student_id AND ce.status = 'ACTIVE'
  ) INTO has_active;

  IF has_active THEN
    INSERT INTO public.institution_student_memberships (institution_id, student_id, status, started_at, ended_at)
    VALUES (p_institution_id, p_student_id, 'ACTIVE', now(), NULL)
    ON CONFLICT (institution_id, student_id) DO UPDATE
      SET status = 'ACTIVE', started_at = now(), ended_at = NULL, updated_at = now()
      WHERE public.institution_student_memberships.status <> 'ACTIVE';
  ELSE
    UPDATE public.institution_student_memberships
       SET status = 'ENDED', ended_at = now(), updated_at = now()
     WHERE institution_id = p_institution_id AND student_id = p_student_id AND status = 'ACTIVE';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.class_enrollments_sync_institution_membership()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_institution uuid;
  new_institution uuid;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT c.institution_id INTO old_institution FROM public.classes c WHERE c.id = OLD.class_id;
    PERFORM public.sync_institution_student_membership(old_institution, OLD.student_id);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT c.institution_id INTO new_institution FROM public.classes c WHERE c.id = NEW.class_id;
    IF TG_OP = 'INSERT' OR new_institution IS DISTINCT FROM old_institution OR NEW.student_id IS DISTINCT FROM OLD.student_id THEN
      PERFORM public.sync_institution_student_membership(new_institution, NEW.student_id);
    END IF;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_class_enrollments_sync_institution_membership ON public.class_enrollments;
CREATE TRIGGER trg_class_enrollments_sync_institution_membership
  AFTER INSERT OR DELETE OR UPDATE OF status, class_id, student_id ON public.class_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.class_enrollments_sync_institution_membership();

-- Backfill from today's ACTIVE enrolments (idempotent).
INSERT INTO public.institution_student_memberships (institution_id, student_id, status, started_at)
SELECT c.institution_id, ce.student_id, 'ACTIVE', MIN(ce.created_at)
FROM public.class_enrollments ce
JOIN public.classes c ON c.id = ce.class_id
WHERE ce.status = 'ACTIVE'
GROUP BY c.institution_id, ce.student_id
ON CONFLICT (institution_id, student_id) DO NOTHING;
