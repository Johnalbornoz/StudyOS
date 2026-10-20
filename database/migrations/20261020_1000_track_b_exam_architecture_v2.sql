-- Track B -- Exam & Assessment Architecture V2 (DEV).
--
-- Strictly additive on top of F6/F7/F9 + Track B V1 (20261019_1000):
-- new tables, nullable columns, no dropped / retyped / narrowed object, no
-- rewritten value. Never applied automatically -- governed runner only.
-- See docs/exams/v2/EXAM_ARCHITECTURE_V2_AUDIT.md (MIGRATION_PLAN).
--
-- Rollback (DEV only, manual, in this order):
--   DROP TABLE IF EXISTS public.assessment_calibration_runs, public.assessment_calibration_cases,
--     public.exam_item_usage, public.learning_concept_proposal_requests, public.learning_concept_proposals,
--     public.exam_submission_artifacts, public.exam_submissions, public.exam_media_objects,
--     public.exam_response_assessments, public.exam_instances, public.assessment_structure_nodes,
--     public.assessment_sources;
--   ALTER TABLE public.exam_attempt_results DROP COLUMN IF EXISTS strict_readiness, DROP COLUMN IF EXISTS review_required_count;
--   ALTER TABLE public.exam_attempt_item_responses DROP COLUMN IF EXISTS normalized_response, DROP COLUMN IF EXISTS grading_detail,
--     DROP COLUMN IF EXISTS review_status, DROP COLUMN IF EXISTS content_origin, DROP COLUMN IF EXISTS scoring_strategy, DROP COLUMN IF EXISTS strict_score;
--   ALTER TABLE public.approved_items DROP COLUMN IF EXISTS content_origin, DROP COLUMN IF EXISTS difficulty_index,
--     DROP COLUMN IF EXISTS semantic_fingerprint, DROP COLUMN IF EXISTS template_fingerprint, DROP COLUMN IF EXISTS reasoning_fingerprint,
--     DROP COLUMN IF EXISTS stimulus_fingerprint, DROP COLUMN IF EXISTS source_ids;
--   ALTER TABLE public.assessment_components DROP COLUMN IF EXISTS definition, DROP COLUMN IF EXISTS max_marks, DROP COLUMN IF EXISTS weighting_percent,
--     DROP COLUMN IF EXISTS calculator_policy, DROP COLUMN IF EXISTS target_difficulty_index, DROP COLUMN IF EXISTS source_ids;
--   ALTER TABLE public.exam_versions DROP COLUMN IF EXISTS curriculum_version, DROP COLUMN IF EXISTS first_assessment, DROP COLUMN IF EXISTS last_assessment,
--     DROP COLUMN IF EXISTS syllabus_code, DROP COLUMN IF EXISTS framework_version, DROP COLUMN IF EXISTS source_ids;
--   DELETE FROM public.schema_migrations WHERE version = '20261020_1000';
-- ---------------------------------------------------------------------

-- --- 4. Assessment source registry ---
CREATE TABLE IF NOT EXISTS public.assessment_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key text NOT NULL UNIQUE,
  framework text NOT NULL,
  title text NOT NULL,
  publisher text,
  url text,
  document_version text,
  publication_year integer,
  effective_session text,
  verified_at timestamptz,
  confidence text NOT NULL DEFAULT 'UNVERIFIED',
  license_status text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assessment_sources_confidence_check CHECK (confidence IN ('HIGH', 'MEDIUM', 'LOW', 'UNVERIFIED')),
  CONSTRAINT assessment_sources_license_check CHECK (license_status IN ('PUBLIC', 'LICENSED', 'GENERATED', 'INTERNAL'))
);

