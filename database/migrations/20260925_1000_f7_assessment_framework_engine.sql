-- F7: Assessment Framework Engine -- versioned exam definitions,
-- blueprints, generation/evaluation contracts, strictly additive. Zero
-- changes to any F0-F6 table. Blueprints reference F6's
-- learning_objectives (never curriculum-tree structure_nodes) and F4's
-- canonical_concepts/skills/competencies -- never a duplicated knowledge
-- identity per exam family (see
-- docs/implementation/f7/F7_CURRENT_ASSESSMENT_ARCHITECTURE.md and
-- F7_TARGET_ASSESSMENT_ARCHITECTURE.md).
--
-- No table in this migration has a hard-coded exam-family branch --
-- PAA/IB/Cambridge/Saber are all just rows. Fully idempotent, never
-- applied automatically by build/start -- apply explicitly via
-- `npm run db:migrate`.
-- ---------------------------------------------------------------------

-- --- Exam Definition / Version (task 5/6) ---

CREATE TABLE IF NOT EXISTS public.exam_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  academic_programme_id uuid REFERENCES public.academic_programmes(id),
  name text NOT NULL,
  exam_family text NOT NULL,
  purpose text,
  domains text[],
  status text NOT NULL DEFAULT 'DRAFT',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exam_definitions_status_check CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED'))
);

-- Scoring model is referenced (nullable) by exam_versions -- absence is
-- a real, checkable state (INV-F7-09), never a default formula.
CREATE TABLE IF NOT EXISTS public.scoring_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  scoring_type text NOT NULL,
  config jsonb,
  status text NOT NULL DEFAULT 'DRAFT',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scoring_models_type_check CHECK (scoring_type IN ('BINARY', 'PARTIAL_CREDIT', 'RUBRIC', 'MARK_SCHEME', 'MULTI_PART')),
  CONSTRAINT scoring_models_status_check CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED'))
);

CREATE TABLE IF NOT EXISTS public.exam_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_definition_id uuid NOT NULL REFERENCES public.exam_definitions(id),
  version_label text NOT NULL,
  effective_from date,
  effective_to date,
  navigation_rules jsonb,
  scoring_model_id uuid REFERENCES public.scoring_models(id),
  supported_modalities text[],
  difficulty_scale_notes text,
  status text NOT NULL DEFAULT 'DRAFT',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exam_versions_status_check CHECK (status IN ('DRAFT', 'PUBLISHED', 'SUPERSEDED', 'RETIRED'))
);

-- At most one PUBLISHED version per exam definition at a time -- same
-- discipline as F6's structure_versions (publishing supersedes, never
-- deletes).
CREATE UNIQUE INDEX IF NOT EXISTS idx_exam_versions_one_published
  ON public.exam_versions (exam_definition_id) WHERE status = 'PUBLISHED';

-- --- Assessment Component (task 7) ---

CREATE TABLE IF NOT EXISTS public.assessment_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_version_id uuid NOT NULL REFERENCES public.exam_versions(id),
  name text NOT NULL,
  component_type text NOT NULL,
  modality text,
  academic_subject_id uuid REFERENCES public.academic_subjects(id),
  timing_status text NOT NULL DEFAULT 'NOT_CONFIGURED',
  duration_minutes integer,
  tool_rule_status text NOT NULL DEFAULT 'NOT_CONFIGURED',
  tool_rules jsonb,
  rubric_reference text,
  procedure_required boolean NOT NULL DEFAULT false,
  simulation_capable boolean NOT NULL DEFAULT false,
  support_status text NOT NULL DEFAULT 'UNSUPPORTED',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assessment_components_type_check CHECK (component_type IN ('SECTION', 'PAPER', 'WRITTEN', 'ORAL', 'PRACTICAL', 'COURSEWORK')),
  CONSTRAINT assessment_components_timing_status_check CHECK (timing_status IN ('NOT_CONFIGURED', 'CONFIGURED')),
  CONSTRAINT assessment_components_tool_rule_status_check CHECK (tool_rule_status IN ('NOT_CONFIGURED', 'CONFIGURED')),
  CONSTRAINT assessment_components_support_status_check CHECK (support_status IN ('UNSUPPORTED', 'SUPPORTED')),
  -- INV-F7-08/09: an unconfigured status must never carry rule/duration
  -- data, and a configured status must actually have it. Never invented,
  -- never silently ignored.
  CONSTRAINT assessment_components_timing_consistency CHECK (
    (timing_status = 'NOT_CONFIGURED' AND duration_minutes IS NULL) OR
    (timing_status = 'CONFIGURED' AND duration_minutes IS NOT NULL)
  ),
  CONSTRAINT assessment_components_tool_rule_consistency CHECK (
    (tool_rule_status = 'NOT_CONFIGURED' AND tool_rules IS NULL) OR
    (tool_rule_status = 'CONFIGURED' AND tool_rules IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_assessment_components_version ON public.assessment_components (exam_version_id);

-- --- Command Terms (task 11) -- generalizes the existing IB-specific
-- commandTermsForDifficulty() pattern into framework-agnostic data. ---

CREATE TABLE IF NOT EXISTS public.command_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  term text NOT NULL UNIQUE,
  expected_reasoning_type text,
  description text,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT command_terms_status_check CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED'))
);

-- --- Blueprint (task 8/9) ---

CREATE TABLE IF NOT EXISTS public.assessment_blueprints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_version_id uuid NOT NULL UNIQUE REFERENCES public.exam_versions(id),
  status text NOT NULL DEFAULT 'DRAFT',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assessment_blueprints_status_check CHECK (status IN ('DRAFT', 'PUBLISHED', 'RETIRED'))
);

