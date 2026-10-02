-- ============================================================================
-- Track A -- Institution Curriculum Management V2 + Academic Governance
--
-- Additive. Reuses the published curriculum structure (academic_organizations
-- → academic_programmes → academic_qualifications → academic_subjects →
-- structure_versions → structure_nodes → learning_objectives), the
-- institution curriculum (20261018_1400), class plans and teacher
-- interventions. Only real gaps are added:
--
--  1. Education authority layer on academic_organizations: country,
--     source_type (GOVERNMENT_AUTHORITY / INTERNATIONAL_PROGRAMME /
--     INSTITUTION_DEFINED / STUDYUS_REFERENCE), authority_level
--     (NATIONAL / TERRITORIAL / INTERNATIONAL), parent authority,
--     jurisdiction, provenance. Official structures stay immutable and
--     versioned; institutions adopt them, never edit them.
--  2. academic_subjects.canonical_subject_id -- explicit link from a
--     published subject to the StudyUS catalog subject (backfilled by name).
--  3. institution_curricula V2: programme, source type, owner scope,
--     provenance, archive metadata, version replacement chain, and a new
--     uniqueness rule (institution + subject/level + version + grade + year)
--     so Mathematics 9709 A Level and AS Level, Biology, Physics... coexist.
--  4. institution_curriculum_objectives -- objective-level selection
--     (INCLUDED / EXCLUDED + REQUIRED/RECOMMENDED/OPTIONAL/SUPPLEMENTAL) of
--     the adopted published structure; institution_curriculum_concepts gains
--     source (AUTHORITY / INSTITUTION / TEACHER_SUPPLEMENTAL) and an
--     institution target date.
--  5. classes.institution_curriculum_id -- explicit class ↔ curriculum.
--  6. class_plan_concepts governance: owner_scope (INSTITUTION / TEACHER),
--     locked_fields, institution_target_date (never overwritten by a
--     teacher; target_date stays the teacher's planning date).
--  7. institution_assignments (+ targets): tasks defined by the institution
--     with field-level locks; teacher_interventions gain owner_scope and
--     institution_assignment_id.
--  8. student_concept_sources / concepts.origin accept INSTITUTION_ASSIGNMENT.
--  9. academic_governance_events -- audit of every governed change
--     (actor, institution, object, fields, old, new, when).
--
-- Rollback (manual, DEV only):
--   DROP TABLE IF EXISTS academic_governance_events;
--   DROP TABLE IF EXISTS institution_assignment_targets;
--   ALTER TABLE teacher_interventions DROP COLUMN IF EXISTS institution_assignment_id, DROP COLUMN IF EXISTS owner_scope;
--   DROP TABLE IF EXISTS institution_assignments;
--   ALTER TABLE class_plan_concepts DROP COLUMN IF EXISTS owner_scope, DROP COLUMN IF EXISTS locked_fields, DROP COLUMN IF EXISTS institution_target_date;
--   ALTER TABLE classes DROP COLUMN IF EXISTS institution_curriculum_id;
--   ALTER TABLE institution_curriculum_concepts DROP COLUMN IF EXISTS source, DROP COLUMN IF EXISTS institution_target_date;
--   DROP TABLE IF EXISTS institution_curriculum_objectives;
--   DROP INDEX IF EXISTS uq_institution_curricula_active_v2;
--   ALTER TABLE institution_curricula DROP COLUMN IF EXISTS replaced_by_curriculum_id, DROP COLUMN IF EXISTS academic_programme_id, DROP COLUMN IF EXISTS source_type, DROP COLUMN IF EXISTS owner_scope, DROP COLUMN IF EXISTS provenance, DROP COLUMN IF EXISTS archived_at, DROP COLUMN IF EXISTS archived_by_user_id, DROP COLUMN IF EXISTS archive_reason, DROP COLUMN IF EXISTS updated_by_user_id;
--   CREATE UNIQUE INDEX IF NOT EXISTS uq_institution_curricula_active ON institution_curricula (institution_id, canonical_subject_id, COALESCE(grade_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(academic_year, '')) WHERE status = 'ACTIVE';
--   ALTER TABLE academic_subjects DROP COLUMN IF EXISTS canonical_subject_id;
--   ALTER TABLE academic_organizations DROP COLUMN IF EXISTS parent_organization_id, DROP COLUMN IF EXISTS country, DROP COLUMN IF EXISTS source_type, DROP COLUMN IF EXISTS authority_level, DROP COLUMN IF EXISTS jurisdiction, DROP COLUMN IF EXISTS provenance;
--   ALTER TABLE student_concept_sources DROP CONSTRAINT IF EXISTS student_concept_sources_source_type_check;
--   ALTER TABLE student_concept_sources ADD CONSTRAINT student_concept_sources_source_type_check CHECK (source_type IN ('SELF_SELECTED', 'CURRICULUM_RECOMMENDATION', 'INSTITUTION_CURRICULUM', 'CLASS_PLAN', 'TEACHER_ASSIGNMENT', 'EXAM_GAP', 'PREREQUISITE_RECOMMENDATION')) NOT VALID;
--   ALTER TABLE concepts DROP CONSTRAINT IF EXISTS concepts_origin_check;
--   ALTER TABLE concepts ADD CONSTRAINT concepts_origin_check CHECK (origin IS NULL OR origin IN ('TEACHER_ASSIGNMENT', 'SELF_SELECTED', 'CURRICULUM_RECOMMENDATION', 'INSTITUTION_CURRICULUM', 'CLASS_PLAN', 'EXAM_GAP', 'PREREQUISITE_RECOMMENDATION')) NOT VALID;
--   DELETE FROM schema_migrations WHERE filename = '20261018_1500_track_a_institution_curriculum_v2.sql';
-- ============================================================================

-- 1 ------------------------------------------------------------------------
ALTER TABLE academic_organizations ADD COLUMN IF NOT EXISTS country text;
ALTER TABLE academic_organizations ADD COLUMN IF NOT EXISTS source_type text;
ALTER TABLE academic_organizations ADD COLUMN IF NOT EXISTS authority_level text;
ALTER TABLE academic_organizations ADD COLUMN IF NOT EXISTS parent_organization_id uuid REFERENCES academic_organizations(id);
ALTER TABLE academic_organizations ADD COLUMN IF NOT EXISTS jurisdiction text;
ALTER TABLE academic_organizations ADD COLUMN IF NOT EXISTS provenance jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE academic_organizations DROP CONSTRAINT IF EXISTS academic_organizations_source_type_check;
ALTER TABLE academic_organizations ADD CONSTRAINT academic_organizations_source_type_check
  CHECK (source_type IS NULL OR source_type IN ('GOVERNMENT_AUTHORITY', 'INTERNATIONAL_PROGRAMME', 'INSTITUTION_DEFINED', 'STUDYUS_REFERENCE'));
ALTER TABLE academic_organizations DROP CONSTRAINT IF EXISTS academic_organizations_authority_level_check;
ALTER TABLE academic_organizations ADD CONSTRAINT academic_organizations_authority_level_check
  CHECK (authority_level IS NULL OR authority_level IN ('NATIONAL', 'TERRITORIAL', 'INTERNATIONAL'));

UPDATE academic_organizations SET source_type = 'INTERNATIONAL_PROGRAMME', authority_level = 'INTERNATIONAL'
WHERE source_type IS NULL AND (name ILIKE 'Cambridge%' OR name ILIKE 'International Baccalaureate%' OR name ILIKE 'College Board%' OR name = 'OECD');
UPDATE academic_organizations SET source_type = 'GOVERNMENT_AUTHORITY', authority_level = 'NATIONAL', country = 'CO'
WHERE source_type IS NULL AND name ILIKE 'icfes';

-- 2 ------------------------------------------------------------------------
ALTER TABLE academic_subjects ADD COLUMN IF NOT EXISTS canonical_subject_id uuid REFERENCES canonical_subjects(id);
UPDATE academic_subjects a SET canonical_subject_id = cs.id
FROM canonical_subjects cs
WHERE a.canonical_subject_id IS NULL AND cs.status = 'ACTIVE' AND lower(cs.name) = lower(a.name);
UPDATE academic_subjects a SET canonical_subject_id = (
  SELECT cs.id FROM canonical_subjects cs
  WHERE cs.status = 'ACTIVE' AND lower(a.name) LIKE lower(cs.name) || '%'
  ORDER BY char_length(cs.name) DESC LIMIT 1)
WHERE a.canonical_subject_id IS NULL;

-- 3 ------------------------------------------------------------------------
ALTER TABLE institution_curricula ADD COLUMN IF NOT EXISTS academic_programme_id uuid REFERENCES academic_programmes(id);
ALTER TABLE institution_curricula ADD COLUMN IF NOT EXISTS source_type text;
ALTER TABLE institution_curricula ADD COLUMN IF NOT EXISTS owner_scope text NOT NULL DEFAULT 'INSTITUTION';
ALTER TABLE institution_curricula ADD COLUMN IF NOT EXISTS provenance jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE institution_curricula ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE institution_curricula ADD COLUMN IF NOT EXISTS archived_by_user_id uuid REFERENCES users(id);
ALTER TABLE institution_curricula ADD COLUMN IF NOT EXISTS archive_reason text;
ALTER TABLE institution_curricula ADD COLUMN IF NOT EXISTS replaced_by_curriculum_id uuid REFERENCES institution_curricula(id);
ALTER TABLE institution_curricula ADD COLUMN IF NOT EXISTS updated_by_user_id uuid REFERENCES users(id);
ALTER TABLE institution_curricula DROP CONSTRAINT IF EXISTS institution_curricula_source_type_check;
ALTER TABLE institution_curricula ADD CONSTRAINT institution_curricula_source_type_check
  CHECK (source_type IS NULL OR source_type IN ('GOVERNMENT_AUTHORITY', 'INTERNATIONAL_PROGRAMME', 'INSTITUTION_DEFINED', 'STUDYUS_REFERENCE'));
ALTER TABLE institution_curricula DROP CONSTRAINT IF EXISTS institution_curricula_owner_scope_check;
ALTER TABLE institution_curricula ADD CONSTRAINT institution_curricula_owner_scope_check CHECK (owner_scope IN ('INSTITUTION'));

UPDATE institution_curricula ic SET academic_programme_id = a.programme_id
FROM academic_subjects a WHERE a.id = ic.base_academic_subject_id AND ic.academic_programme_id IS NULL;
UPDATE institution_curricula ic SET source_type = COALESCE((
  SELECT o.source_type FROM academic_programmes p JOIN academic_organizations o ON o.id = p.organization_id WHERE p.id = ic.academic_programme_id), 'INSTITUTION_DEFINED')
WHERE ic.source_type IS NULL;

DROP INDEX IF EXISTS uq_institution_curricula_active;
CREATE UNIQUE INDEX IF NOT EXISTS uq_institution_curricula_active_v2 ON institution_curricula (
  institution_id,
  COALESCE(base_academic_subject_id, canonical_subject_id),
  COALESCE(base_structure_version_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(grade_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(academic_year, '')
) WHERE status = 'ACTIVE';

-- 4 ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS institution_curriculum_objectives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  curriculum_id uuid NOT NULL REFERENCES institution_curricula(id),
  learning_objective_id uuid NOT NULL REFERENCES learning_objectives(id),
  classification text NOT NULL DEFAULT 'RECOMMENDED' CHECK (classification IN ('REQUIRED', 'RECOMMENDED', 'OPTIONAL', 'SUPPLEMENTAL')),
  status text NOT NULL DEFAULT 'INCLUDED' CHECK (status IN ('INCLUDED', 'EXCLUDED')),
  updated_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT institution_curriculum_objectives_unique UNIQUE (curriculum_id, learning_objective_id)
);
INSERT INTO institution_curriculum_objectives (curriculum_id, learning_objective_id)
SELECT ic.id, lo.id
FROM institution_curricula ic
JOIN structure_nodes sn ON sn.structure_version_id = ic.base_structure_version_id
JOIN learning_objectives lo ON lo.structure_node_id = sn.id AND lo.status = 'ACTIVE'
WHERE ic.base_structure_version_id IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE institution_curriculum_concepts ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'INSTITUTION';
ALTER TABLE institution_curriculum_concepts ADD COLUMN IF NOT EXISTS institution_target_date date;
ALTER TABLE institution_curriculum_concepts DROP CONSTRAINT IF EXISTS institution_curriculum_concepts_source_check;
ALTER TABLE institution_curriculum_concepts ADD CONSTRAINT institution_curriculum_concepts_source_check
  CHECK (source IN ('AUTHORITY', 'INSTITUTION', 'TEACHER_SUPPLEMENTAL'));
UPDATE institution_curriculum_concepts icc SET source = 'AUTHORITY'
FROM institution_curricula ic
WHERE ic.id = icc.curriculum_id AND ic.base_structure_version_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM objective_concept_mappings ocm JOIN learning_objectives lo ON lo.id = ocm.learning_objective_id
  JOIN structure_nodes sn ON sn.id = lo.structure_node_id
  WHERE sn.structure_version_id = ic.base_structure_version_id AND ocm.canonical_concept_id = icc.canonical_concept_id AND ocm.status = 'PUBLISHED');

-- 5 ------------------------------------------------------------------------
ALTER TABLE classes ADD COLUMN IF NOT EXISTS institution_curriculum_id uuid REFERENCES institution_curricula(id);
UPDATE classes c SET institution_curriculum_id = (
  SELECT ic.id FROM institution_curricula ic
  WHERE ic.institution_id = c.institution_id AND ic.canonical_subject_id = c.canonical_subject_id AND ic.status = 'ACTIVE'
    AND (ic.grade_id IS NULL OR ic.grade_id = c.grade_id)
  ORDER BY (ic.grade_id IS NOT NULL) DESC, ic.created_at DESC LIMIT 1)
WHERE c.institution_curriculum_id IS NULL AND c.canonical_subject_id IS NOT NULL;

-- 6 ------------------------------------------------------------------------
ALTER TABLE class_plan_concepts ADD COLUMN IF NOT EXISTS owner_scope text NOT NULL DEFAULT 'TEACHER';
ALTER TABLE class_plan_concepts ADD COLUMN IF NOT EXISTS locked_fields text[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE class_plan_concepts ADD COLUMN IF NOT EXISTS institution_target_date date;
ALTER TABLE class_plan_concepts DROP CONSTRAINT IF EXISTS class_plan_concepts_owner_scope_check;
ALTER TABLE class_plan_concepts ADD CONSTRAINT class_plan_concepts_owner_scope_check CHECK (owner_scope IN ('INSTITUTION', 'TEACHER'));

-- 7 ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS institution_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institutions(id),
  canonical_concept_id uuid NOT NULL REFERENCES canonical_concepts(id),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  instructions text,
  starts_at timestamptz,
  due_at timestamptz,
  period text,
  priority text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('HIGH', 'NORMAL', 'LOW')),
  required boolean NOT NULL DEFAULT true,
  delivery_mode text NOT NULL CHECK (delivery_mode IN ('TEACHER_SELECTS_RECIPIENTS', 'DIRECT_ALL_STUDENTS')),
  locked_fields text[] NOT NULL DEFAULT ARRAY['title', 'concept', 'instructions', 'starts_at', 'due_at', 'period', 'priority', 'required', 'delivery_mode']::text[],
  teacher_editable_fields text[] NOT NULL DEFAULT ARRAY['recipients']::text[],
  status text NOT NULL DEFAULT 'PUBLISHED' CHECK (status IN ('PUBLISHED', 'ARCHIVED')),
  request_id uuid UNIQUE,
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT institution_assignments_dates CHECK (starts_at IS NULL OR due_at IS NULL OR due_at > starts_at)
);
CREATE TABLE IF NOT EXISTS institution_assignment_targets (
  assignment_id uuid NOT NULL REFERENCES institution_assignments(id),
  class_id uuid NOT NULL REFERENCES classes(id),
  assignment_group_id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (assignment_id, class_id),
  CONSTRAINT institution_assignment_targets_group_unique UNIQUE (assignment_group_id)
);
ALTER TABLE teacher_interventions ADD COLUMN IF NOT EXISTS owner_scope text NOT NULL DEFAULT 'TEACHER';
ALTER TABLE teacher_interventions ADD COLUMN IF NOT EXISTS institution_assignment_id uuid REFERENCES institution_assignments(id);
ALTER TABLE teacher_interventions DROP CONSTRAINT IF EXISTS teacher_interventions_owner_scope_check;
ALTER TABLE teacher_interventions ADD CONSTRAINT teacher_interventions_owner_scope_check CHECK (owner_scope IN ('INSTITUTION', 'TEACHER'));
CREATE INDEX IF NOT EXISTS idx_teacher_interventions_institution_assignment ON teacher_interventions (institution_assignment_id) WHERE institution_assignment_id IS NOT NULL;

-- 8 ------------------------------------------------------------------------
ALTER TABLE student_concept_sources DROP CONSTRAINT IF EXISTS student_concept_sources_source_type_check;
ALTER TABLE student_concept_sources ADD CONSTRAINT student_concept_sources_source_type_check CHECK (source_type IN (
  'SELF_SELECTED', 'CURRICULUM_RECOMMENDATION', 'INSTITUTION_CURRICULUM', 'CLASS_PLAN', 'TEACHER_ASSIGNMENT', 'EXAM_GAP', 'PREREQUISITE_RECOMMENDATION', 'INSTITUTION_ASSIGNMENT'));
ALTER TABLE concepts DROP CONSTRAINT IF EXISTS concepts_origin_check;
ALTER TABLE concepts ADD CONSTRAINT concepts_origin_check CHECK (
  origin IS NULL OR origin IN ('TEACHER_ASSIGNMENT', 'SELF_SELECTED', 'CURRICULUM_RECOMMENDATION', 'INSTITUTION_CURRICULUM', 'CLASS_PLAN', 'EXAM_GAP', 'PREREQUISITE_RECOMMENDATION', 'INSTITUTION_ASSIGNMENT'));

-- 9 ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS academic_governance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid REFERENCES institutions(id),
  actor_user_id uuid REFERENCES users(id),
  actor_scope text NOT NULL CHECK (actor_scope IN ('AUTHORITY', 'INSTITUTION', 'TEACHER', 'STUDENT', 'PLATFORM')),
  object_type text NOT NULL,
  object_id uuid,
  action text NOT NULL,
  fields text[] NOT NULL DEFAULT '{}'::text[],
  old_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  new_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  outcome text NOT NULL DEFAULT 'APPLIED' CHECK (outcome IN ('APPLIED', 'DENIED')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_academic_governance_events_institution ON academic_governance_events (institution_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_academic_governance_events_object ON academic_governance_events (object_type, object_id);