-- --- 1/2. Generic, typed assessment hierarchy (framework terminology in label) ---
CREATE TABLE IF NOT EXISTS public.assessment_structure_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family text NOT NULL,
  parent_id uuid REFERENCES public.assessment_structure_nodes(id),
  node_key text NOT NULL,
  node_type text NOT NULL,
  label text NOT NULL,
  labels jsonb,
  description text,
  order_index integer NOT NULL DEFAULT 0,
  curriculum_version text,
  first_assessment integer,
  last_assessment integer,
  syllabus_code text,
  framework_version text,
  exam_definition_id uuid REFERENCES public.exam_definitions(id),
  exam_version_id uuid REFERENCES public.exam_versions(id),
  assessment_component_id uuid REFERENCES public.assessment_components(id),
  learning_objective_id uuid REFERENCES public.learning_objectives(id),
  selectable boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'ACTIVE',
  source_ids uuid[] NOT NULL DEFAULT '{}',
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assessment_structure_nodes_key UNIQUE (family, node_key),
  CONSTRAINT assessment_structure_nodes_no_self_parent CHECK (parent_id IS NULL OR parent_id <> id),
  CONSTRAINT assessment_structure_nodes_status_check CHECK (status IN ('ACTIVE', 'RETIRED')),
  CONSTRAINT assessment_structure_nodes_assessment_window CHECK (last_assessment IS NULL OR first_assessment IS NULL OR last_assessment >= first_assessment),
  CONSTRAINT assessment_structure_nodes_type_check CHECK (node_type IN (
    'PROGRAMME', 'QUALIFICATION', 'TEST', 'SUBJECT', 'AREA', 'LEVEL', 'VARIANT', 'PAPER', 'COMPONENT', 'SECTION',
    'DOMAIN', 'PROCESS', 'CONTEXT', 'COMPETENCY', 'ASSERTION', 'EVIDENCE', 'PORTFOLIO', 'PERFORMANCE', 'PROJECT'))
);
CREATE INDEX IF NOT EXISTS idx_assessment_structure_nodes_parent ON public.assessment_structure_nodes (parent_id, order_index);
CREATE INDEX IF NOT EXISTS idx_assessment_structure_nodes_family_root ON public.assessment_structure_nodes (family) WHERE parent_id IS NULL;

-- --- 3. Mandatory versioning metadata ---
ALTER TABLE public.exam_versions ADD COLUMN IF NOT EXISTS curriculum_version text;
ALTER TABLE public.exam_versions ADD COLUMN IF NOT EXISTS first_assessment integer;
ALTER TABLE public.exam_versions ADD COLUMN IF NOT EXISTS last_assessment integer;
ALTER TABLE public.exam_versions ADD COLUMN IF NOT EXISTS syllabus_code text;
ALTER TABLE public.exam_versions ADD COLUMN IF NOT EXISTS framework_version text;
ALTER TABLE public.exam_versions ADD COLUMN IF NOT EXISTS source_ids uuid[] NOT NULL DEFAULT '{}';

