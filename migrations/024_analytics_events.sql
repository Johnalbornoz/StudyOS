-- Product Analytics (Phase 2, brief section 85): a minimal internal
-- event log so the Cognitive Learning Engine's key moments are
-- recorded from day one, without committing to a specific external
-- analytics provider. Additive only.
CREATE TABLE IF NOT EXISTS analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES students(id),
  event_name TEXT NOT NULL,
  properties JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_student_id ON analytics_events(student_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_event_name ON analytics_events(event_name);
