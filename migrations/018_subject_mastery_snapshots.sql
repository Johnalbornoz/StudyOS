-- One row per (subject, calendar day) tracking that subject's average
-- mastery at the time -- lets the dashboard show a real trend instead
-- of only a single point-in-time bar. Recorded lazily (upserted) on
-- dashboard load rather than backfilled, so history only accumulates
-- from real usage going forward.
CREATE TABLE IF NOT EXISTS subject_mastery_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  avg_mastery_score INT NOT NULL CHECK (avg_mastery_score >= 0 AND avg_mastery_score <= 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(subject_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS subject_mastery_snapshots_subject_idx
  ON subject_mastery_snapshots(subject_id, snapshot_date);
