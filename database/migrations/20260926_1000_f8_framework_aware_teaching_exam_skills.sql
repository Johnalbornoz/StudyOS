-- F8 -- Framework-Aware Teaching & Exam Skills.
--
-- Purely additive. Zero changes to any Canonical V2, F4, F5, F6, or F7
-- table. Every new table here is either (a) a versioned policy table
-- following F5's aggregation_policy_versions idiom exactly (one ACTIVE
-- row per policy family, partial unique index, append-only history),
-- (b) an append-only diagnosis/session/attempt record, or (c) a small
-- reference table additive to F7's command_terms.
--
-- Diagnosis and intervention selection never write Canonical V2 stage
-- state directly (INV-F8-01/02) -- see src/lib/diagnostics and
-- src/lib/teaching, which read learning_evidence and
-- getCanonicalPedagogicalDecision() but write only the tables below,
-- then hand off to the REAL, UNMODIFIED updateMastery() for any new
-- Evidence.

-- --- Diagnostic policy versioning (task 10, mirrors F5's
-- aggregation_policy_versions) ---

CREATE TABLE IF NOT EXISTS public.diagnostic_policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version integer NOT NULL UNIQUE,
  rules jsonb NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  effective_from timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT diagnostic_policy_versions_status_check CHECK (status IN ('ACTIVE', 'RETIRED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_diagnostic_policy_versions_one_active
  ON public.diagnostic_policy_versions ((1)) WHERE status = 'ACTIVE';

-- --- Gap diagnoses (task 5, append-only -- a diagnosis is NEVER
-- updated in place; a re-run always inserts a new row) ---

CREATE TABLE IF NOT EXISTS public.learner_gap_diagnoses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id),
  concept_id uuid NOT NULL,
  subject_id uuid,
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  primary_gap_type text NOT NULL,
  secondary_signals text[] NOT NULL DEFAULT '{}',
  confidence numeric(4,3) NOT NULL,
  supporting_evidence_ids uuid[] NOT NULL DEFAULT '{}',
  contradicting_evidence_ids uuid[] NOT NULL DEFAULT '{}',
  reason_codes text[] NOT NULL DEFAULT '{}',
  alternatives jsonb NOT NULL DEFAULT '[]'::jsonb,
  policy_version_id uuid NOT NULL REFERENCES public.diagnostic_policy_versions(id),
  canonical_context jsonb,
  computed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT learner_gap_diagnoses_primary_gap_type_check CHECK (primary_gap_type IN
    ('KNOWLEDGE_GAP', 'SKILL_GAP', 'EXAM_TECHNIQUE_GAP', 'SPEED_FLUENCY_GAP', 'MIXED', 'INSUFFICIENT_EVIDENCE')),
  CONSTRAINT learner_gap_diagnoses_confidence_check CHECK (confidence >= 0 AND confidence <= 1)
);

CREATE INDEX IF NOT EXISTS idx_learner_gap_diagnoses_student_concept
  ON public.learner_gap_diagnoses (student_id, concept_id, computed_at DESC);

-- --- Intervention policy versioning (task 13, same idiom) ---

CREATE TABLE IF NOT EXISTS public.intervention_policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version integer NOT NULL UNIQUE,
  rules jsonb NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  effective_from timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT intervention_policy_versions_status_check CHECK (status IN ('ACTIVE', 'RETIRED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_intervention_policy_versions_one_active
  ON public.intervention_policy_versions ((1)) WHERE status = 'ACTIVE';

-- --- Intervention sessions + attempts (task 30, structural precedent:
-- F7's exam_attempts/exam_attempt_item_responses -- one frozen "launch"
-- row + append-only child attempt rows. NOT an extension of
-- quiz_sessions, which is quiz-shaped and has no diagnosis linkage;
-- see F8_EXAM_SKILLS_MODEL.md for the full rationale.) ---

CREATE TABLE IF NOT EXISTS public.intervention_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id),
  diagnosis_id uuid NOT NULL REFERENCES public.learner_gap_diagnoses(id),
  intervention_policy_version_id uuid NOT NULL REFERENCES public.intervention_policy_versions(id),
  intervention_type text NOT NULL,
  gap_type text NOT NULL,
  reason_codes text[] NOT NULL DEFAULT '{}',
  framework_context jsonb,
  assistance_level text,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT intervention_sessions_type_check CHECK (intervention_type IN
    ('EXPLAIN', 'WORKED_EXAMPLE', 'GUIDED_PRACTICE', 'CONTEXTUAL_HELP', 'INDEPENDENT_PRACTICE', 'PROVE')),
  CONSTRAINT intervention_sessions_status_check CHECK (status IN ('ACTIVE', 'COMPLETED', 'ABANDONED')),
  CONSTRAINT intervention_sessions_assistance_level_check CHECK (assistance_level IS NULL OR assistance_level IN
    ('NONE', 'HINT', 'MULTIPLE_HINTS', 'TUTOR_GUIDANCE', 'TUTOR_EXPLANATION', 'WORKED_EXAMPLE', 'OTHER'))
);

