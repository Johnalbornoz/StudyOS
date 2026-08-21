-- learning_debt.service.ts already writes to this table (severity
-- change audit trail) but it never existed, so every debt severity
-- update or resolution crashed. This matches the "learning_debt_events"
-- entity already listed in the intended core data model.
CREATE TABLE IF NOT EXISTS learning_debt_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  debt_id UUID NOT NULL REFERENCES learning_debt(id) ON DELETE CASCADE,
  old_severity INT NOT NULL,
  new_severity INT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS learning_debt_events_debt_idx ON learning_debt_events(debt_id);
