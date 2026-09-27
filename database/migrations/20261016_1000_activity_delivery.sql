-- LEARNING_ACTIVITY_DELIVERY -- separate AI generation from activity launch.
--
-- A learner launching an activity must never wait for an AI model. AI
-- generation + validation run in the background into a VALIDATED question
-- bank; per-learner prepared activities are assembled from it ahead of
-- time; the launch only authorizes, decides, retrieves/assembles and opens
-- a session (0 synchronous AI calls). See docs/architecture/ACTIVITY_DELIVERY.md.
--
-- Additive: new tables + widened constraints / new nullable columns on
-- canonical_prepared_activity and quiz_sessions. No existing row is
-- rewritten, no score changes, no historical session is touched.
-- Governed runner only.

-- 1. VALIDATED QUESTION BANK ------------------------------------------------
-- One row per quality-gated candidate. Scoped to the concept (concepts are
-- owned by one learner's subject), so a candidate can never reach another
-- learner. Only VALIDATED candidates are ever assembled into an activity.
CREATE TABLE public.question_bank_candidates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    concept_id uuid NOT NULL,
    activity_type text NOT NULL,
    language character varying(10) NOT NULL,
    academic_context jsonb NOT NULL,
    academic_context_fingerprint text NOT NULL,
    difficulty smallint NOT NULL,
    question_type text NOT NULL,
    answer_format text NOT NULL,
    reasoning_type text,
    cognitive_level text,
    question_intent text,
    skill_target text,
    misconception_target text,
    transfer_depth text,
    question jsonb NOT NULL,
    content_fingerprint text NOT NULL,
    template_signature jsonb NOT NULL,
    validation_status text DEFAULT 'VALIDATED' NOT NULL,
    generator_provider text,
    generator_model text,
    generator_prompt_id text,
    generator_prompt_version text NOT NULL,
    generation_operation_id text,
    usage_count integer DEFAULT 0 NOT NULL,
    last_used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT question_bank_candidates_pkey PRIMARY KEY (id),
    CONSTRAINT question_bank_candidates_concept_fk FOREIGN KEY (concept_id) REFERENCES public.concepts(id) ON DELETE CASCADE,
    CONSTRAINT question_bank_candidates_activity_check CHECK (activity_type IN ('LEARN_CHECK', 'PRACTICE', 'PROVE', 'RETAIN', 'TRANSFER')),
    CONSTRAINT question_bank_candidates_difficulty_check CHECK (difficulty BETWEEN 1 AND 5),
    CONSTRAINT question_bank_candidates_status_check CHECK (validation_status IN ('VALIDATED', 'REJECTED', 'RETIRED')),
    CONSTRAINT question_bank_candidates_depth_check CHECK (transfer_depth IS NULL OR transfer_depth IN ('NEAR', 'CONTEXTUAL', 'HIGHER')),
    CONSTRAINT question_bank_candidates_content_key UNIQUE (concept_id, activity_type, language, content_fingerprint)
);

CREATE INDEX question_bank_candidates_lookup_idx
    ON public.question_bank_candidates (concept_id, activity_type, language, academic_context_fingerprint, validation_status, difficulty);

-- Which candidate went into which session (novelty: never re-deliver an
-- independent-check item; least-used-first for assisted practice).
CREATE TABLE public.question_bank_deliveries (
    candidate_id uuid NOT NULL,
    quiz_session_id text NOT NULL,
    student_id uuid NOT NULL,
    delivered_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT question_bank_deliveries_pkey PRIMARY KEY (candidate_id, quiz_session_id),
    CONSTRAINT question_bank_deliveries_candidate_fk FOREIGN KEY (candidate_id) REFERENCES public.question_bank_candidates(id) ON DELETE CASCADE,
    CONSTRAINT question_bank_deliveries_session_fk FOREIGN KEY (quiz_session_id) REFERENCES public.quiz_sessions(id) ON DELETE CASCADE
);

