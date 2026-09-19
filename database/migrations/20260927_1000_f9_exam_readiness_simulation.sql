-- F9 -- Exam Readiness & Simulation.
--
-- Purely additive: every existing caller of every existing table keeps
-- its exact current behavior. simulation_attempts is a 1:1 wrapper
-- around F7's real exam_attempts rather than an ALTER TABLE widening
-- F7's certified status CHECK constraint (see
-- F9_SIMULATION_PLAN_MODEL.md). The one additive exception is a new,
-- optional idempotency_key column on F7's own
-- exam_attempt_item_responses (task §54/AC-F9-28) -- F7 never needed
-- idempotency for its own callers, but F9's simulation-response
-- endpoint can receive a genuine client/network retry of the same
-- logical submission, so it needs the same real protection F5's own
-- learning_evidence.operation_key already provides for evidence itself.
-- NULL for every existing/other-caller row; a real UNIQUE index only
-- applies where it is actually populated.
--
-- Readiness computation and simulation planning never write Canonical
-- V2 stage state directly (INV-F9-01/13/27) -- see src/lib/readiness
-- and src/lib/simulation, which read learning_evidence/F8 diagnoses
-- and F7's own exam_attempts machinery, then hand any new Evidence off
-- to the REAL, UNMODIFIED updateMastery() exactly as F7/F8 already do.

