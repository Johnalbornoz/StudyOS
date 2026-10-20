-- Track B -- Question Bank Factory V1 (QB-1 bank core + QB-2 factory) (DEV).
--
-- Strictly additive on top of F7 + Exam V2: new tables, nullable columns,
-- triggers that only guard rows registered in the bank. No dropped / retyped /
-- narrowed object, no rewritten content. Never applied automatically --
-- governed runner only. See docs/exams/question-bank/QUESTION_BANK_FACTORY_ARCHITECTURE.md.
--
-- Model (no parallel question system):
--   question_bank_items   -- STABLE item identity (one per question, all versions);
--   approved_items        -- each row is ONE IMMUTABLE item VERSION (existing table,
--                            existing delivery / grading / attempt references);
--   bank_lifecycle_status -- governed lifecycle of the version, kept consistent
--                            with the existing approved_items.status that every
--                            delivery query already reads (PUBLISHED <=> PILOT /
--                            CALIBRATED / ACTIVE).
--
-- Backfill: every existing approved_items row becomes version 1 of its own bank
-- item (bank item id = the row id, so re-running is a no-op). PUBLISHED rows
-- become ACTIVE (grandfathered, uncalibrated), never re-published or rewritten.
--
-- Rollback (DEV only, manual, in this order):
--   DROP TRIGGER IF EXISTS trg_question_bank_version_guard ON public.approved_items;
--   DROP TRIGGER IF EXISTS trg_question_bank_version_no_delete ON public.approved_items;
--   DROP FUNCTION IF EXISTS public.question_bank_version_guard(), public.question_bank_version_no_delete(), public.question_bank_transition_allowed(text, text);
--   ALTER TABLE public.approved_items DROP CONSTRAINT IF EXISTS approved_items_bank_status_consistency,
--     DROP CONSTRAINT IF EXISTS approved_items_bank_version_unique, DROP CONSTRAINT IF EXISTS approved_items_bank_lifecycle_check,
--     DROP CONSTRAINT IF EXISTS approved_items_calibration_confidence_check;
--   ALTER TABLE public.question_bank_items DROP CONSTRAINT IF EXISTS question_bank_items_current_version_fk;
--   ALTER TABLE public.approved_items DROP COLUMN IF EXISTS bank_item_id, DROP COLUMN IF EXISTS version_number,
--     DROP COLUMN IF EXISTS bank_lifecycle_status, DROP COLUMN IF EXISTS lifecycle_updated_at, DROP COLUMN IF EXISTS content_hash,
--     DROP COLUMN IF EXISTS supersedes_version_id, DROP COLUMN IF EXISTS validation_report, DROP COLUMN IF EXISTS target_difficulty,
--     DROP COLUMN IF EXISTS calibrated_difficulty, DROP COLUMN IF EXISTS calibration_confidence, DROP COLUMN IF EXISTS calibration_sample_size,
--     DROP COLUMN IF EXISTS calibrated_at;
--   DROP TABLE IF EXISTS public.question_bank_item_stats, public.question_bank_health_snapshots, public.question_bank_lifecycle_events,
--     public.question_bank_generation_requests, public.question_bank_factory_runs, public.question_bank_cell_targets, public.question_bank_items;
--   DELETE FROM public.schema_migrations WHERE version = '20261026_1000';
-- ---------------------------------------------------------------------

