-- Track A -- Learning Plan Orchestrator. Additive and idempotent; DEV only
-- until the track is merged. Reuses the canonical catalog, the versioned
-- curriculum (academic_subjects → structure_versions → learning_objectives →
-- objective_concept_mappings) and the per-learner concept/learner state. It
-- adds PLANNING structure only: nothing here stores mastery, evidence or a
-- learning phase (LEARN/PRACTICE/PROVE/RETAIN/TRANSFER stays the canonical
-- engine's own derived output).
--
--  1. canonical_concept_localizations -- display labels of canonical concepts
--     per UI locale (identity stays the canonical id).
--  2. student_plan_entries -- the Personal Learning Plan: ONE row per
--     (student, canonical concept), pointing at the ONE learner concept that
--     carries the learner state. plan_status is planning intent only.
--  3. student_concept_sources -- why a concept is in the plan (SELF_SELECTED,
--     TEACHER_ASSIGNMENT, CLASS_PLAN, EXAM_GAP, ...). Many sources, one entry.
--  4. Universal merge guard: a student can never have two learner concepts
--     MATCHED to the same canonical concept (trigger on concept_catalog_mapping).
--  5. institution_curricula / institution_curriculum_concepts -- the
--     coordinator's institutional curriculum (REQUIRED/RECOMMENDED/OPTIONAL/
--     SUPPLEMENTAL), based on an optional versioned base curriculum.
--  6. class_plan_concepts -- the Teacher's Class Learning Plan.
--  7. concept_proposals -- a Teacher/Coordinator proposes a concept that does
--     not exist; only StudyUS catalog governance creates canonical concepts.
--  8. learning_recommendations -- persisted exam-gap recommendations (open /
--     accepted / dismissed; idempotent per student + concept + exam attempt).
--  9. student_plan_events / curriculum_events -- audit trail (never deleted).
-- 10. concepts.origin and concept_catalog_mapping.mapping_method accept the
--     new provenance values.
-- 11. Backfill: every existing MATCHED learner concept becomes a plan entry
--     with a source (TEACHER_ASSIGNMENT when it was created by an assignment,
--     else SELF_SELECTED).
--
-- Rollback (DEV only; one transaction):
--   DROP TRIGGER IF EXISTS trg_one_learner_concept_per_canonical ON concept_catalog_mapping;
--   DROP FUNCTION IF EXISTS enforce_one_learner_concept_per_canonical();
--   DROP TABLE IF EXISTS curriculum_events, student_plan_events, learning_recommendations, concept_proposals, class_plan_concepts, institution_curriculum_concepts, institution_curricula, student_concept_sources, student_plan_entries, canonical_concept_localizations;
--   ALTER TABLE concepts DROP CONSTRAINT IF EXISTS concepts_origin_check;
--   ALTER TABLE concepts ADD CONSTRAINT concepts_origin_check CHECK (origin IS NULL OR origin = 'TEACHER_ASSIGNMENT');
--   ALTER TABLE concept_catalog_mapping DROP CONSTRAINT IF EXISTS concept_catalog_mapping_method_check;
--   ALTER TABLE concept_catalog_mapping ADD CONSTRAINT concept_catalog_mapping_method_check CHECK (mapping_method IS NULL OR mapping_method IN ('EXACT_LABEL_MATCH', 'MANUAL_REVIEW', 'SEED_FIXTURE', 'TEACHER_ASSIGNMENT'));
--   DELETE FROM schema_migrations WHERE version = '20261018_1400';

-- 1 ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS canonical_concept_localizations (
  canonical_concept_id uuid NOT NULL REFERENCES canonical_concepts(id),
  language text NOT NULL CHECK (language IN ('es', 'en', 'de', 'fr', 'pt')),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (canonical_concept_id, language)
);

-- 10 -----------------------------------------------------------------------
ALTER TABLE concepts DROP CONSTRAINT IF EXISTS concepts_origin_check;
ALTER TABLE concepts ADD CONSTRAINT concepts_origin_check CHECK (
  origin IS NULL OR origin IN ('TEACHER_ASSIGNMENT', 'SELF_SELECTED', 'CURRICULUM_RECOMMENDATION', 'INSTITUTION_CURRICULUM', 'CLASS_PLAN', 'EXAM_GAP', 'PREREQUISITE_RECOMMENDATION')
);
ALTER TABLE concept_catalog_mapping DROP CONSTRAINT IF EXISTS concept_catalog_mapping_method_check;
ALTER TABLE concept_catalog_mapping ADD CONSTRAINT concept_catalog_mapping_method_check CHECK (
  mapping_method IS NULL OR mapping_method IN ('EXACT_LABEL_MATCH', 'MANUAL_REVIEW', 'SEED_FIXTURE', 'TEACHER_ASSIGNMENT', 'PLAN_ENROLLMENT')
);