CREATE TABLE IF NOT EXISTS public.blueprint_component_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blueprint_id uuid NOT NULL REFERENCES public.assessment_blueprints(id),
  assessment_component_id uuid NOT NULL REFERENCES public.assessment_components(id),
  item_count integer,
  weight numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT blueprint_component_allocations_unique UNIQUE (blueprint_id, assessment_component_id)
);

-- Never a structure_node_id -- blueprints sample F6's learning_objectives
-- directly, never curriculum-tree position (INV-F6-05/INV-F7-05, task
-- adversarial case K).
CREATE TABLE IF NOT EXISTS public.blueprint_objective_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blueprint_id uuid NOT NULL REFERENCES public.assessment_blueprints(id),
  learning_objective_id uuid NOT NULL REFERENCES public.learning_objectives(id),
  assessment_component_id uuid NOT NULL REFERENCES public.assessment_components(id),
  target_item_count integer,
  question_type text,
  command_term_id uuid REFERENCES public.command_terms(id),
  reasoning_requirement text,
  difficulty_min integer,
  difficulty_max integer,
  skill_id uuid REFERENCES public.skills(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT blueprint_objective_targets_difficulty_min_check CHECK (difficulty_min IS NULL OR (difficulty_min BETWEEN 1 AND 5)),
  CONSTRAINT blueprint_objective_targets_difficulty_max_check CHECK (difficulty_max IS NULL OR (difficulty_max BETWEEN 1 AND 5))
);

CREATE INDEX IF NOT EXISTS idx_blueprint_objective_targets_blueprint ON public.blueprint_objective_targets (blueprint_id);
CREATE INDEX IF NOT EXISTS idx_blueprint_objective_targets_objective ON public.blueprint_objective_targets (learning_objective_id);

-- --- Approved Item Bank / Family (task 24) -- own independent workflow,
-- never inherited from F6 mapping approval (INV-F7-14). ---

CREATE TABLE IF NOT EXISTS public.approved_item_families (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learning_objective_id uuid NOT NULL REFERENCES public.learning_objectives(id),
  family_key text NOT NULL,
  parameterization jsonb,
  status text NOT NULL DEFAULT 'DRAFT',
  created_by uuid NOT NULL REFERENCES public.users(id),
  reviewed_by uuid REFERENCES public.users(id),
  reviewed_at timestamptz,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT approved_item_families_status_check CHECK (status IN ('DRAFT', 'PROPOSED', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'REJECTED', 'RETIRED'))
);

CREATE TABLE IF NOT EXISTS public.approved_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approved_item_family_id uuid REFERENCES public.approved_item_families(id),
  learning_objective_id uuid NOT NULL REFERENCES public.learning_objectives(id),
  question_type text NOT NULL,
  content jsonb NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  created_by uuid NOT NULL REFERENCES public.users(id),
  reviewed_by uuid REFERENCES public.users(id),
  reviewed_at timestamptz,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT approved_items_status_check CHECK (status IN ('DRAFT', 'PROPOSED', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'REJECTED', 'RETIRED'))
);

CREATE INDEX IF NOT EXISTS idx_approved_items_objective ON public.approved_items (learning_objective_id);

-- --- Student Exam Profile / Preparation Goal (task 18/19) ---

CREATE TABLE IF NOT EXISTS public.student_exam_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id),
  exam_definition_id uuid NOT NULL REFERENCES public.exam_definitions(id),
  exam_version_id uuid REFERENCES public.exam_versions(id),
  purpose text,
  programme_context text,
  subject_focus text,
  exam_date date,
  timezone text,
  institution_target_id uuid REFERENCES public.academic_organizations(id),
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT student_exam_profiles_status_check CHECK (status IN ('ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED'))
);

