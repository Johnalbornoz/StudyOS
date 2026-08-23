-- Adds the actual raw score (0-100) behind a piece of learning evidence,
-- e.g. 100 for "15/15 correct", instead of only the coarse
-- correct/partial/incorrect bucket. Additive, nullable, backward
-- compatible: existing rows and callers that don't pass a score keep
-- working exactly as before.

ALTER TABLE learning_evidence
  ADD COLUMN IF NOT EXISTS score_percent NUMERIC;