-- 2 ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS student_plan_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES students(id),
  canonical_concept_id uuid NOT NULL REFERENCES canonical_concepts(id),
  learner_concept_id uuid NOT NULL UNIQUE REFERENCES concepts(id),
  plan_status text NOT NULL DEFAULT 'IN_PLAN' CHECK (plan_status IN ('IN_PLAN', 'ARCHIVED')),
  added_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT student_plan_entries_one_per_canonical UNIQUE (student_id, canonical_concept_id)
);
CREATE INDEX IF NOT EXISTS idx_student_plan_entries_student ON student_plan_entries (student_id);

-- 3 ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS student_concept_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL,
  canonical_concept_id uuid NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('SELF_SELECTED', 'CURRICULUM_RECOMMENDATION', 'INSTITUTION_CURRICULUM', 'CLASS_PLAN', 'TEACHER_ASSIGNMENT', 'EXAM_GAP', 'PREREQUISITE_RECOMMENDATION')),
  -- the specific origin (class id, exam attempt id, intervention id, curriculum id); '' when none
  source_key text NOT NULL DEFAULT '',
  institution_id uuid REFERENCES institutions(id),
  class_id uuid REFERENCES classes(id),
  exam_attempt_id uuid,
  teacher_intervention_id uuid,
  added_by_user_id uuid REFERENCES users(id),
  active boolean NOT NULL DEFAULT true,
  added_at timestamptz NOT NULL DEFAULT now(),
  deactivated_at timestamptz,
  deactivation_reason text,
  CONSTRAINT student_concept_sources_entry_fk FOREIGN KEY (student_id, canonical_concept_id) REFERENCES student_plan_entries (student_id, canonical_concept_id),
  CONSTRAINT student_concept_sources_unique UNIQUE (student_id, canonical_concept_id, source_type, source_key)
);
CREATE INDEX IF NOT EXISTS idx_student_concept_sources_class ON student_concept_sources (class_id) WHERE class_id IS NOT NULL;

-- 4 ------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_one_learner_concept_per_canonical() RETURNS trigger AS $$
DECLARE
  owner uuid;
BEGIN
  IF NEW.status = 'MATCHED' AND NEW.canonical_concept_id IS NOT NULL THEN
    SELECT s.student_id INTO owner FROM concepts c JOIN subjects s ON s.id = c.subject_id WHERE c.id = NEW.learner_concept_id;
    IF EXISTS (
      SELECT 1 FROM concept_catalog_mapping m
      JOIN concepts c ON c.id = m.learner_concept_id
      JOIN subjects s ON s.id = c.subject_id
      WHERE m.status = 'MATCHED' AND m.canonical_concept_id = NEW.canonical_concept_id
        AND m.learner_concept_id <> NEW.learner_concept_id AND s.student_id = owner
    ) THEN
      RAISE EXCEPTION 'LEARNER_CONCEPT_ALREADY_MAPPED: student % already has a learner concept for canonical concept %', owner, NEW.canonical_concept_id
        USING ERRCODE = '23505';
    END IF;
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_one_learner_concept_per_canonical ON concept_catalog_mapping;
CREATE TRIGGER trg_one_learner_concept_per_canonical BEFORE INSERT OR UPDATE OF status, canonical_concept_id ON concept_catalog_mapping
  FOR EACH ROW EXECUTE FUNCTION enforce_one_learner_concept_per_canonical();

-- 5 ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS institution_curricula (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institutions(id),
  canonical_subject_id uuid NOT NULL REFERENCES canonical_subjects(id),
  base_academic_subject_id uuid REFERENCES academic_subjects(id),
  base_structure_version_id uuid REFERENCES structure_versions(id),
  grade_id uuid REFERENCES grades(id),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  programme_label text,
  academic_year text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  created_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_institution_curricula_active
  ON institution_curricula (institution_id, canonical_subject_id, COALESCE(grade_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(academic_year, ''))
  WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS institution_curriculum_concepts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  curriculum_id uuid NOT NULL REFERENCES institution_curricula(id),
  canonical_concept_id uuid NOT NULL REFERENCES canonical_concepts(id),
  classification text NOT NULL DEFAULT 'RECOMMENDED' CHECK (classification IN ('REQUIRED', 'RECOMMENDED', 'OPTIONAL', 'SUPPLEMENTAL')),
  period text,
  order_index integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REMOVED')),
  added_by_user_id uuid REFERENCES users(id),
  added_at timestamptz NOT NULL DEFAULT now(),
  removed_by_user_id uuid REFERENCES users(id),
  removed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT institution_curriculum_concepts_unique UNIQUE (curriculum_id, canonical_concept_id)
);

-- 6 ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS class_plan_concepts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id),
  canonical_concept_id uuid NOT NULL REFERENCES canonical_concepts(id),
  order_index integer NOT NULL DEFAULT 0,
  priority text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('HIGH', 'NORMAL', 'LOW')),
  target_date date,
  period text,
  required_for_class boolean NOT NULL DEFAULT false,
  supplemental boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REMOVED')),
  added_by_user_id uuid REFERENCES users(id),
  added_at timestamptz NOT NULL DEFAULT now(),
  removed_by_user_id uuid REFERENCES users(id),
  removed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT class_plan_concepts_unique UNIQUE (class_id, canonical_concept_id)
);