-- --- Factory runs (observability + one-run-at-a-time lock) ---
CREATE TABLE IF NOT EXISTS public.question_bank_factory_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger text NOT NULL,
  status text NOT NULL DEFAULT 'RUNNING',
  environment text,
  requested_by uuid REFERENCES public.users(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  lease_expires_at timestamptz,
  ai_calls integer NOT NULL DEFAULT 0,
  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  estimated_cost_usd numeric NOT NULL DEFAULT 0,
  candidates_generated integer NOT NULL DEFAULT 0,
  validated integer NOT NULL DEFAULT 0,
  accepted integer NOT NULL DEFAULT 0,
  rejected integer NOT NULL DEFAULT 0,
  repaired integer NOT NULL DEFAULT 0,
  review_required integer NOT NULL DEFAULT 0,
  promoted integer NOT NULL DEFAULT 0,
  rate_limit_events integer NOT NULL DEFAULT 0,
  budget jsonb,
  coverage_before jsonb,
  coverage_after jsonb,
  notes jsonb,
  error text,
  CONSTRAINT question_bank_factory_runs_trigger_check CHECK (trigger IN ('SCHEDULED', 'MANUAL', 'CLI')),
  CONSTRAINT question_bank_factory_runs_status_check CHECK (status IN (
    'RUNNING', 'COMPLETED', 'STOPPED_BUDGET', 'STOPPED_RESERVE', 'STOPPED_RATE_LIMIT', 'STOPPED_MAX_PER_RUN', 'STOPPED_DEADLINE',
    'FAILED', 'SKIPPED_DISABLED', 'SKIPPED_LOCKED')),
  CONSTRAINT question_bank_factory_runs_counters CHECK (ai_calls >= 0 AND candidates_generated >= 0 AND accepted >= 0 AND rejected >= 0),
  CONSTRAINT question_bank_factory_runs_finished CHECK ((status = 'RUNNING') = (finished_at IS NULL))
);
-- No generation storm: at most ONE running factory run at a time, whatever the trigger.
CREATE UNIQUE INDEX IF NOT EXISTS idx_question_bank_factory_one_running ON public.question_bank_factory_runs ((true)) WHERE status = 'RUNNING';
CREATE INDEX IF NOT EXISTS idx_question_bank_factory_runs_started ON public.question_bank_factory_runs (started_at DESC);

