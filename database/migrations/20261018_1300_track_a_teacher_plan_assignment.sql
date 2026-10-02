-- Track A -- a Teacher assignment may add a catalog concept to a learner's plan.
-- Additive and idempotent; DEV only until the track is merged.
--
-- 1. concepts.origin / origin_class_id: provenance of a learner concept that a
--    Teacher assignment added to the learner's plan (NULL for every concept
--    the learner created or extracted). Never used for authorization.
-- 2. concept_catalog_mapping.mapping_method gains 'TEACHER_ASSIGNMENT': the
--    concept was created FROM the canonical concept, so it is MATCHED by
--    construction (never a guessed correspondence).
-- 3. teacher_interventions.concept_added_to_plan: whether publishing this
--    assignment added the concept to the learner's plan (Teacher UX).
-- 4. One row per (assignment group, learner): a retried publish can never
--    duplicate a recipient.
--
-- Rollback (DEV only; one transaction):
--   DROP INDEX IF EXISTS uq_teacher_interventions_group_student;
--   ALTER TABLE teacher_interventions DROP COLUMN IF EXISTS concept_added_to_plan;
--   ALTER TABLE concept_catalog_mapping DROP CONSTRAINT IF EXISTS concept_catalog_mapping_method_check;
--   ALTER TABLE concept_catalog_mapping ADD CONSTRAINT concept_catalog_mapping_method_check CHECK (mapping_method IS NULL OR mapping_method IN ('EXACT_LABEL_MATCH', 'MANUAL_REVIEW', 'SEED_FIXTURE'));
--   ALTER TABLE concepts DROP CONSTRAINT IF EXISTS concepts_origin_check;
--   ALTER TABLE concepts DROP COLUMN IF EXISTS origin, DROP COLUMN IF EXISTS origin_class_id;
--   DELETE FROM schema_migrations WHERE version = '20261018_1300';

ALTER TABLE concepts
  ADD COLUMN IF NOT EXISTS origin text,
  ADD COLUMN IF NOT EXISTS origin_class_id uuid REFERENCES classes(id);
ALTER TABLE concepts DROP CONSTRAINT IF EXISTS concepts_origin_check;
ALTER TABLE concepts ADD CONSTRAINT concepts_origin_check CHECK (origin IS NULL OR origin = 'TEACHER_ASSIGNMENT');

ALTER TABLE concept_catalog_mapping DROP CONSTRAINT IF EXISTS concept_catalog_mapping_method_check;
ALTER TABLE concept_catalog_mapping ADD CONSTRAINT concept_catalog_mapping_method_check
  CHECK (mapping_method IS NULL OR mapping_method IN ('EXACT_LABEL_MATCH', 'MANUAL_REVIEW', 'SEED_FIXTURE', 'TEACHER_ASSIGNMENT'));

ALTER TABLE teacher_interventions ADD COLUMN IF NOT EXISTS concept_added_to_plan boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS uq_teacher_interventions_group_student
  ON teacher_interventions (assignment_group_id, student_id) WHERE assignment_group_id IS NOT NULL;