CREATE INDEX IF NOT EXISTS idx_student_exam_profiles_student ON public.student_exam_profiles (student_id);

CREATE TABLE IF NOT EXISTS public.preparation_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_exam_profile_id uuid NOT NULL REFERENCES public.student_exam_profiles(id),
  goal_type text NOT NULL,
  target_value text,
  competency_id uuid REFERENCES public.competencies(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT preparation_goals_type_check CHECK (goal_type IN ('TARGET_SCORE', 'TARGET_GRADE', 'PERFORMANCE_LEVEL', 'COMPETENCY_TARGET'))
);

-- --- Institution Exam Policy (task 20/22) -- separate from the exam
-- itself, versioned like F6's mappings. ---

CREATE TABLE IF NOT EXISTS public.institution_exam_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES public.institutions(id),
  exam_definition_id uuid NOT NULL REFERENCES public.exam_definitions(id),
  exam_version_id uuid REFERENCES public.exam_versions(id),
  admission_context text,
  verification_status text NOT NULL DEFAULT 'POLICY_PENDING',
  source_locator text,
  effective_from date,
  effective_to date,
  sections_considered jsonb,
  threshold_rules jsonb,
  status text NOT NULL DEFAULT 'DRAFT',
  policy_group_id uuid NOT NULL DEFAULT gen_random_uuid(),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT institution_exam_policies_verification_status_check CHECK (verification_status IN ('POLICY_PENDING', 'VERIFIED')),
  CONSTRAINT institution_exam_policies_status_check CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED')),
  -- INV-F7-07/AC-F7-07: threshold rules are only meaningful once
  -- verified -- never populated while POLICY_PENDING.
  CONSTRAINT institution_exam_policies_threshold_requires_verification CHECK (
    threshold_rules IS NULL OR verification_status = 'VERIFIED'
  )
);

CREATE INDEX IF NOT EXISTS idx_institution_exam_policies_institution ON public.institution_exam_policies (institution_id);
CREATE INDEX IF NOT EXISTS idx_institution_exam_policies_exam ON public.institution_exam_policies (exam_definition_id);

-- --- Exam Attempt (task 30) -- freezes every version reference used at
-- start time, plus a full config snapshot as a belt-and-suspenders
-- guarantee against any future reinterpretation of those version rows. ---

CREATE TABLE IF NOT EXISTS public.exam_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_exam_profile_id uuid NOT NULL REFERENCES public.student_exam_profiles(id),
  exam_version_id uuid NOT NULL REFERENCES public.exam_versions(id),
  blueprint_id uuid REFERENCES public.assessment_blueprints(id),
  institution_exam_policy_id uuid REFERENCES public.institution_exam_policies(id),
  scoring_model_id uuid REFERENCES public.scoring_models(id),
  frozen_configuration jsonb NOT NULL,
  status text NOT NULL DEFAULT 'IN_PROGRESS',
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exam_attempts_status_check CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'ABANDONED'))
);

CREATE INDEX IF NOT EXISTS idx_exam_attempts_profile ON public.exam_attempts (student_exam_profile_id);

CREATE TABLE IF NOT EXISTS public.exam_attempt_item_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_attempt_id uuid NOT NULL REFERENCES public.exam_attempts(id),
  assessment_component_id uuid NOT NULL REFERENCES public.assessment_components(id),
  learning_objective_id uuid REFERENCES public.learning_objectives(id),
  approved_item_id uuid REFERENCES public.approved_items(id),
  item_snapshot jsonb NOT NULL,
  raw_response jsonb,
  score numeric,
  max_score numeric,
  criteria_breakdown jsonb,
  feedback text,
  evaluation_model_version text,
  evaluation_provenance jsonb,
  reasoning_trace jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exam_attempt_item_responses_attempt ON public.exam_attempt_item_responses (exam_attempt_id);

-- --- Fixture command terms (small, reviewed -- generalizes the existing
-- IB-specific vocabulary, task 11) ---

INSERT INTO public.command_terms (term, expected_reasoning_type)
VALUES
  ('define', 'FACTUAL'),
  ('explain', 'CONCEPTUAL'),
  ('compare', 'CONCEPTUAL'),
  ('analyze', 'CONCEPTUAL'),
  ('justify', 'METACOGNITIVE'),
  ('evaluate', 'METACOGNITIVE')
ON CONFLICT (term) DO NOTHING;
