-- L10 SF-7 (1/5 of the L10 schema batch) -- parent relationship lifecycle.
-- Findings: L3 P1-4, P2-12, CR-04; L4-07, L4-16, L4-17 (CR-L4-04).
--
-- 1. parent_invitations.expires_at: an invitation used to live forever, so a
--    forgotten one could be accepted months later (L4-07). Every invitation
--    now expires 30 days after it was created. Existing rows are backfilled
--    with the same rule from their own created_at -- an old pending
--    invitation is therefore already past its expiry and is refused; the
--    Student can simply send it again.
--    Status gains 'expired' so an expired invitation stops occupying the
--    one-pending-per-(student, email) slot.
--
-- 2. parent_student_relationships.status default: the baseline default was
--    'accepted' (L4-17) -- an INSERT that forgot the column would have
--    granted access. No code path relies on it; the default becomes
--    'pending', which grants nothing.
--
-- 3. parent_student_relationships.request_count: how many times this parent
--    has asked this learner for access. The application caps it, so a
--    declined or revoked parent cannot re-request without limit (L4-17).
--
-- 4. parent_student_relationships.ended_by_user_id / ended_reason: who ended
--    a relationship when it was not the two parties themselves (a platform
--    administrator), and why. NULL for every existing row and for
--    student/parent-initiated endings.
--
-- No row's status changes. No access is granted or removed by this file.
--
-- Rollback (run in one transaction):
--   ALTER TABLE public.parent_student_relationships DROP COLUMN IF EXISTS ended_reason, DROP COLUMN IF EXISTS ended_by_user_id, DROP COLUMN IF EXISTS request_count;
--   ALTER TABLE public.parent_student_relationships ALTER COLUMN status SET DEFAULT 'accepted';
--   UPDATE public.parent_invitations SET status = 'revoked' WHERE status = 'expired';
--   ALTER TABLE public.parent_invitations DROP CONSTRAINT IF EXISTS parent_invitations_status_check_v2;
--   ALTER TABLE public.parent_invitations ADD CONSTRAINT parent_invitations_status_check CHECK (status IN ('pending', 'accepted', 'declined', 'revoked'));
--   ALTER TABLE public.parent_invitations DROP COLUMN IF EXISTS expires_at;
--   DELETE FROM schema_migrations WHERE version = '20261120_1000';

-- Every statement is idempotent (re-applying is a no-op).

-- 1. invitation expiry ------------------------------------------------------
ALTER TABLE public.parent_invitations ADD COLUMN IF NOT EXISTS expires_at timestamptz;

UPDATE public.parent_invitations SET expires_at = created_at + interval '30 days' WHERE expires_at IS NULL;

ALTER TABLE public.parent_invitations ALTER COLUMN expires_at SET DEFAULT (now() + interval '30 days');
ALTER TABLE public.parent_invitations ALTER COLUMN expires_at SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'parent_invitations_status_check_v2') THEN
    ALTER TABLE public.parent_invitations DROP CONSTRAINT IF EXISTS parent_invitations_status_check;
    ALTER TABLE public.parent_invitations
      ADD CONSTRAINT parent_invitations_status_check_v2 CHECK (status IN ('pending', 'accepted', 'declined', 'revoked', 'expired'));
  END IF;
END $$;

-- 2. no permissive default --------------------------------------------------
ALTER TABLE public.parent_student_relationships ALTER COLUMN status SET DEFAULT 'pending';

-- 3. re-request counter -----------------------------------------------------
ALTER TABLE public.parent_student_relationships ADD COLUMN IF NOT EXISTS request_count integer NOT NULL DEFAULT 1;

-- 4. who ended it, when it was not the two parties --------------------------
ALTER TABLE public.parent_student_relationships ADD COLUMN IF NOT EXISTS ended_by_user_id uuid REFERENCES public.users(id);
ALTER TABLE public.parent_student_relationships ADD COLUMN IF NOT EXISTS ended_reason text;
