-- Platform runtime settings (generic) + Question Bank consumption alerts.
--
-- Strictly additive: two new tables, no change to any existing object.
-- Never applied automatically -- governed runner only (DEV first, then
-- Preview; this release never targets Production).
--
--   platform_settings  -- ONE generic, governed key -> JSON value store for
--                         runtime configuration a Platform Admin changes
--                         without a redeploy (first user: the Question Bank
--                         Factory controls, key 'question_bank.factory').
--                         Every change is also written to admin_audit_log
--                         (who / old value / new value / when) by the app.
--   question_bank_consumption_alerts -- one row per (UTC day, threshold)
--                         crossed, so a consumption alert is raised once
--                         and its acknowledgement persists.
--
-- Rollback (only if nothing depends on it yet):
--   DROP TABLE IF EXISTS public.question_bank_consumption_alerts;
--   DROP TABLE IF EXISTS public.platform_settings;

CREATE TABLE IF NOT EXISTS public.platform_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  updated_by uuid REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_settings_key_check CHECK (key ~ '^[a-z][a-z0-9_.]{2,79}$'),
  CONSTRAINT platform_settings_value_object CHECK (jsonb_typeof(value) = 'object')
);

COMMENT ON TABLE public.platform_settings IS
  'Governed runtime configuration (key -> JSON object). Written only by Platform Admin endpoints; every change audited in admin_audit_log.';

CREATE TABLE IF NOT EXISTS public.question_bank_consumption_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day date NOT NULL,
  threshold_percent integer NOT NULL,
  level text NOT NULL,
  calls_used integer NOT NULL,
  calls_limit integer NOT NULL,
  raised_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_by uuid REFERENCES public.users(id),
  acknowledged_at timestamptz,
  CONSTRAINT question_bank_consumption_alerts_level_check CHECK (level IN ('INFO', 'WARNING', 'CRITICAL', 'HARD_LIMIT')),
  CONSTRAINT question_bank_consumption_alerts_threshold_check CHECK (threshold_percent BETWEEN 1 AND 100),
  CONSTRAINT question_bank_consumption_alerts_once UNIQUE (day, threshold_percent)
);

CREATE INDEX IF NOT EXISTS idx_question_bank_consumption_alerts_day ON public.question_bank_consumption_alerts (day DESC);
