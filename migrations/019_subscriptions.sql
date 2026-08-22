-- One row per student tracking their subscription/payment state.
-- Populated either by an admin manual override, or by the payment
-- gateway webhook once a real provider account is connected.
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL UNIQUE REFERENCES students(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'active', 'past_due', 'canceled')),
  provider TEXT NOT NULL DEFAULT 'mercadopago',
  provider_subscription_id TEXT,
  provider_payer_email TEXT,
  current_period_end TIMESTAMPTZ,
  manually_set_by_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS subscriptions_provider_subscription_idx
  ON subscriptions(provider_subscription_id);
