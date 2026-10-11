-- L10 schema batch (3/5) -- institution licence and seats: the STRUCTURE
-- EN-1 (L11_ENTITLEMENTS) needs. Findings: L3 P1-8, CR-03 (sponsorship).
--
-- Authored by L10 because L10 is the only migration author. It carries NO
-- entitlement decision: nothing here is read by `decideLearningAccess` or
-- any other code yet, and creating these tables licenses nobody. Resolving a
-- seat into LEARNING_FULL_ACCESS is L11's work (EN-1).
--
-- STATUS OF THE SPEC: L11 had not delivered a schema spec when this was
-- written, and decision D-2 (seat model vs per-student admin grants) was not
-- ruled. This is the smallest structure that satisfies the EN-1 acceptance
-- test in L3R1 ("a student enrolled in a licensed institution has access
-- with no individual grant; seat N+1 is refused; ending enrolment removes
-- access on the next request"). L11 reviews it before building on it; a
-- change comes back to L10 as a follow-up migration.
--
-- institution_licenses       one sponsored licence of an institution: a seat
--                            count and a validity window. At most one ACTIVE
--                            licence per institution.
-- institution_license_seats  one learner occupying one seat. A seat hangs
--                            off the learner's institution membership
--                            (SF-12), so it cannot outlive the relationship.
--
-- Enforced in the database, so no writer can get them wrong:
--   - seat N+1 is refused: assigning a seat beyond seat_limit raises
--     INSTITUTION_LICENSE_SEATS_EXHAUSTED (the licence row is locked while
--     counting, so two concurrent assignments cannot both take the last seat);
--   - a seat can only be assigned to an ACTIVE membership of the SAME
--     institution as the licence;
--   - one ASSIGNED seat per learner per licence;
--   - when a membership ENDS (the learner's last enrolment in the
--     institution ended) its ASSIGNED seats are RELEASED in the same
--     transaction -- access derived from the seat ends with it.
--
-- Rollback (run in one transaction):
--   DROP TRIGGER IF EXISTS trg_institution_membership_release_seats ON public.institution_student_memberships;
--   DROP FUNCTION IF EXISTS public.institution_membership_release_seats();
--   DROP TRIGGER IF EXISTS trg_institution_license_seats_guard ON public.institution_license_seats;
--   DROP FUNCTION IF EXISTS public.institution_license_seats_guard();
--   DROP TABLE IF EXISTS public.institution_license_seats;
--   DROP TABLE IF EXISTS public.institution_licenses;
--   DELETE FROM schema_migrations WHERE version = '20261120_1200';

CREATE TABLE IF NOT EXISTS public.institution_licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES public.institutions(id),
  seat_limit integer NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  source text NOT NULL DEFAULT 'ADMIN_GRANT',
  granted_by_user_id uuid REFERENCES public.users(id),
  grant_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT institution_licenses_seat_limit_positive CHECK (seat_limit > 0),
  CONSTRAINT institution_licenses_status_check CHECK (status IN ('ACTIVE', 'SUSPENDED', 'EXPIRED', 'CANCELLED')),
  CONSTRAINT institution_licenses_source_check CHECK (source IN ('ADMIN_GRANT', 'PAID')),
  CONSTRAINT institution_licenses_window_check CHECK (expires_at IS NULL OR expires_at > starts_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_institution_licenses_one_active
  ON public.institution_licenses (institution_id) WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS public.institution_license_seats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id uuid NOT NULL REFERENCES public.institution_licenses(id),
  membership_id uuid NOT NULL REFERENCES public.institution_student_memberships(id),
  student_id uuid NOT NULL REFERENCES public.students(id),
  status text NOT NULL DEFAULT 'ASSIGNED',
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by_user_id uuid REFERENCES public.users(id),
  released_at timestamptz,
  release_reason text,
  CONSTRAINT institution_license_seats_status_check CHECK (status IN ('ASSIGNED', 'RELEASED')),
  CONSTRAINT institution_license_seats_released_consistent CHECK (
    (status = 'ASSIGNED' AND released_at IS NULL) OR (status = 'RELEASED' AND released_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_institution_license_seats_one_per_student
  ON public.institution_license_seats (license_id, student_id) WHERE status = 'ASSIGNED';
CREATE INDEX IF NOT EXISTS idx_institution_license_seats_student
  ON public.institution_license_seats (student_id) WHERE status = 'ASSIGNED';
CREATE INDEX IF NOT EXISTS idx_institution_license_seats_membership
  ON public.institution_license_seats (membership_id) WHERE status = 'ASSIGNED';

COMMENT ON TABLE public.institution_licenses IS
  'L10 schema batch for EN-1: structure only. Entitlement resolution is owned by L11 (src/lib/entitlements).';

CREATE OR REPLACE FUNCTION public.institution_license_seats_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  lic record;
  mem record;
  used integer;
BEGIN
  IF NEW.status <> 'ASSIGNED' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'ASSIGNED' AND NEW.license_id = OLD.license_id
     AND NEW.membership_id = OLD.membership_id AND NEW.student_id = OLD.student_id THEN
    RETURN NEW;
  END IF;

  SELECT id, institution_id, seat_limit INTO lic FROM public.institution_licenses WHERE id = NEW.license_id FOR UPDATE;
  SELECT id, institution_id, student_id, status INTO mem FROM public.institution_student_memberships WHERE id = NEW.membership_id;

  IF mem.id IS NULL OR mem.institution_id <> lic.institution_id OR mem.student_id <> NEW.student_id THEN
    RAISE EXCEPTION 'INSTITUTION_LICENSE_SEAT_MEMBERSHIP_MISMATCH: the seat must belong to a membership of the licence''s own institution and learner'
      USING ERRCODE = 'check_violation';
  END IF;
  IF mem.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'INSTITUTION_LICENSE_SEAT_MEMBERSHIP_NOT_ACTIVE: a seat can only be assigned to an ACTIVE institution membership'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO used FROM public.institution_license_seats
   WHERE license_id = NEW.license_id AND status = 'ASSIGNED' AND id <> NEW.id;
  IF used >= lic.seat_limit THEN
    RAISE EXCEPTION 'INSTITUTION_LICENSE_SEATS_EXHAUSTED: licence % has % of % seats assigned', NEW.license_id, used, lic.seat_limit
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_institution_license_seats_guard ON public.institution_license_seats;
CREATE TRIGGER trg_institution_license_seats_guard
  BEFORE INSERT OR UPDATE ON public.institution_license_seats
  FOR EACH ROW EXECUTE FUNCTION public.institution_license_seats_guard();

CREATE OR REPLACE FUNCTION public.institution_membership_release_seats()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'ENDED' AND OLD.status = 'ACTIVE' THEN
    UPDATE public.institution_license_seats
       SET status = 'RELEASED', released_at = now(), release_reason = 'MEMBERSHIP_ENDED'
     WHERE membership_id = NEW.id AND status = 'ASSIGNED';
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_institution_membership_release_seats ON public.institution_student_memberships;
CREATE TRIGGER trg_institution_membership_release_seats
  AFTER UPDATE OF status ON public.institution_student_memberships
  FOR EACH ROW EXECUTE FUNCTION public.institution_membership_release_seats();
