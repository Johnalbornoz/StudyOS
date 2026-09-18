-- F6: Curriculum & Standards Mapping -- versioned academic structure and
-- editorial mapping layer, strictly additive. Zero changes to any F0-F5
-- table. Canonical knowledge (F4's canonical_subjects/canonical_concepts/
-- skills/competencies) is never duplicated per framework -- every mapping
-- table here only ever POINTS AT those existing rows (see
-- docs/implementation/f6/F6_CURRENT_CURRICULUM_MAPPING_ASSESSMENT.md and
-- F6_TARGET_ACADEMIC_STRUCTURE.md).
--
-- No table in this migration has a student_id column -- this is entirely
-- canonical/framework-scoped data (INV-F6-15), same discipline as F4.
--
-- Fully idempotent, never applied automatically by build/start -- apply
-- explicitly via `npm run db:migrate`.
-- ---------------------------------------------------------------------

-- --- Organization / Programme / Qualification / Subject (task 6/7) ---

CREATE TABLE IF NOT EXISTS public.academic_organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT academic_organizations_status_check CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED'))
);

-- programme_type is the explicit CURRICULUM / ASSESSMENT_FRAMEWORK /
-- ADMISSION_EXAM classification task 5 requires -- never forced
-- uniformly (e.g. PAA is ADMISSION_EXAM, IB DP is CURRICULUM).
CREATE TABLE IF NOT EXISTS public.academic_programmes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.academic_organizations(id),
  name text NOT NULL,
  programme_type text NOT NULL,
  stage text,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT academic_programmes_type_check CHECK (programme_type IN ('CURRICULUM', 'ASSESSMENT_FRAMEWORK', 'ADMISSION_EXAM')),
  CONSTRAINT academic_programmes_status_check CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED'))
);

-- Optional layer ("where applicable", task 6) -- a programme may have
-- zero qualification children (e.g. PAA).
CREATE TABLE IF NOT EXISTS public.academic_qualifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_id uuid NOT NULL REFERENCES public.academic_programmes(id),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT academic_qualifications_status_check CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED'))
);

CREATE TABLE IF NOT EXISTS public.academic_subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_id uuid NOT NULL REFERENCES public.academic_programmes(id),
  qualification_id uuid REFERENCES public.academic_qualifications(id),
  name text NOT NULL,
  level text,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT academic_subjects_status_check CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED'))
);

-- --- Structure / Structure Version / Structure Node (task 8/9) ---