-- --- Durable generation queue (one open request per blueprint cell) ---
CREATE TABLE IF NOT EXISTS public.question_bank_generation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_version_id uuid NOT NULL REFERENCES public.exam_versions(id),
  blueprint_id uuid NOT NULL REFERENCES public.assessment_blueprints(id),
  cell_key text NOT NULL,
  learning_objective_id uuid NOT NULL REFERENCES public.learning_objectives(id),
  assessment_component_id uuid NOT NULL REFERENCES public.assessment_components(id),
  requested_count integer NOT NULL,
  priority text NOT NULL,
  reason text NOT NULL,
  generation_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  language text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_expires_at timestamptz,
  provider text,
  model text,
  last_error text,
  candidates_created integer NOT NULL DEFAULT 0,
  accepted integer NOT NULL DEFAULT 0,
  rejected integer NOT NULL DEFAULT 0,
  repaired integer NOT NULL DEFAULT 0,
  review_required integer NOT NULL DEFAULT 0,
  idempotency_key text UNIQUE,
  requested_by uuid REFERENCES public.users(id),
  last_run_id uuid REFERENCES public.question_bank_factory_runs(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  CONSTRAINT question_bank_generation_requests_count_check CHECK (requested_count BETWEEN 1 AND 10),
  CONSTRAINT question_bank_generation_requests_priority_check CHECK (priority IN ('P0', 'P1', 'P2', 'P3')),
  CONSTRAINT question_bank_generation_requests_reason_check CHECK (reason IN ('EMPTY', 'FORM_BLOCKER', 'LOW_VARIETY', 'LOW_CALIBRATION', 'MISCONCEPTION_COVERAGE', 'MANUAL_SMALL_BATCH')),
  CONSTRAINT question_bank_generation_requests_status_check CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  CONSTRAINT question_bank_generation_requests_attempts_check CHECK (max_attempts BETWEEN 1 AND 5 AND attempt_count >= 0 AND attempt_count <= max_attempts),
  CONSTRAINT question_bank_generation_requests_lease_check CHECK (status <> 'RUNNING' OR (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CONSTRAINT question_bank_generation_requests_done_check CHECK ((status IN ('COMPLETED', 'FAILED', 'CANCELLED')) = (completed_at IS NOT NULL))
);
-- Idempotence: re-running the gap analysis never creates a second open request for the same cell.
CREATE UNIQUE INDEX IF NOT EXISTS idx_question_bank_generation_one_open_per_cell
  ON public.question_bank_generation_requests (exam_version_id, cell_key) WHERE status IN ('PENDING', 'RUNNING');
CREATE INDEX IF NOT EXISTS idx_question_bank_generation_claim
  ON public.question_bank_generation_requests (priority, next_attempt_at, created_at) WHERE status = 'PENDING';

-- --- Stable item identity ---
CREATE TABLE IF NOT EXISTS public.question_bank_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_key text NOT NULL,
  exam_version_id uuid REFERENCES public.exam_versions(id),
  assessment_component_id uuid REFERENCES public.assessment_components(id),
  learning_objective_id uuid NOT NULL REFERENCES public.learning_objectives(id),
  cell_key text,
  provenance text NOT NULL,
  language text NOT NULL,
  current_version_id uuid,
  generation_request_id uuid REFERENCES public.question_bank_generation_requests(id),
  generation_metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  retired_at timestamptz,
  retire_reason text,
  CONSTRAINT question_bank_items_key_per_objective UNIQUE (learning_objective_id, item_key),
  CONSTRAINT question_bank_items_provenance_check CHECK (provenance IN ('OFFICIAL', 'LICENSED', 'STUDYUS_GENERATED', 'FIXTURE')),
  -- AI-generated content is always StudyUS-generated: never official, never licensed.
  CONSTRAINT question_bank_items_generated_is_studyus CHECK (generation_request_id IS NULL OR provenance = 'STUDYUS_GENERATED'),
  CONSTRAINT question_bank_items_retired_reason CHECK (retired_at IS NULL OR retire_reason IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_question_bank_items_version ON public.question_bank_items (exam_version_id);
CREATE INDEX IF NOT EXISTS idx_question_bank_items_cell ON public.question_bank_items (exam_version_id, cell_key);

-- --- Item VERSION columns on the existing approved_items ---
ALTER TABLE public.approved_items ADD COLUMN IF NOT EXISTS bank_item_id uuid REFERENCES public.question_bank_items(id);
ALTER TABLE public.approved_items ADD COLUMN IF NOT EXISTS version_number integer;
ALTER TABLE public.approved_items ADD COLUMN IF NOT EXISTS bank_lifecycle_status text;
ALTER TABLE public.approved_items ADD COLUMN IF NOT EXISTS lifecycle_updated_at timestamptz;
ALTER TABLE public.approved_items ADD COLUMN IF NOT EXISTS content_hash text;
ALTER TABLE public.approved_items ADD COLUMN IF NOT EXISTS supersedes_version_id uuid REFERENCES public.approved_items(id);
ALTER TABLE public.approved_items ADD COLUMN IF NOT EXISTS validation_report jsonb;
ALTER TABLE public.approved_items ADD COLUMN IF NOT EXISTS target_difficulty integer;
ALTER TABLE public.approved_items ADD COLUMN IF NOT EXISTS calibrated_difficulty numeric;
ALTER TABLE public.approved_items ADD COLUMN IF NOT EXISTS calibration_confidence text;
ALTER TABLE public.approved_items ADD COLUMN IF NOT EXISTS calibration_sample_size integer NOT NULL DEFAULT 0;
ALTER TABLE public.approved_items ADD COLUMN IF NOT EXISTS calibrated_at timestamptz;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approved_items_bank_lifecycle_check') THEN
    ALTER TABLE public.approved_items ADD CONSTRAINT approved_items_bank_lifecycle_check CHECK (bank_lifecycle_status IS NULL OR bank_lifecycle_status IN (
      'DRAFT_AI', 'VALIDATING', 'VALIDATED', 'PILOT', 'CALIBRATED', 'ACTIVE',
      'REPAIR_REQUIRED', 'REVIEW_REQUIRED', 'REJECTED', 'SUSPENDED', 'RETIRED', 'SUPERSEDED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approved_items_calibration_confidence_check') THEN
    ALTER TABLE public.approved_items ADD CONSTRAINT approved_items_calibration_confidence_check CHECK (calibration_confidence IS NULL OR calibration_confidence IN (
      'INSUFFICIENT_DATA', 'EARLY_SIGNAL', 'MODERATE_CONFIDENCE', 'HIGH_CONFIDENCE'));
  END IF;
  -- The lifecycle and the existing delivery status never disagree: every delivery query reads status = 'PUBLISHED'.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approved_items_bank_status_consistency') THEN
    ALTER TABLE public.approved_items ADD CONSTRAINT approved_items_bank_status_consistency CHECK (bank_lifecycle_status IS NULL OR
      (bank_lifecycle_status IN ('PILOT', 'CALIBRATED', 'ACTIVE') AND status = 'PUBLISHED') OR
      (bank_lifecycle_status IN ('DRAFT_AI', 'VALIDATING') AND status IN ('DRAFT', 'PROPOSED')) OR
      (bank_lifecycle_status = 'VALIDATED' AND status = 'APPROVED') OR
      (bank_lifecycle_status IN ('REPAIR_REQUIRED', 'REVIEW_REQUIRED', 'SUSPENDED') AND status = 'IN_REVIEW') OR
      (bank_lifecycle_status = 'REJECTED' AND status = 'REJECTED') OR
      (bank_lifecycle_status IN ('RETIRED', 'SUPERSEDED') AND status = 'RETIRED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approved_items_bank_version_unique') THEN
    ALTER TABLE public.approved_items ADD CONSTRAINT approved_items_bank_version_unique UNIQUE (bank_item_id, version_number);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approved_items_bank_version_pair') THEN
    ALTER TABLE public.approved_items ADD CONSTRAINT approved_items_bank_version_pair CHECK ((bank_item_id IS NULL) = (version_number IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approved_items_target_difficulty_check') THEN
    ALTER TABLE public.approved_items ADD CONSTRAINT approved_items_target_difficulty_check CHECK (target_difficulty IS NULL OR target_difficulty BETWEEN 1 AND 5);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'question_bank_items_current_version_fk') THEN
    ALTER TABLE public.question_bank_items ADD CONSTRAINT question_bank_items_current_version_fk FOREIGN KEY (current_version_id) REFERENCES public.approved_items(id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_approved_items_bank_item ON public.approved_items (bank_item_id);
CREATE INDEX IF NOT EXISTS idx_approved_items_lifecycle ON public.approved_items (learning_objective_id, bank_lifecycle_status);

-- --- Lifecycle audit history (append-only) ---
CREATE TABLE IF NOT EXISTS public.question_bank_lifecycle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_item_id uuid NOT NULL REFERENCES public.question_bank_items(id),
  approved_item_id uuid NOT NULL REFERENCES public.approved_items(id),
  from_status text,
  to_status text NOT NULL,
  reason text NOT NULL,
  actor_kind text NOT NULL,
  actor_user_id uuid REFERENCES public.users(id),
  run_id uuid REFERENCES public.question_bank_factory_runs(id),
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT question_bank_lifecycle_events_actor_check CHECK (actor_kind IN ('SYSTEM', 'ADMIN', 'MIGRATION')),
  CONSTRAINT question_bank_lifecycle_events_admin_has_user CHECK (actor_kind <> 'ADMIN' OR actor_user_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_question_bank_lifecycle_events_item ON public.question_bank_lifecycle_events (bank_item_id, created_at);

-- --- Configurable coverage targets (cell_key NULL = the version-wide default) ---
CREATE TABLE IF NOT EXISTS public.question_bank_cell_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_version_id uuid NOT NULL REFERENCES public.exam_versions(id),
  cell_key text,
  target_forms numeric,
  min_usable integer,
  desired_items integer,
  min_active integer,
  min_calibrated integer,
  max_generation_priority text,
  note text,
  updated_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT question_bank_cell_targets_nonneg CHECK (
    (target_forms IS NULL OR (target_forms >= 1 AND target_forms <= 20)) AND (min_usable IS NULL OR min_usable >= 0) AND (desired_items IS NULL OR desired_items >= 0)
    AND (min_active IS NULL OR min_active >= 0) AND (min_calibrated IS NULL OR min_calibrated >= 0)),
  CONSTRAINT question_bank_cell_targets_priority_check CHECK (max_generation_priority IS NULL OR max_generation_priority IN ('P0', 'P1', 'P2', 'P3'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_question_bank_cell_targets_cell ON public.question_bank_cell_targets (exam_version_id, cell_key) WHERE cell_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_question_bank_cell_targets_default ON public.question_bank_cell_targets (exam_version_id) WHERE cell_key IS NULL;

-- --- Precomputed bank health (never computed on Start Practice / Start Mock) ---
CREATE TABLE IF NOT EXISTS public.question_bank_health_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_version_id uuid NOT NULL REFERENCES public.exam_versions(id),
  engine_version text NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  summary jsonb NOT NULL,
  readiness jsonb NOT NULL,
  cells jsonb NOT NULL,
  policy jsonb NOT NULL,
  run_id uuid REFERENCES public.question_bank_factory_runs(id)
);
CREATE INDEX IF NOT EXISTS idx_question_bank_health_latest ON public.question_bank_health_snapshots (exam_version_id, computed_at DESC);

-- --- Aggregated, anonymous item telemetry (QB-4 calibration groundwork) ---
CREATE TABLE IF NOT EXISTS public.question_bank_item_stats (
  approved_item_id uuid NOT NULL REFERENCES public.approved_items(id),
  delivery_mode text NOT NULL,
  responses integer NOT NULL DEFAULT 0,
  correct integer NOT NULL DEFAULT 0,
  partial integer NOT NULL DEFAULT 0,
  incorrect integer NOT NULL DEFAULT 0,
  mean_score_fraction numeric,
  option_counts jsonb,
  empirical_difficulty numeric,
  discrimination_proxy numeric,
  calibration_confidence text NOT NULL DEFAULT 'INSUFFICIENT_DATA',
  flags text[] NOT NULL DEFAULT '{}',
  misconception_signals jsonb,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (approved_item_id, delivery_mode),
  CONSTRAINT question_bank_item_stats_mode_check CHECK (delivery_mode IN ('PRACTICE', 'MOCK', 'ALL')),
  CONSTRAINT question_bank_item_stats_counts CHECK (responses >= 0 AND correct >= 0 AND partial >= 0 AND incorrect >= 0 AND correct + partial + incorrect <= responses),
  CONSTRAINT question_bank_item_stats_confidence_check CHECK (calibration_confidence IN ('INSUFFICIENT_DATA', 'EARLY_SIGNAL', 'MODERATE_CONFIDENCE', 'HIGH_CONFIDENCE'))
);

-- --- Server-authoritative lifecycle transitions (also enforced by the service) ---
CREATE OR REPLACE FUNCTION public.question_bank_transition_allowed(from_status text, to_status text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT from_status IS NULL OR from_status = to_status OR (from_status, to_status) IN (
    ('DRAFT_AI', 'VALIDATING'), ('DRAFT_AI', 'REJECTED'),
    ('VALIDATING', 'VALIDATED'), ('VALIDATING', 'REPAIR_REQUIRED'), ('VALIDATING', 'REVIEW_REQUIRED'), ('VALIDATING', 'REJECTED'),
    ('REPAIR_REQUIRED', 'SUPERSEDED'), ('REPAIR_REQUIRED', 'REJECTED'), ('REPAIR_REQUIRED', 'REVIEW_REQUIRED'),
    ('REVIEW_REQUIRED', 'VALIDATED'), ('REVIEW_REQUIRED', 'PILOT'), ('REVIEW_REQUIRED', 'ACTIVE'), ('REVIEW_REQUIRED', 'REJECTED'),
    ('REVIEW_REQUIRED', 'SUSPENDED'), ('REVIEW_REQUIRED', 'RETIRED'), ('REVIEW_REQUIRED', 'SUPERSEDED'),
    ('VALIDATED', 'PILOT'), ('VALIDATED', 'ACTIVE'), ('VALIDATED', 'REJECTED'), ('VALIDATED', 'RETIRED'), ('VALIDATED', 'SUPERSEDED'),
    ('PILOT', 'CALIBRATED'), ('PILOT', 'ACTIVE'), ('PILOT', 'REVIEW_REQUIRED'), ('PILOT', 'SUSPENDED'), ('PILOT', 'RETIRED'), ('PILOT', 'SUPERSEDED'),
    ('CALIBRATED', 'ACTIVE'), ('CALIBRATED', 'REVIEW_REQUIRED'), ('CALIBRATED', 'SUSPENDED'), ('CALIBRATED', 'RETIRED'), ('CALIBRATED', 'SUPERSEDED'),
    ('ACTIVE', 'CALIBRATED'), ('ACTIVE', 'REVIEW_REQUIRED'), ('ACTIVE', 'SUSPENDED'), ('ACTIVE', 'RETIRED'), ('ACTIVE', 'SUPERSEDED'),
    ('SUSPENDED', 'ACTIVE'), ('SUSPENDED', 'PILOT'), ('SUSPENDED', 'REVIEW_REQUIRED'), ('SUSPENDED', 'RETIRED'), ('SUSPENDED', 'SUPERSEDED'))
$$;

CREATE OR REPLACE FUNCTION public.question_bank_version_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  prov text;
BEGIN
  -- An item version is immutable: a correction is a NEW version, never a rewrite of what an attempt saw.
  IF OLD.content IS DISTINCT FROM NEW.content OR OLD.learning_objective_id IS DISTINCT FROM NEW.learning_objective_id
     OR OLD.question_type IS DISTINCT FROM NEW.question_type OR OLD.bank_item_id IS DISTINCT FROM NEW.bank_item_id
     OR OLD.version_number IS DISTINCT FROM NEW.version_number OR OLD.content_hash IS DISTINCT FROM NEW.content_hash THEN
    RAISE EXCEPTION 'QUESTION_BANK_VERSION_IMMUTABLE: approved item % is a bank version; create a new version instead', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF NOT public.question_bank_transition_allowed(OLD.bank_lifecycle_status, NEW.bank_lifecycle_status) THEN
    RAISE EXCEPTION 'QUESTION_BANK_INVALID_TRANSITION: % -> %', OLD.bank_lifecycle_status, NEW.bank_lifecycle_status USING ERRCODE = 'check_violation';
  END IF;
  -- AI-generated content always pilots before it is active.
  IF OLD.bank_lifecycle_status = 'VALIDATED' AND NEW.bank_lifecycle_status = 'ACTIVE' THEN
    SELECT provenance INTO prov FROM public.question_bank_items WHERE id = OLD.bank_item_id;
    IF prov = 'STUDYUS_GENERATED' THEN
      RAISE EXCEPTION 'QUESTION_BANK_PILOT_REQUIRED: generated item % must pilot before ACTIVE', OLD.id USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF OLD.bank_lifecycle_status IS DISTINCT FROM NEW.bank_lifecycle_status THEN
    NEW.lifecycle_updated_at := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_question_bank_version_guard ON public.approved_items;
CREATE TRIGGER trg_question_bank_version_guard BEFORE UPDATE ON public.approved_items
  FOR EACH ROW WHEN (OLD.bank_item_id IS NOT NULL) EXECUTE FUNCTION public.question_bank_version_guard();

-- Bank versions are retired, never deleted (history and calibration are preserved).
CREATE OR REPLACE FUNCTION public.question_bank_version_no_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'QUESTION_BANK_VERSION_NOT_DELETABLE: approved item % is a bank version; retire it instead', OLD.id USING ERRCODE = 'check_violation';
END $$;
DROP TRIGGER IF EXISTS trg_question_bank_version_no_delete ON public.approved_items;
CREATE TRIGGER trg_question_bank_version_no_delete BEFORE DELETE ON public.approved_items
  FOR EACH ROW WHEN (OLD.bank_item_id IS NOT NULL) EXECUTE FUNCTION public.question_bank_version_no_delete();

-- --- Backfill: every existing item becomes version 1 of its own bank item (idempotent, no content change) ---
INSERT INTO public.question_bank_items (id, item_key, exam_version_id, assessment_component_id, learning_objective_id, provenance, language, current_version_id, created_at, reviewed_at)
SELECT ai.id,
       COALESCE(NULLIF(ai.content->>'key', ''), 'legacy') || CASE WHEN count(*) OVER (PARTITION BY ai.learning_objective_id, ai.content->>'key') > 1 OR ai.content->>'key' IS NULL THEN '#' || ai.id::text ELSE '' END,
       origin.exam_version_id,
       origin.assessment_component_id,
       ai.learning_objective_id,
       CASE COALESCE(ai.content_origin, ai.content->>'contentOrigin',
                     CASE ai.content->>'contentStatus' WHEN 'OFFICIAL_LICENSED' THEN 'LICENSED' WHEN 'DEV_CERT_FIXTURE' THEN 'FIXTURE' ELSE 'GENERATED' END)
         WHEN 'OFFICIAL' THEN 'OFFICIAL' WHEN 'LICENSED' THEN 'LICENSED' WHEN 'FIXTURE' THEN 'FIXTURE' ELSE 'STUDYUS_GENERATED' END,
       COALESCE(NULLIF(ai.content->>'language', ''), 'es'),
       ai.id,
       ai.created_at,
       ai.reviewed_at
  FROM public.approved_items ai
  LEFT JOIN LATERAL (
    SELECT b.exam_version_id, t.assessment_component_id
      FROM public.blueprint_objective_targets t
      JOIN public.assessment_blueprints b ON b.id = t.blueprint_id
      JOIN public.exam_versions v ON v.id = b.exam_version_id
     WHERE t.learning_objective_id = ai.learning_objective_id
     ORDER BY (v.status = 'PUBLISHED') DESC, v.created_at DESC
     LIMIT 1
  ) origin ON true
 WHERE ai.bank_item_id IS NULL
ON CONFLICT (id) DO NOTHING;

UPDATE public.approved_items ai
   SET bank_item_id = ai.id,
       version_number = 1,
       target_difficulty = CASE WHEN (ai.content->>'difficulty') ~ '^[1-5]$' THEN (ai.content->>'difficulty')::int ELSE NULL END,
       calibration_confidence = COALESCE(ai.calibration_confidence, 'INSUFFICIENT_DATA'),
       content_hash = encode(sha256(convert_to(ai.content::text, 'UTF8')), 'hex'),
       bank_lifecycle_status = CASE ai.status
         WHEN 'PUBLISHED' THEN 'ACTIVE' WHEN 'APPROVED' THEN 'VALIDATED' WHEN 'IN_REVIEW' THEN 'REVIEW_REQUIRED'
         WHEN 'REJECTED' THEN 'REJECTED' WHEN 'RETIRED' THEN 'RETIRED' ELSE NULL END,
       lifecycle_updated_at = now()
 WHERE ai.bank_item_id IS NULL
   AND EXISTS (SELECT 1 FROM public.question_bank_items qi WHERE qi.id = ai.id);

UPDATE public.question_bank_items qi SET retired_at = now(), retire_reason = 'MIGRATION_BACKFILL_RETIRED'
 WHERE qi.retired_at IS NULL AND EXISTS (SELECT 1 FROM public.approved_items ai WHERE ai.id = qi.current_version_id AND ai.bank_lifecycle_status = 'RETIRED');

INSERT INTO public.question_bank_lifecycle_events (bank_item_id, approved_item_id, from_status, to_status, reason, actor_kind, detail)
SELECT ai.bank_item_id, ai.id, NULL, ai.bank_lifecycle_status, 'MIGRATION_BACKFILL', 'MIGRATION',
       jsonb_build_object('legacyStatus', ai.status, 'grandfathered', ai.bank_lifecycle_status = 'ACTIVE', 'calibration', 'INSUFFICIENT_DATA')
  FROM public.approved_items ai
 WHERE ai.bank_item_id IS NOT NULL AND ai.bank_lifecycle_status IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.question_bank_lifecycle_events e WHERE e.approved_item_id = ai.id AND e.reason = 'MIGRATION_BACKFILL');
