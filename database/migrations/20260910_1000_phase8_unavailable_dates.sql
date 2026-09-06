-- Phase 8 -- Step 8F1: learner-declared unavailable dates.
--
-- Additive only. A row means "the learner is not available to study on
-- this calendar date". The deterministic planner (8D) consumes each row
-- as `available = false` for that horizon day; it never blocks canonical
-- learning evidence, never penalises cognitive state, and carries no
-- learner prose. Removing a row simply makes the day available again on
-- the next rebuild.
--
-- No trigger, no backfill, no touch of any legacy study-plan table.

CREATE TABLE IF NOT EXISTS student_unavailable_dates (
  student_id       UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  unavailable_date DATE NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (student_id, unavailable_date)
);

CREATE INDEX IF NOT EXISTS idx_student_unavailable_dates_student
  ON student_unavailable_dates (student_id, unavailable_date);