CREATE INDEX IF NOT EXISTS idx_intervention_sessions_student ON public.intervention_sessions (student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_intervention_sessions_diagnosis ON public.intervention_sessions (diagnosis_id);

CREATE TABLE IF NOT EXISTS public.intervention_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intervention_session_id uuid NOT NULL REFERENCES public.intervention_sessions(id),
  attempt_number integer NOT NULL,
  evidence_id uuid NOT NULL REFERENCES public.learning_evidence(id),
  outcome text NOT NULL,
  feedback jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT intervention_attempts_outcome_check CHECK (outcome IN ('correct', 'incorrect', 'partial')),
  CONSTRAINT intervention_attempts_session_attempt_unique UNIQUE (intervention_session_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS idx_intervention_attempts_session ON public.intervention_attempts (intervention_session_id, attempt_number);

-- --- Command term interpretations (task 16, additive to F7's
-- command_terms -- NEVER a replacement, NEVER a hardcoded per-framework
-- branch). NULL academic_programme_id = generic/default fallback
-- interpretation shared across frameworks that configure none of their
-- own. ---

CREATE TABLE IF NOT EXISTS public.command_term_interpretations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  command_term_id uuid NOT NULL REFERENCES public.command_terms(id),
  academic_programme_id uuid REFERENCES public.academic_programmes(id),
  expected_structure text NOT NULL,
  rubric_notes text,
  common_failure_patterns jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'DRAFT',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT command_term_interpretations_status_check CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cti_one_active_per_term_programme
  ON public.command_term_interpretations (command_term_id, academic_programme_id)
  WHERE status = 'ACTIVE' AND academic_programme_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cti_one_active_default
  ON public.command_term_interpretations (command_term_id)
  WHERE status = 'ACTIVE' AND academic_programme_id IS NULL;

-- --- Seed data: diagnostic policy v1, intervention policy v1 (task
-- "Prefer additive schema" + every prior phase's own precedent of
-- seeding its own reference/default data inside its own migration). ---

INSERT INTO public.diagnostic_policy_versions (version, rules, status)
SELECT 1, $POLICY$
{
  "knowledge": { "minimumIndependentEvidenceCount": 4, "minimumDistinctForms": 2, "failureRateThreshold": 0.6 },
  "skill": { "minimumQualifyingEvidenceCount": 3, "failureRateThreshold": 0.6 },
  "technique": { "minimumSimpleFormEvidenceCount": 3, "minimumComplexFormEvidenceCount": 3, "knowledgeSoundThreshold": 0.7, "failureRateThreshold": 0.6 },
  "speed": {
    "minimumValidTimingSampleCount": 5,
    "minimumCorrectnessBaseline": 0.7,
    "latencyRatioThreshold": 1.5,
    "expectedResponseTimeMsByDifficultyBand": { "1": 30000, "2": 45000, "3": 60000, "4": 90000, "5": 120000 }
  },
  "mixedGapPriority": ["KNOWLEDGE_GAP", "EXAM_TECHNIQUE_GAP", "SKILL_GAP", "SPEED_FLUENCY_GAP"],
  "confidence": { "baseConfidenceAtMinimumEvidence": 0.55, "confidenceGainPerExtraEvidenceItem": 0.05 }
}
$POLICY$::jsonb, 'ACTIVE'
WHERE NOT EXISTS (SELECT 1 FROM public.diagnostic_policy_versions);

INSERT INTO public.intervention_policy_versions (version, rules, status)
SELECT 1, $POLICY$
{
  "chains": {
    "KNOWLEDGE_GAP": ["EXPLAIN", "WORKED_EXAMPLE", "GUIDED_PRACTICE"],
    "SKILL_GAP": ["WORKED_EXAMPLE", "GUIDED_PRACTICE", "INDEPENDENT_PRACTICE"],
    "EXAM_TECHNIQUE_GAP": ["EXPLAIN", "WORKED_EXAMPLE", "GUIDED_PRACTICE"],
    "SPEED_FLUENCY_GAP": ["INDEPENDENT_PRACTICE"]
  },
  "insufficientEvidenceChain": ["GUIDED_PRACTICE"],
  "mixedTieBreakPriority": ["KNOWLEDGE_GAP", "EXAM_TECHNIQUE_GAP", "SKILL_GAP", "SPEED_FLUENCY_GAP"]
}
$POLICY$::jsonb, 'ACTIVE'
WHERE NOT EXISTS (SELECT 1 FROM public.intervention_policy_versions);