ALTER TABLE public.exam_attempt_item_responses ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_exam_attempt_item_responses_idempotency
  ON public.exam_attempt_item_responses (exam_attempt_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- --- Readiness policy versioning (mirrors F5/F8's own idiom) ---

CREATE TABLE IF NOT EXISTS public.readiness_policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version integer NOT NULL UNIQUE,
  rules jsonb NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  effective_from timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT readiness_policy_versions_status_check CHECK (status IN ('ACTIVE', 'RETIRED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_readiness_policy_versions_one_active
  ON public.readiness_policy_versions ((1)) WHERE status = 'ACTIVE';

-- --- Readiness snapshots (append-only -- a snapshot is NEVER updated
-- in place; a recomputation always inserts a new row, task 33) ---

CREATE TABLE IF NOT EXISTS public.readiness_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id),
  exam_profile_id uuid NOT NULL REFERENCES public.student_exam_profiles(id),
  exam_version_id uuid NOT NULL REFERENCES public.exam_versions(id),
  readiness_policy_version_id uuid NOT NULL REFERENCES public.readiness_policy_versions(id),
  overall_status text NOT NULL,
  dimensions jsonb NOT NULL,
  blueprint_coverage jsonb NOT NULL,
  evidence_counts jsonb NOT NULL,
  diagnostic_gap_references uuid[] NOT NULL DEFAULT '{}',
  simulation_history_used uuid[] NOT NULL DEFAULT '{}',
  reason_codes text[] NOT NULL DEFAULT '{}',
  limitations text[] NOT NULL DEFAULT '{}',
  score_projection_availability text NOT NULL,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT readiness_snapshots_overall_status_check CHECK (overall_status IN
    ('INSUFFICIENT_EVIDENCE', 'EARLY_PREPARATION', 'DEVELOPING', 'SIMULATION_READY', 'FULL_MOCK_ELIGIBLE')),
  CONSTRAINT readiness_snapshots_score_projection_check CHECK (score_projection_availability IN
    ('AVAILABLE', 'NOT_AVAILABLE_NO_CALIBRATION', 'NOT_AVAILABLE_INSUFFICIENT_DATA', 'NOT_APPLICABLE'))
);

CREATE INDEX IF NOT EXISTS idx_readiness_snapshots_profile
  ON public.readiness_snapshots (exam_profile_id, calculated_at DESC);

-- --- Score conversion models (task 29 -- real, versioned, and
-- deliberately seeded with ZERO rows: no calibrated official-score
-- conversion model exists in this environment; see
-- F9_SCORE_PROJECTION_POLICY.md for why this is a correct, not a
-- missing, implementation) ---

CREATE TABLE IF NOT EXISTS public.score_conversion_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_version_id uuid NOT NULL REFERENCES public.exam_versions(id),
  status text NOT NULL DEFAULT 'ACTIVE',
  conversion_table jsonb NOT NULL,
  minimum_evidence_count integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT score_conversion_models_status_check CHECK (status IN ('ACTIVE', 'RETIRED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_score_conversion_models_one_active_per_version
  ON public.score_conversion_models (exam_version_id) WHERE status = 'ACTIVE';

-- --- Simulation plans (frozen once created -- task 20/22) ---

CREATE TABLE IF NOT EXISTS public.simulation_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id),
  exam_version_id uuid NOT NULL REFERENCES public.exam_versions(id),
  blueprint_id uuid REFERENCES public.assessment_blueprints(id),
  simulation_type text NOT NULL,
  readiness_snapshot_id uuid REFERENCES public.readiness_snapshots(id),
  plan jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT simulation_plans_type_check CHECK (simulation_type IN ('TOPIC_EXAM', 'DOMAIN_EXAM', 'MINI_MOCK', 'FULL_MOCK'))
);

-- --- Simulation attempts (task 23 -- a 1:1 wrapper around a real F7
-- exam_attempts row, carrying only the NEW facts F7's schema has no
-- concept of: simulation type/plan, pause/resume, navigation state,
-- timing mode, language/timezone) ---

CREATE TABLE IF NOT EXISTS public.simulation_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_attempt_id uuid NOT NULL UNIQUE REFERENCES public.exam_attempts(id),
  student_id uuid NOT NULL REFERENCES public.students(id),
  exam_profile_id uuid NOT NULL REFERENCES public.student_exam_profiles(id),
  exam_version_id uuid NOT NULL REFERENCES public.exam_versions(id),
  simulation_type text NOT NULL,
  simulation_plan_id uuid NOT NULL REFERENCES public.simulation_plans(id),
  readiness_snapshot_id uuid REFERENCES public.readiness_snapshots(id),
  timing_mode text NOT NULL,
  pause_allowed boolean NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  paused_at timestamptz,
  resumed_at timestamptz,
  elapsed_seconds_at_pause integer,
  navigation_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  language text NOT NULL,
  timezone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT simulation_attempts_type_check CHECK (simulation_type IN ('TOPIC_EXAM', 'DOMAIN_EXAM', 'MINI_MOCK', 'FULL_MOCK')),
  CONSTRAINT simulation_attempts_timing_mode_check CHECK (timing_mode IN ('UNTIMED', 'TRAINING_TIMED', 'OFFICIAL_SIMULATION_TIMED')),
  CONSTRAINT simulation_attempts_status_check CHECK (status IN ('ACTIVE', 'PAUSED', 'COMPLETED', 'ABANDONED')),
  -- INV-F9-10 restated structurally: official simulation timing never permits pause.
  CONSTRAINT simulation_attempts_official_never_pausable CHECK (
    timing_mode != 'OFFICIAL_SIMULATION_TIMED' OR pause_allowed = false
  )
);

CREATE INDEX IF NOT EXISTS idx_simulation_attempts_student ON public.simulation_attempts (student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_simulation_attempts_profile ON public.simulation_attempts (exam_profile_id);

-- --- Seed data: readiness policy v1 (data, matching every prior
-- phase's own precedent of seeding its own default reference data
-- inside its own migration). ---

INSERT INTO public.readiness_policy_versions (version, rules, status)
SELECT 1, $POLICY$
{
  "gapBasedDimensions": { "minimumDiagnosedTargetsForConfidentStatus": 2 },
  "coverage": { "minimumEvidencedFractionForEarlyPreparation": 0.2, "minimumEvidencedFractionForSimulationReady": 0.6 },
  "evidenceSufficiency": { "minimumQualifyingEvidenceForSufficient": 15, "minimumDistinctQuestionTypesForSufficient": 3, "maxRecencyDaysForFresh": 30 },
  "simulationPerformance": { "minimumCompletedAttemptsForConfidentStatus": 1 }
}
$POLICY$::jsonb, 'ACTIVE'
WHERE NOT EXISTS (SELECT 1 FROM public.readiness_policy_versions);
