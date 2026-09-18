-- F3: Subscription & Entitlement Foundation -- extends the existing
-- `subscriptions` table (never replaced) with plan/payer separation
-- and the full target status vocabulary, plus two genuinely new
-- tables (price_book, payments) that no prior table represented.
--
-- Fully idempotent, never applied automatically by build/start --
-- apply explicitly via `npm run db:migrate`.
-- ---------------------------------------------------------------------

-- --- extend the existing subscriptions table ---

ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS plan text;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS payer_user_id uuid REFERENCES public.users(id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_plan_check'
  ) THEN
    ALTER TABLE public.subscriptions
      ADD CONSTRAINT subscriptions_plan_check CHECK (plan IS NULL OR plan IN ('MONTHLY', 'ANNUAL'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_status_check_v2'
  ) THEN
    ALTER TABLE public.subscriptions
      DROP CONSTRAINT IF EXISTS subscriptions_status_check;
    ALTER TABLE public.subscriptions
      ADD CONSTRAINT subscriptions_status_check_v2
      CHECK (status IN ('unpaid', 'active', 'past_due', 'canceled', 'suspended', 'reactivated', 'cancelled_at_period_end', 'expired'));
  END IF;
END $$;

-- Backfill: the only safe inference available in this environment --
-- every existing subscription's payer defaults to the learner's own
-- canonical user (no real third-party payer data exists to infer
-- from). Never touches `status`.
UPDATE public.subscriptions s
SET payer_user_id = st.user_id
FROM public.students st
WHERE s.student_id = st.id AND s.payer_user_id IS NULL AND st.user_id IS NOT NULL;

-- --- new: Price Book ---

CREATE TABLE IF NOT EXISTS public.price_book (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country text NOT NULL,
  currency text NOT NULL,
  plan text NOT NULL,
  amount_cents bigint NOT NULL,
  effective_from timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT price_book_plan_check CHECK (plan IN ('MONTHLY', 'ANNUAL')),
  CONSTRAINT price_book_status_check CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED')),
  CONSTRAINT price_book_amount_check CHECK (amount_cents >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_price_book_active_unique
  ON public.price_book (country, currency, plan) WHERE status = 'ACTIVE';

-- Non-production fixture data -- only the two markets already
-- referenced elsewhere in this codebase (MERCADOPAGO_PLAN_CURRENCY
-- default 'COP'), never a full commercial price list.
INSERT INTO public.price_book (country, currency, plan, amount_cents, status)
VALUES
  ('CO', 'COP', 'MONTHLY', 3900000, 'ACTIVE'),
  ('CO', 'COP', 'ANNUAL', 39000000, 'ACTIVE'),
  ('MX', 'MXN', 'MONTHLY', 19900, 'ACTIVE'),
  ('MX', 'MXN', 'ANNUAL', 199000, 'ACTIVE')
ON CONFLICT DO NOTHING;

-- --- new: Payment (normalized transaction record) ---

CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES public.subscriptions(id),
  payer_user_id uuid REFERENCES public.users(id),
  amount_cents bigint NOT NULL,
  currency text NOT NULL,
  provider text NOT NULL,
  provider_reference text NOT NULL,
  status text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb,
  CONSTRAINT payments_status_check CHECK (status IN ('SUCCEEDED', 'FAILED', 'PENDING')),
  CONSTRAINT payments_provider_reference_unique UNIQUE (provider, provider_reference)
);

CREATE INDEX IF NOT EXISTS idx_payments_subscription ON public.payments (subscription_id);
