-- Turns linking into a real invitation: a parent's link request starts
-- 'pending' and only grants read access once the student accepts it,
-- instead of granting access the instant a parent enters an email.
ALTER TABLE parent_student_relationships
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'accepted'
    CHECK (status IN ('pending', 'accepted', 'declined')),
  ADD COLUMN IF NOT EXISTS responded_at TIMESTAMPTZ;
