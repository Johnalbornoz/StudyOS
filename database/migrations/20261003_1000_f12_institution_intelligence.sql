-- F12: institution-scoped Academic Coordinators. Additive and idempotent.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'institution_memberships_role_check_f12') THEN
    ALTER TABLE public.institution_memberships DROP CONSTRAINT IF EXISTS institution_memberships_role_check;
    ALTER TABLE public.institution_memberships
      ADD CONSTRAINT institution_memberships_role_check_f12
      CHECK (membership_role IN ('TEACHER', 'INSTITUTION_ADMIN', 'ACADEMIC_COORDINATOR'));
  END IF;
END $$;