-- --- 5. Component definition contract ---
ALTER TABLE public.assessment_components ADD COLUMN IF NOT EXISTS definition jsonb;
ALTER TABLE public.assessment_components ADD COLUMN IF NOT EXISTS max_marks numeric;
ALTER TABLE public.assessment_components ADD COLUMN IF NOT EXISTS weighting_percent numeric;
ALTER TABLE public.assessment_components ADD COLUMN IF NOT EXISTS calculator_policy text;
ALTER TABLE public.assessment_components ADD COLUMN IF NOT EXISTS target_difficulty_index numeric;
ALTER TABLE public.assessment_components ADD COLUMN IF NOT EXISTS source_ids uuid[] NOT NULL DEFAULT '{}';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assessment_components_calculator_policy_check') THEN
    ALTER TABLE public.assessment_components ADD CONSTRAINT assessment_components_calculator_policy_check
      CHECK (calculator_policy IS NULL OR calculator_policy IN ('NONE', 'ALLOWED', 'SCIENTIFIC_REQUIRED', 'GDC_REQUIRED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assessment_components_weighting_check') THEN
    ALTER TABLE public.assessment_components ADD CONSTRAINT assessment_components_weighting_check
      CHECK (weighting_percent IS NULL OR (weighting_percent >= 0 AND weighting_percent <= 100));
  END IF;
END $$;

-- --- 33/34/46. Item difficulty, novelty fingerprints, content origin ---
ALTER TABLE public.approved_items ADD COLUMN IF NOT EXISTS content_origin text;
ALTER TABLE public.approved_items ADD COLUMN IF NOT EXISTS difficulty_index numeric;
ALTER TABLE public.approved_items ADD COLUMN IF NOT EXISTS semantic_fingerprint text;
ALTER TABLE public.approved_items ADD COLUMN IF NOT EXISTS template_fingerprint text;
ALTER TABLE public.approved_items ADD COLUMN IF NOT EXISTS reasoning_fingerprint text;
ALTER TABLE public.approved_items ADD COLUMN IF NOT EXISTS stimulus_fingerprint text;
ALTER TABLE public.approved_items ADD COLUMN IF NOT EXISTS source_ids uuid[] NOT NULL DEFAULT '{}';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approved_items_content_origin_check') THEN
    ALTER TABLE public.approved_items ADD CONSTRAINT approved_items_content_origin_check
      CHECK (content_origin IS NULL OR content_origin IN ('OFFICIAL', 'LICENSED', 'GENERATED', 'FIXTURE'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_approved_items_template_fp ON public.approved_items (template_fingerprint) WHERE template_fingerprint IS NOT NULL;

-- --- 31/42/43/44. Exam instances: Practice / Mock / Challenge, frozen form, lifecycle ---
CREATE TABLE IF NOT EXISTS public.exam_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id),
  exam_profile_id uuid NOT NULL REFERENCES public.student_exam_profiles(id),
  exam_version_id uuid NOT NULL REFERENCES public.exam_versions(id),
  structure_node_id uuid REFERENCES public.assessment_structure_nodes(id),
  component_ids uuid[] NOT NULL,
  mode text NOT NULL,
  rigor text NOT NULL DEFAULT 'OFFICIAL_FIDELITY',
  practice_level text,
  timing_mode text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  form jsonb,
  form_frozen_at timestamptz,
  difficulty_index numeric,
  simulation_attempt_id uuid UNIQUE REFERENCES public.simulation_attempts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  deleted_at timestamptz,
  delete_reason text,
  CONSTRAINT exam_instances_mode_check CHECK (mode IN ('PRACTICE', 'MOCK', 'CHALLENGE')),
  CONSTRAINT exam_instances_rigor_check CHECK (rigor IN ('OFFICIAL_FIDELITY', 'STRICT_READINESS')),
  CONSTRAINT exam_instances_level_check CHECK (practice_level IS NULL OR practice_level IN ('FOUNDATION', 'STANDARD', 'ADVANCED', 'CHALLENGE')),
  CONSTRAINT exam_instances_status_check CHECK (status IN ('DRAFT', 'READY', 'IN_PROGRESS', 'COMPLETED', 'ARCHIVED', 'DELETED')),
  CONSTRAINT exam_instances_timing_check CHECK (timing_mode IN ('UNTIMED', 'TRAINING_TIMED', 'OFFICIAL_SIMULATION_TIMED')),
  CONSTRAINT exam_instances_components_present CHECK (cardinality(component_ids) >= 1),
  CONSTRAINT exam_instances_deleted_consistency CHECK ((status = 'DELETED') = (deleted_at IS NOT NULL)),
  CONSTRAINT exam_instances_mock_frozen CHECK (mode = 'PRACTICE' OR status IN ('DRAFT', 'DELETED') OR form_frozen_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_exam_instances_student ON public.exam_instances (student_id, created_at DESC) WHERE status <> 'DELETED';
CREATE INDEX IF NOT EXISTS idx_exam_instances_profile ON public.exam_instances (exam_profile_id);

-- --- 24/36. Auditable grading: per-response detail + independent assessments ---
ALTER TABLE public.exam_attempt_item_responses ADD COLUMN IF NOT EXISTS normalized_response jsonb;
ALTER TABLE public.exam_attempt_item_responses ADD COLUMN IF NOT EXISTS grading_detail jsonb;
ALTER TABLE public.exam_attempt_item_responses ADD COLUMN IF NOT EXISTS review_status text;
ALTER TABLE public.exam_attempt_item_responses ADD COLUMN IF NOT EXISTS content_origin text;
ALTER TABLE public.exam_attempt_item_responses ADD COLUMN IF NOT EXISTS scoring_strategy text;
ALTER TABLE public.exam_attempt_item_responses ADD COLUMN IF NOT EXISTS strict_score numeric;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exam_attempt_item_responses_review_status_check') THEN
    ALTER TABLE public.exam_attempt_item_responses ADD CONSTRAINT exam_attempt_item_responses_review_status_check
      CHECK (review_status IS NULL OR review_status IN ('NONE', 'REVIEW_REQUIRED', 'REVIEWED'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.exam_response_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id uuid REFERENCES public.exam_attempt_item_responses(id),
  submission_id uuid,
  role text NOT NULL,
  provider text,
  model text,
  prompt_id text,
  prompt_version text,
  rubric_ref text,
  criterion_scores jsonb NOT NULL,
  total numeric NOT NULL,
  max_total numeric NOT NULL,
  confidence numeric,
  rationale text,
  evidence jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exam_response_assessments_role_check CHECK (role IN ('DETERMINISTIC', 'ASSESSOR_A', 'ASSESSOR_B', 'ADJUDICATOR')),
  CONSTRAINT exam_response_assessments_target CHECK (response_id IS NOT NULL OR submission_id IS NOT NULL),
  CONSTRAINT exam_response_assessments_bounds CHECK (total >= 0 AND max_total >= 0 AND total <= max_total),
  CONSTRAINT exam_response_assessments_confidence CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
);
CREATE INDEX IF NOT EXISTS idx_exam_response_assessments_response ON public.exam_response_assessments (response_id);
CREATE INDEX IF NOT EXISTS idx_exam_response_assessments_submission ON public.exam_response_assessments (submission_id);

ALTER TABLE public.exam_attempt_results ADD COLUMN IF NOT EXISTS strict_readiness jsonb;
ALTER TABLE public.exam_attempt_results ADD COLUMN IF NOT EXISTS review_required_count integer;

-- --- 13/14. Multimodal media (owner-scoped; DEV backend stores bytes in Postgres, never a public bucket) ---
CREATE TABLE IF NOT EXISTS public.exam_media_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_student_id uuid NOT NULL REFERENCES public.students(id),
  storage_backend text NOT NULL,
  bytes bytea,
  mime_type text NOT NULL,
  declared_mime text,
  size_bytes integer NOT NULL,
  sha256 text NOT NULL,
  original_name text,
  width integer,
  height integer,
  thumbnail bytea,
  thumbnail_mime text,
  scan_status text NOT NULL DEFAULT 'PENDING',
  scan_detail text,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT exam_media_objects_backend_check CHECK (storage_backend IN ('POSTGRES_DEV')),
  CONSTRAINT exam_media_objects_scan_check CHECK (scan_status IN ('PENDING', 'CLEAN', 'REJECTED', 'UNSCANNABLE')),
  CONSTRAINT exam_media_objects_status_check CHECK (status IN ('ACTIVE', 'DELETED')),
  CONSTRAINT exam_media_objects_size_check CHECK (size_bytes > 0 AND size_bytes <= 4194304),
  CONSTRAINT exam_media_objects_deleted_consistency CHECK ((status = 'DELETED') = (deleted_at IS NOT NULL)),
  CONSTRAINT exam_media_objects_purged_when_deleted CHECK (status = 'ACTIVE' OR (bytes IS NULL AND thumbnail IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_exam_media_objects_owner ON public.exam_media_objects (owner_student_id) WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS public.exam_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id),
  exam_instance_id uuid NOT NULL REFERENCES public.exam_instances(id),
  assessment_component_id uuid NOT NULL REFERENCES public.assessment_components(id),
  target_index integer NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  statement text,
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  deleted_at timestamptz,
  CONSTRAINT exam_submissions_status_check CHECK (status IN ('DRAFT', 'SUBMITTED', 'ASSESSED', 'REVIEW_REQUIRED', 'DELETED')),
  CONSTRAINT exam_submissions_one_per_task UNIQUE (exam_instance_id, target_index)
);

CREATE TABLE IF NOT EXISTS public.exam_submission_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.exam_submissions(id),
  media_object_id uuid REFERENCES public.exam_media_objects(id),
  kind text NOT NULL,
  caption text,
  text_content text,
  order_index integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exam_submission_artifacts_kind_check CHECK (kind IN ('IMAGE', 'PDF', 'TEXT', 'AUDIO', 'VIDEO', 'PRESENTATION', 'PORTFOLIO_PAGE', 'STATEMENT', 'PROCESS_EVIDENCE', 'BIBLIOGRAPHY')),
  CONSTRAINT exam_submission_artifacts_payload CHECK (media_object_id IS NOT NULL OR text_content IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_exam_submission_artifacts_submission ON public.exam_submission_artifacts (submission_id, order_index);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exam_response_assessments_submission_fk') THEN
    ALTER TABLE public.exam_response_assessments ADD CONSTRAINT exam_response_assessments_submission_fk
      FOREIGN KEY (submission_id) REFERENCES public.exam_submissions(id);
  END IF;
END $$;

-- --- 40. Learning concept proposals (governed; never auto-creates a canonical concept) ---
CREATE TABLE IF NOT EXISTS public.learning_concept_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_key text NOT NULL UNIQUE,
  proposed_title text NOT NULL,
  definition text,
  subject_name text,
  topic text,
  framework text,
  source_exam_version_id uuid REFERENCES public.exam_versions(id),
  source_item_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  learning_objective_id uuid REFERENCES public.learning_objectives(id),
  skill_id uuid REFERENCES public.skills(id),
  competency_id uuid REFERENCES public.competencies(id),
  prerequisites jsonb,
  confidence numeric,
  rationale text,
  status text NOT NULL DEFAULT 'PROPOSED',
  mapped_canonical_concept_id uuid REFERENCES public.canonical_concepts(id),
  decided_by uuid REFERENCES public.users(id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT learning_concept_proposals_status_check CHECK (status IN ('PROPOSED', 'MAPPED_TO_EXISTING', 'APPROVED_NEW', 'MERGED', 'REJECTED')),
  CONSTRAINT learning_concept_proposals_mapping_consistency CHECK (status <> 'MAPPED_TO_EXISTING' OR mapped_canonical_concept_id IS NOT NULL),
  CONSTRAINT learning_concept_proposals_confidence CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
);
CREATE TABLE IF NOT EXISTS public.learning_concept_proposal_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL REFERENCES public.learning_concept_proposals(id),
  student_id uuid NOT NULL REFERENCES public.students(id),
  exam_attempt_id uuid REFERENCES public.exam_attempts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT learning_concept_proposal_requests_once UNIQUE (proposal_id, student_id)
);

-- --- 34. Item usage history (novelty) ---
CREATE TABLE IF NOT EXISTS public.exam_item_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id),
  approved_item_id uuid REFERENCES public.approved_items(id),
  semantic_fingerprint text,
  template_fingerprint text,
  exam_instance_id uuid REFERENCES public.exam_instances(id),
  used_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_exam_item_usage_student ON public.exam_item_usage (student_id, template_fingerprint);

-- --- 23. Calibration suite ---
CREATE TABLE IF NOT EXISTS public.assessment_calibration_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_key text NOT NULL UNIQUE,
  framework text NOT NULL,
  component_ref text NOT NULL,
  origin text NOT NULL,
  item_content jsonb NOT NULL,
  response jsonb NOT NULL,
  expected_marks numeric NOT NULL,
  max_marks numeric NOT NULL,
  expected_criteria jsonb,
  source_id uuid REFERENCES public.assessment_sources(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assessment_calibration_cases_origin_check CHECK (origin IN ('OFFICIAL_EXEMPLAR', 'RELEASED_SAMPLE', 'BENCHMARK_FIXTURE')),
  CONSTRAINT assessment_calibration_cases_marks CHECK (expected_marks >= 0 AND expected_marks <= max_marks)
);
CREATE TABLE IF NOT EXISTS public.assessment_calibration_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_key text NOT NULL UNIQUE,
  grader_version text NOT NULL,
  case_count integer NOT NULL,
  metrics jsonb NOT NULL,
  case_results jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
