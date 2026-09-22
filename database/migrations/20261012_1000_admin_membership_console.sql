-- Professional Admin Console -- membership/payment governance,
-- manual-approval evidence, and a real subscription timeline.
--
-- Additive only. Never touches Production automatically. Not applied
-- to any database as of this commit -- apply only via the governed
-- runner, Preview only, under separate explicit authorization.

-- --- subscriptions: admin-grant fields (mandatory-expiration grants,
-- distinct from the pre-existing manually_set_by_admin boolean which
-- carried no expiration at all) + wider status vocabulary ---

ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS grant_reason text;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS grant_expires_at timestamptz;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS granted_by_user_id uuid REFERENCES public.users(id);
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS source text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_status_check_v3'
  ) THEN
    ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check_v2;
    ALTER TABLE public.subscriptions
      ADD CONSTRAINT subscriptions_status_check_v3
      CHECK (status IN (
        'unpaid', 'active', 'past_due', 'canceled', 'suspended', 'reactivated',
        'cancelled_at_period_end', 'expired', 'disputed', 'refunded', 'payment_under_review'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_source_check'
  ) THEN
    ALTER TABLE public.subscriptions
      ADD CONSTRAINT subscriptions_source_check
      CHECK (source IS NULL OR source IN ('INDIVIDUAL_PAYMENT', 'PARENT_PAYMENT', 'INSTITUTIONAL_LICENSE', 'ADMIN_PROMOTION', 'TRIAL'));
  END IF;
END $$;

-- --- payments: manual-approval evidence, never real card/payment-method data ---

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS approved_by_user_id uuid REFERENCES public.users(id);
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS approval_method text;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS approval_evidence_reference text;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS approval_notes text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payments_status_check_v2'
  ) THEN
    ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_status_check;
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_status_check_v2
      CHECK (status IN ('SUCCEEDED', 'FAILED', 'PENDING', 'REFUNDED', 'DISPUTED'));
  END IF;
END $$;

-- --- subscription_events: the real timeline a membership detail view needs.
-- Append-only, never edited -- one row per state transition, whatever
-- the trigger (a real webhook, an admin action, or automatic expiry).

CREATE TABLE IF NOT EXISTS public.subscription_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES public.subscriptions(id),
  actor_user_id uuid REFERENCES public.users(id),
  event_type text NOT NULL,
  previous_status text,
  new_status text,
  reason text,
  source text,
  metadata jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscription_events_type_check CHECK (event_type IN (
    'CREATED', 'PAYMENT_INITIATED', 'PAYMENT_CONFIRMED', 'LICENSE_ACTIVATED', 'RENEWED',
    'SUSPENDED', 'REACTIVATED', 'CANCELLED', 'EXPIRED', 'REFUNDED', 'DISPUTED', 'RECONCILED'
  ))
);

CREATE INDEX IF NOT EXISTS idx_subscription_events_subscription ON public.subscription_events (subscription_id, occurred_at DESC);

-- Note: "impedir referencias duplicadas" for manual approvals is
-- already enforced by the existing `payments_provider_reference_unique`
-- constraint (F3, UNIQUE (provider, provider_reference), never
-- dropped) -- a manual approval uses provider='manual' and is subject
-- to that same global uniqueness, no new index needed.

-- --- deletion audit: what a permanent user deletion actually did to
-- each dependency category, for the one-time record a hard delete
-- must leave behind (admin_audit_log's own new_state jsonb already
-- covers this generically; no new table needed).

-- --- mandatory temporary-password change (real Clerk mechanism: the
-- installed @clerk/backend@3.16.10 has no native "force change on
-- next login" flag -- confirmed against its own UserApi.d.ts. This
-- flag is StudyUS's own gate, checked server-side on every dashboard
-- request (src/app/dashboard/layout.tsx), cleared only after the
-- user's own browser session successfully calls Clerk's real
-- `user.updatePassword()` and StudyUS's own confirmation endpoint
-- observes that success -- see F15_ADMIN_USER_MANAGEMENT.md
-- "Contraseña temporal" for the full, honest description of what this
-- can and cannot verify without a dedicated Clerk webhook event for
-- password changes (none exists in this Clerk account/version). ---

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS password_change_required boolean NOT NULL DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS password_change_required_at timestamptz;
