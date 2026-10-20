-- Track A -- Teacher E2E readiness. Additive and idempotent; DEV only.
--
-- 1. classes.canonical_subject_id: the Institution Admin links each class
--    to ONE canonical subject (e.g. "Matemáticas 3A" -> Mathematics). The
--    teacher's topics (canonical concepts), assignments and learner view are
--    scoped to that subject. Nullable: existing classes stay valid (a class
--    without a subject offers no catalog topics until one is linked).
--
-- 2. teacher_interventions.title / starts_at: an assignment has a title and
--    an optional start date (the learner sees and can start it from then on;
--    due_at already exists). Nullable: existing rows stay valid.
--
-- Rollback (DEV only; one transaction):
--   DROP INDEX IF EXISTS idx_classes_canonical_subject;
--   ALTER TABLE classes DROP COLUMN IF EXISTS canonical_subject_id;
--   ALTER TABLE teacher_interventions DROP COLUMN IF EXISTS title, DROP COLUMN IF EXISTS starts_at;
--   DELETE FROM schema_migrations WHERE version = '20261018_1100';

ALTER TABLE classes ADD COLUMN IF NOT EXISTS canonical_subject_id uuid REFERENCES canonical_subjects(id);
CREATE INDEX IF NOT EXISTS idx_classes_canonical_subject ON classes (canonical_subject_id) WHERE canonical_subject_id IS NOT NULL;

ALTER TABLE teacher_interventions
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS starts_at timestamptz;

ALTER TABLE teacher_interventions DROP CONSTRAINT IF EXISTS teacher_interventions_title_length;
ALTER TABLE teacher_interventions
  ADD CONSTRAINT teacher_interventions_title_length CHECK (title IS NULL OR char_length(title) BETWEEN 1 AND 200);