-- No UNIQUE(academic_subject_id) on status -- multiple versions may
-- coexist (DRAFT being authored while a different version is PUBLISHED);
-- the partial unique index below enforces only "at most one PUBLISHED at
-- a time", never "at most one version ever" (task 7: do not assume two
-- versions share identical structure; INV-F6-09: old versions stay intact).
CREATE TABLE IF NOT EXISTS public.structure_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  academic_subject_id uuid NOT NULL REFERENCES public.academic_subjects(id),
  version_label text NOT NULL,
  effective_from date,
  effective_to date,
  status text NOT NULL DEFAULT 'DRAFT',
  source_locator text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT structure_versions_status_check CHECK (status IN ('DRAFT', 'PUBLISHED', 'SUPERSEDED', 'RETIRED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_structure_versions_one_published
  ON public.structure_versions (academic_subject_id) WHERE status = 'PUBLISHED';

-- node_type is free text on purpose -- never a fixed Chapter/Unit/Topic
-- enum (task 8's explicit instruction). Cycle prevention on parent_id is
-- application-level (recursive CTE, ports F4's
-- canonical_concept_prerequisites pattern verbatim) -- Postgres has no
-- native DAG check, same as that migration's own note.
CREATE TABLE IF NOT EXISTS public.structure_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  structure_version_id uuid NOT NULL REFERENCES public.structure_versions(id),
  parent_id uuid REFERENCES public.structure_nodes(id),
  node_type text NOT NULL,
  source_label text NOT NULL,
  code text,
  order_index integer NOT NULL DEFAULT 0,
  description text,
  source text,
  source_locator text,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT structure_nodes_status_check CHECK (status IN ('ACTIVE', 'RETIRED')),
  CONSTRAINT structure_nodes_no_self_parent CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE INDEX IF NOT EXISTS idx_structure_nodes_version ON public.structure_nodes (structure_version_id);
CREATE INDEX IF NOT EXISTS idx_structure_nodes_parent ON public.structure_nodes (parent_id);
-- Duplicate-code handling scoped per version (task 9) -- two different
-- syllabus versions may legitimately reuse the same official code.
CREATE UNIQUE INDEX IF NOT EXISTS idx_structure_nodes_version_code_unique
  ON public.structure_nodes (structure_version_id, code) WHERE code IS NOT NULL;

-- Reuses the exact four-times-repeated i18n shape already established by
-- concept_localizations/topic_localizations/subtopic_localizations/
-- concept_explanations (task 8's "optional translated label").
CREATE TABLE IF NOT EXISTS public.structure_node_localizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  structure_node_id uuid NOT NULL REFERENCES public.structure_nodes(id),
  language text NOT NULL,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_structure_node_localizations_node ON public.structure_node_localizations (structure_node_id);

-- --- Learning Objectives / Knowledge Requirements (task 10) ---

CREATE TABLE IF NOT EXISTS public.learning_objectives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  structure_node_id uuid NOT NULL REFERENCES public.structure_nodes(id),
  code text,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT learning_objectives_status_check CHECK (status IN ('ACTIVE', 'RETIRED'))
);

CREATE INDEX IF NOT EXISTS idx_learning_objectives_node ON public.learning_objectives (structure_node_id);

-- --- Mapping tables (task 11/12) -- three concrete tables, never one
-- polymorphic edge table, mirroring F4's own canonical_concept_skills /
-- skill_competencies / canonical_concept_competencies precedent for real
-- FK integrity. Identical shape and workflow across all three. ---

CREATE TABLE IF NOT EXISTS public.objective_concept_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learning_objective_id uuid NOT NULL REFERENCES public.learning_objectives(id),
  canonical_concept_id uuid NOT NULL REFERENCES public.canonical_concepts(id),
  relation_type text NOT NULL,
  scope text,
  level text,
  rationale text,
  provenance text NOT NULL DEFAULT 'MANUAL',
  confidence numeric,
  status text NOT NULL DEFAULT 'DRAFT',
  mapping_group_id uuid NOT NULL DEFAULT gen_random_uuid(),
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES public.users(id),
  reviewed_by uuid REFERENCES public.users(id),
  reviewed_at timestamptz,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ocm_relation_type_check CHECK (relation_type IN ('FULL', 'PARTIAL', 'PREREQUISITE', 'SUPPORTING')),
  CONSTRAINT ocm_provenance_check CHECK (provenance IN ('MANUAL', 'AI_SUGGESTED')),
  CONSTRAINT ocm_status_check CHECK (status IN ('DRAFT', 'PROPOSED', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'REJECTED', 'RETIRED')),
  CONSTRAINT ocm_confidence_check CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
);

CREATE INDEX IF NOT EXISTS idx_ocm_objective ON public.objective_concept_mappings (learning_objective_id);
CREATE INDEX IF NOT EXISTS idx_ocm_status ON public.objective_concept_mappings (status);
CREATE INDEX IF NOT EXISTS idx_ocm_group ON public.objective_concept_mappings (mapping_group_id);
-- At most one PUBLISHED mapping per (objective, concept) pair at a time --
-- a version replacement retires the old row first, in the same
-- transaction, before the new one may publish.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ocm_one_published
  ON public.objective_concept_mappings (learning_objective_id, canonical_concept_id) WHERE status = 'PUBLISHED';

CREATE TABLE IF NOT EXISTS public.objective_skill_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learning_objective_id uuid NOT NULL REFERENCES public.learning_objectives(id),
  skill_id uuid NOT NULL REFERENCES public.skills(id),
  relation_type text NOT NULL,
  scope text,
  level text,
  rationale text,
  provenance text NOT NULL DEFAULT 'MANUAL',
  confidence numeric,
  status text NOT NULL DEFAULT 'DRAFT',
  mapping_group_id uuid NOT NULL DEFAULT gen_random_uuid(),
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES public.users(id),
  reviewed_by uuid REFERENCES public.users(id),
  reviewed_at timestamptz,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT osm_relation_type_check CHECK (relation_type IN ('FULL', 'PARTIAL', 'PREREQUISITE', 'SUPPORTING')),
  CONSTRAINT osm_provenance_check CHECK (provenance IN ('MANUAL', 'AI_SUGGESTED')),
  CONSTRAINT osm_status_check CHECK (status IN ('DRAFT', 'PROPOSED', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'REJECTED', 'RETIRED')),
  CONSTRAINT osm_confidence_check CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
);

CREATE INDEX IF NOT EXISTS idx_osm_objective ON public.objective_skill_mappings (learning_objective_id);
CREATE INDEX IF NOT EXISTS idx_osm_status ON public.objective_skill_mappings (status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_osm_one_published
  ON public.objective_skill_mappings (learning_objective_id, skill_id) WHERE status = 'PUBLISHED';

CREATE TABLE IF NOT EXISTS public.objective_competency_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learning_objective_id uuid NOT NULL REFERENCES public.learning_objectives(id),
  competency_id uuid NOT NULL REFERENCES public.competencies(id),
  relation_type text NOT NULL,
  scope text,
  level text,
  rationale text,
  provenance text NOT NULL DEFAULT 'MANUAL',
  confidence numeric,
  status text NOT NULL DEFAULT 'DRAFT',
  mapping_group_id uuid NOT NULL DEFAULT gen_random_uuid(),
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES public.users(id),
  reviewed_by uuid REFERENCES public.users(id),
  reviewed_at timestamptz,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ocpm_relation_type_check CHECK (relation_type IN ('FULL', 'PARTIAL', 'PREREQUISITE', 'SUPPORTING')),
  CONSTRAINT ocpm_provenance_check CHECK (provenance IN ('MANUAL', 'AI_SUGGESTED')),
  CONSTRAINT ocpm_status_check CHECK (status IN ('DRAFT', 'PROPOSED', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'REJECTED', 'RETIRED')),
  CONSTRAINT ocpm_confidence_check CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
);

CREATE INDEX IF NOT EXISTS idx_ocpm_objective ON public.objective_competency_mappings (learning_objective_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ocpm_one_published
  ON public.objective_competency_mappings (learning_objective_id, competency_id) WHERE status = 'PUBLISHED';

-- --- Academic Resources (task 13/26) -- an editorial citation/reference,
-- NOT file storage, and NOT the same thing as a student's private
-- content_sources upload. ---

CREATE TABLE IF NOT EXISTS public.academic_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  resource_type text NOT NULL,
  description text,
  source_locator text,
  status text NOT NULL DEFAULT 'DRAFT',
  resource_group_id uuid NOT NULL DEFAULT gen_random_uuid(),
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES public.users(id),
  reviewed_by uuid REFERENCES public.users(id),
  reviewed_at timestamptz,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT academic_resources_type_check CHECK (resource_type IN ('TEXTBOOK', 'PRACTICE_SET', 'VIDEO', 'ARTICLE', 'OTHER')),
  CONSTRAINT academic_resources_status_check CHECK (status IN ('DRAFT', 'PROPOSED', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'REJECTED', 'RETIRED'))
);

CREATE INDEX IF NOT EXISTS idx_academic_resources_status ON public.academic_resources (status);

CREATE TABLE IF NOT EXISTS public.resource_objective_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  academic_resource_id uuid NOT NULL REFERENCES public.academic_resources(id),
  learning_objective_id uuid NOT NULL REFERENCES public.learning_objectives(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT resource_objective_links_unique UNIQUE (academic_resource_id, learning_objective_id)
);

CREATE INDEX IF NOT EXISTS idx_resource_objective_links_objective ON public.resource_objective_links (learning_objective_id);

-- --- Editorial grants (task 14/32) -- a separate, narrow permission
-- table, never an addition to F1's platform-wide Role enum. Holding
-- TEACHER/INSTITUTION_ADMIN confers zero editorial capability. ---

CREATE TABLE IF NOT EXISTS public.curriculum_editorial_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id),
  grant_role text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  granted_by uuid REFERENCES public.users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT curriculum_editorial_grants_role_check CHECK (grant_role IN ('EDITOR', 'REVIEWER', 'PUBLISHER')),
  CONSTRAINT curriculum_editorial_grants_status_check CHECK (status IN ('ACTIVE', 'REVOKED'))
);

CREATE INDEX IF NOT EXISTS idx_curriculum_editorial_grants_user ON public.curriculum_editorial_grants (user_id, grant_role);

-- --- Coverage policy versioning (task 20/21) -- identical shape to F5's
-- aggregation_policy_versions (retire-and-insert, at most one ACTIVE). ---

CREATE TABLE IF NOT EXISTS public.coverage_policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version integer NOT NULL,
  rules jsonb NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coverage_policy_versions_status_check CHECK (status IN ('ACTIVE', 'RETIRED')),
  CONSTRAINT coverage_policy_versions_version_unique UNIQUE (version)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_coverage_policy_versions_one_active
  ON public.coverage_policy_versions (status) WHERE status = 'ACTIVE';

INSERT INTO public.coverage_policy_versions (version, rules)
VALUES (1, '{"countedMappingStatuses": ["PUBLISHED"], "fullCoverageRelationTypes": ["FULL"], "partialCoverageRelationTypes": ["PARTIAL"], "note": "PREREQUISITE and SUPPORTING relation types never count toward coverage, full or partial"}'::jsonb)
ON CONFLICT (version) DO NOTHING;
