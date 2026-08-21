-- Spaced repetition: next_review_date is computed after every mastery
-- update (see mastery.service.ts) from the concept's current mastery +
-- confidence -- well-known concepts get a longer interval before
-- they're due again, same principle as any spaced-repetition system.
-- forgetting_risk is NOT stored here on purpose: it decays continuously
-- with time, so a stored value would go stale the moment it's written.
-- It's computed on read from (now - last_practiced) vs. the interval
-- that produced next_review_date -- see lib/algorithms/spaced-repetition.ts.
ALTER TABLE mastery_records ADD COLUMN IF NOT EXISTS next_review_date DATE;

-- Error intelligence: one row per wrong/partial answer, classified by
-- Claude's grading call (CONCEPTUAL, PROCEDURAL, CARELESS, INCOMPLETE,
-- MISREADING). Patterns ("this student keeps making procedural errors
-- in Algebra") are a GROUP BY over this table, not a separately
-- maintained table -- see error-intelligence.service.ts.
CREATE TABLE IF NOT EXISTS errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES profiles(id),
  concept_id UUID NOT NULL REFERENCES concepts(id),
  subject_id UUID NOT NULL REFERENCES subjects(id),
  error_type VARCHAR(30) NOT NULL,
  source_type VARCHAR(30) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS errors_student_concept_idx ON errors(student_id, concept_id);
CREATE INDEX IF NOT EXISTS errors_student_type_idx ON errors(student_id, error_type);