CREATE INDEX question_bank_deliveries_student_idx ON public.question_bank_deliveries (student_id, candidate_id);

-- 2. PREPARED ACTIVITY INVENTORY (generalizes CANON-R6-PERF-R2) --------------
-- All canonical stages, an explicit EXPIRED state, contract / learner-state
-- fingerprints for compatibility, the source (BANK or AI), the bank
-- candidates it reserves, and a slot so PRACTICE can keep 2 READY.
ALTER TABLE public.canonical_prepared_activity DROP CONSTRAINT IF EXISTS canonical_prepared_activity_stage_check;
ALTER TABLE public.canonical_prepared_activity
    ADD CONSTRAINT canonical_prepared_activity_stage_check CHECK (stage IN ('LEARN', 'PRACTICE', 'PROVE', 'RETAIN', 'TRANSFER'));
ALTER TABLE public.canonical_prepared_activity DROP CONSTRAINT IF EXISTS canonical_prepared_activity_status_check;
ALTER TABLE public.canonical_prepared_activity
    ADD CONSTRAINT canonical_prepared_activity_status_check CHECK (status IN ('PREPARING', 'READY', 'CONSUMED', 'INVALIDATED', 'EXPIRED', 'FAILED'));

ALTER TABLE public.canonical_prepared_activity ADD COLUMN contract_fingerprint text;
ALTER TABLE public.canonical_prepared_activity ADD COLUMN learner_state_fingerprint text;
ALTER TABLE public.canonical_prepared_activity ADD COLUMN source text DEFAULT 'AI' NOT NULL;
ALTER TABLE public.canonical_prepared_activity ADD COLUMN slot smallint DEFAULT 0 NOT NULL;
ALTER TABLE public.canonical_prepared_activity ADD COLUMN candidate_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL;
ALTER TABLE public.canonical_prepared_activity
    ADD CONSTRAINT canonical_prepared_activity_source_check CHECK (source IN ('AI', 'BANK'));

DROP INDEX IF EXISTS public.idx_canonical_prepared_activity_one_active;
CREATE UNIQUE INDEX idx_canonical_prepared_activity_one_active
    ON public.canonical_prepared_activity (student_id, concept_id, stage, pedagogical_policy_version, slot)
    WHERE status IN ('PREPARING', 'READY');

-- 3. BACKGROUND GENERATION QUEUE ---------------------------------------------
-- DB-backed queue: dedup (one open job per key), bounded retries with
-- backoff, SKIP LOCKED claiming for concurrency, stale-lease recovery.
CREATE TABLE public.generation_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text NOT NULL,
    dedup_key text NOT NULL,
    payload jsonb NOT NULL,
    status text DEFAULT 'PENDING' NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 3 NOT NULL,
    run_after timestamp with time zone DEFAULT now() NOT NULL,
    locked_at timestamp with time zone,
    locked_by text,
    last_error text,
    result jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT generation_jobs_pkey PRIMARY KEY (id),
    CONSTRAINT generation_jobs_kind_check CHECK (kind IN ('BANK_REPLENISH', 'PREPARE_INVENTORY')),
    CONSTRAINT generation_jobs_status_check CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED')),
    CONSTRAINT generation_jobs_attempts_check CHECK (attempts >= 0 AND max_attempts BETWEEN 1 AND 10)
);

CREATE UNIQUE INDEX generation_jobs_one_open_per_key ON public.generation_jobs (dedup_key) WHERE status IN ('PENDING', 'RUNNING');
CREATE INDEX generation_jobs_claim_idx ON public.generation_jobs (status, run_after);

-- 4. SESSION DELIVERY PROVENANCE ---------------------------------------------
ALTER TABLE public.quiz_sessions ADD COLUMN delivery_source text;
ALTER TABLE public.quiz_sessions
    ADD CONSTRAINT quiz_sessions_delivery_source_check CHECK (delivery_source IS NULL OR delivery_source IN ('INVENTORY', 'BANK', 'EMERGENCY_AI'));
