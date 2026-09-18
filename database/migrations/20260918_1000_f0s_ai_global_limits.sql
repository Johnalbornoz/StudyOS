-- F0-S: additive operational counter shared by every instance using
-- this database, enforcing the global AI call-volume ceiling wired
-- into src/lib/ai/gateway.ts::executeAI (see
-- src/lib/ai/operational-limits.ts for the full design rationale).
--
-- No user data. Never auto-applied by build/start -- apply explicitly
-- via `npm run db:migrate` through the governed ledger, same as every
-- other migration in this directory.
--
-- Idempotent by construction (IF NOT EXISTS / ON CONFLICT), unlike the
-- historical, never-committed version of this same idea -- see
-- F0S_SECURITY_CONTAINMENT_REPORT.md for that finding (RR-06).
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ai_global_limits (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  day_start timestamptz NOT NULL,
  minute_start timestamptz NOT NULL,
  day_calls bigint NOT NULL DEFAULT 0 CHECK (day_calls >= 0),
  minute_calls bigint NOT NULL DEFAULT 0 CHECK (minute_calls >= 0)
);

INSERT INTO public.ai_global_limits (id, day_start, minute_start)
VALUES (true, date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC', date_trunc('minute', now()))
ON CONFLICT (id) DO NOTHING;