-- 7 ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS concept_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 200),
  description text,
  canonical_subject_id uuid REFERENCES canonical_subjects(id),
  topic text,
  academic_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  rationale text,
  requested_by_user_id uuid NOT NULL REFERENCES users(id),
  institution_id uuid REFERENCES institutions(id),
  class_id uuid REFERENCES classes(id),
  candidate_equivalences jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED', 'MAPPED_TO_EXISTING', 'APPROVED', 'MERGED', 'REJECTED')),
  resolved_canonical_concept_id uuid REFERENCES canonical_concepts(id),
  reviewed_by_user_id uuid REFERENCES users(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 8 ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS learning_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES students(id),
  canonical_concept_id uuid NOT NULL REFERENCES canonical_concepts(id),
  recommendation_type text NOT NULL CHECK (recommendation_type IN ('EXAM_GAP')),
  source_key text NOT NULL DEFAULT '',
  exam_attempt_id uuid,
  learning_objective_id uuid,
  reason jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ACCEPTED', 'DISMISSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  dismissed_at timestamptz,
  CONSTRAINT learning_recommendations_unique UNIQUE (student_id, canonical_concept_id, recommendation_type, source_key)
);
CREATE INDEX IF NOT EXISTS idx_learning_recommendations_open ON learning_recommendations (student_id) WHERE status = 'OPEN';

-- 9 ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS student_plan_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES students(id),
  canonical_concept_id uuid NOT NULL REFERENCES canonical_concepts(id),
  event_type text NOT NULL CHECK (event_type IN ('ADDED', 'SOURCE_ADDED', 'SOURCE_REMOVED', 'ARCHIVED', 'RESTORED', 'RECOMMENDED', 'RECOMMENDATION_ACCEPTED', 'RECOMMENDATION_DISMISSED')),
  source_type text,
  source_key text,
  actor_user_id uuid REFERENCES users(id),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_student_plan_events_student ON student_plan_events (student_id, created_at DESC);

CREATE TABLE IF NOT EXISTS curriculum_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid REFERENCES institutions(id),
  curriculum_id uuid REFERENCES institution_curricula(id),
  class_id uuid REFERENCES classes(id),
  canonical_concept_id uuid REFERENCES canonical_concepts(id),
  event_type text NOT NULL CHECK (event_type IN ('CURRICULUM_ADOPTED', 'CONCEPT_ADDED', 'CONCEPT_REMOVED', 'CONCEPT_RESTORED', 'CONCEPT_CLASSIFIED', 'CLASS_PLAN_ADDED', 'CLASS_PLAN_REMOVED', 'CLASS_PLAN_UPDATED', 'SUPPLEMENTAL_ADDED', 'PROPOSAL_CREATED', 'PROPOSAL_RESOLVED')),
  actor_user_id uuid REFERENCES users(id),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 11 -----------------------------------------------------------------------
INSERT INTO student_plan_entries (student_id, canonical_concept_id, learner_concept_id)
SELECT DISTINCT ON (s.student_id, m.canonical_concept_id) s.student_id, m.canonical_concept_id, c.id
FROM concept_catalog_mapping m
JOIN concepts c ON c.id = m.learner_concept_id
JOIN subjects s ON s.id = c.subject_id
JOIN students st ON st.id = s.student_id
WHERE m.status = 'MATCHED' AND m.canonical_concept_id IS NOT NULL
ORDER BY s.student_id, m.canonical_concept_id, c.created_at
ON CONFLICT DO NOTHING;

INSERT INTO student_concept_sources (student_id, canonical_concept_id, source_type, source_key, class_id)
SELECT e.student_id, e.canonical_concept_id,
       CASE WHEN c.origin = 'TEACHER_ASSIGNMENT' THEN 'TEACHER_ASSIGNMENT' ELSE 'SELF_SELECTED' END,
       CASE WHEN c.origin = 'TEACHER_ASSIGNMENT' AND c.origin_class_id IS NOT NULL THEN c.origin_class_id::text ELSE '' END,
       CASE WHEN c.origin = 'TEACHER_ASSIGNMENT' THEN c.origin_class_id END
FROM student_plan_entries e JOIN concepts c ON c.id = e.learner_concept_id
ON CONFLICT DO NOTHING;
