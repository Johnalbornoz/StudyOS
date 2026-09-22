-- Fase 2A -- Secure user administration: additive schema only.
--
-- Adds:
--   1. ARCHIVED to users.status's existing ACTIVE|SUSPENDED vocabulary
--      (the column and its two original values already existed since F1;
--      no prior row's status value changes -- this only widens the CHECK).
--   2. Test-account marking columns on users (never inferred, only ever
--      set by the new admin test-identity provisioning path).
--   3. status_changed_at/by on users, for suspend/reactivate/archive audit.
--   4. revoked_at/revoked_by_user_id on user_roles, completing the
--      already-existing ACTIVE|REVOKED status pattern with a real audit
--      trail (previously a role could be REVOKED with no record of when
--      or by whom).
--   5. admin_audit_log -- the missing administrative action audit table.
--      Never used for pedagogical/AI decision provenance (that remains
--      ai_execution_events/decision_events, untouched) -- this is
--      exclusively for actions taken through the admin user-management
--      surface.
--
-- Deliberately does NOT: hardcode any real person's email, grant any
-- role to any account, reclassify any existing account as TEST, delete
-- anything, or touch STUDYUS_ADMIN membership -- that grant is handled
-- lazily, idempotently, in application code (src/lib/admin/authorization.ts)
-- from the same single allowlist that has always been the source of
-- truth (src/services/admin.service.ts), not baked into this file.
--
-- Fully idempotent (IF NOT EXISTS / conditional constraint guards
-- throughout) -- safe to re-run. Never applied automatically by
-- build/start -- apply explicitly via the governed migration runner.
-- Not yet applied to any database as of this commit.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_status_check_v2'
  ) THEN
    ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_status_check;
    ALTER TABLE public.users
      ADD CONSTRAINT users_status_check_v2 CHECK (status IN ('ACTIVE', 'SUSPENDED', 'ARCHIVED'));
  END IF;
END $$;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS test_alias text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS test_purpose text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS test_created_by uuid REFERENCES public.users(id);
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS test_review_at timestamptz;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS status_changed_at timestamptz;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS status_changed_by uuid REFERENCES public.users(id);

ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS revoked_by_user_id uuid REFERENCES public.users(id);

CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL REFERENCES public.users(id),
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  previous_state jsonb,
  new_state jsonb,
  reason text,
  result text NOT NULL DEFAULT 'SUCCESS',
  environment text NOT NULL,
  correlation_id text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_audit_log_result_check CHECK (result IN ('SUCCESS', 'FAILURE'))
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_actor ON public.admin_audit_log (actor_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_target ON public.admin_audit_log (target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_occurred ON public.admin_audit_log (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_is_test ON public.users (is_test) WHERE is_test = true;
