--
-- StudyUs — Schema Baseline STUDYUS_BASELINE_2026_08
--
-- WHAT THIS FILE IS
--   A byte-accurate, schema-only snapshot of the LIVE StudyUs production
--   database (Neon Postgres, database `neondb`), captured via
--   `pg_dump --schema-only --no-owner --no-privileges --no-tablespaces
--   --no-comments --schema=public` on 2026-08-26 (Phase 0D).
--
--   This is NOT a hand-authored "ideal" schema. It is a direct,
--   mechanical capture of what the production database actually
--   contains right now -- including every inconsistency documented in
--   docs/audits/STUDYUS_PHASE_0A_CURRENT_ARCHITECTURE_AUDIT.md and
--   docs/audits/STUDYUS_PHASE_0B_LIVE_SCHEMA_RECONCILIATION.md (e.g. two
--   independent, FK-unlinked student-identity tables `students`/
--   `profiles`; `mastery_records.mastery_score` as NUMERIC(5,2) with no
--   range CHECK; `errors` matching the shape of the later of two
--   historically-conflicting migration definitions). Nothing here was
--   "cleaned up" or corrected -- see docs/adr/0001-schema-baseline-strategy.md
--   for why, and docs/audits/STUDYUS_PHASE_0D_SCHEMA_BASELINE_GOVERNANCE.md
--   for the full reconciliation against the historical migrations/001-030.
--
-- WHAT THIS FILE IS NOT
--   - It is NOT a replacement for migrations/001-030, which remain in
--     place, unmodified, as historical artifacts (see the migration
--     classification matrix in the Phase 0D report).
--   - It does NOT reproduce production data -- schema only, zero rows.
--   - It is NOT applied to production by any automated process. It
--     exists purely as a version-controlled reference and as the
--     starting point for a fresh development/test database.
--
-- EXTENSION PREREQUISITE
--   The live database has the `vector` extension (pgvector) installed,
--   used by `content_chunks.chunk_embedding` and its ivfflat index. A
--   target Postgres instance restoring this baseline needs the `vector`
--   extension available (e.g. `CREATE EXTENSION IF NOT EXISTS vector;`
--   run as a superuser/instance owner before this script, since a
--   non-privileged application role typically cannot create extensions
--   itself). No other extension is required -- `gen_random_uuid()` is a
--   Postgres core function (since v13), not an extension.
--
-- HOW TO USE THIS FILE
--   Fresh empty database:  psql "$TEST_DATABASE_URL" -f database/baseline/STUDYUS_BASELINE_2026_08.sql
--   Never point this at a database that already has StudyUs tables in it.
--
-- Dumped from database version 18.6 (Neon, aarch64-unknown-linux-gnu)
-- Dumped by pg_dump version 18.3
--

--
-- PostgreSQL database dump
--


-- Dumped from database version 18.6 (c5250a2)
-- Dumped by pg_dump version 18.3

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


SET default_table_access_method = heap;

--
-- Name: analytics_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid,
    event_name text NOT NULL,
    properties jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: assessment_concept_coverage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assessment_concept_coverage (
    assessment_occurrence_id uuid NOT NULL,
    concept_id uuid NOT NULL,
    weight numeric DEFAULT 1.0 NOT NULL,
    mapping_confidence numeric DEFAULT 0.5 NOT NULL,
    source_granularity text DEFAULT 'MANUAL'::text NOT NULL
);


--
-- Name: assessment_occurrences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assessment_occurrences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    rule_id uuid,
    subject_id uuid NOT NULL,
    scheduled_date date NOT NULL,
    status character varying(20) DEFAULT 'expected'::character varying NOT NULL,
    topics text[] DEFAULT '{}'::text[],
    exam_readiness numeric(5,2),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: assessment_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assessment_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    occurrence_id uuid NOT NULL,
    student_id uuid NOT NULL,
    score numeric(5,2) NOT NULL,
    max_score numeric(5,2) NOT NULL,
    percentage numeric(5,2) GENERATED ALWAYS AS (((score * (100)::numeric) / max_score)) STORED,
    analyzed_at timestamp with time zone,
    analysis_result jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: assessment_schedule_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assessment_schedule_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subject_id uuid NOT NULL,
    occurrence_pattern character varying(50) NOT NULL,
    next_scheduled_date date NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    interval_days integer
);


--
-- Name: backfill_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.backfill_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text DEFAULT 'KNOWLEDGE_STATE'::text NOT NULL,
    status text DEFAULT 'RUNNING'::text NOT NULL,
    dry_run boolean DEFAULT false NOT NULL,
    student_filter uuid,
    cursor_student_id uuid,
    cursor_concept_id uuid,
    metrics jsonb DEFAULT '{}'::jsonb NOT NULL,
    error text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone
);


--
-- Name: calibration_conflicts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calibration_conflicts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    concept_id uuid NOT NULL,
    assessment_result_id uuid NOT NULL,
    internal_score numeric NOT NULL,
    external_score numeric NOT NULL,
    mapping_confidence numeric NOT NULL,
    coverage_weight numeric NOT NULL,
    conflict_magnitude numeric NOT NULL,
    possible_interpretations jsonb NOT NULL,
    detected_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: cognitive_diagnoses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cognitive_diagnoses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    target_concept_id uuid NOT NULL,
    candidate_concept_id uuid NOT NULL,
    state text DEFAULT 'SUSPECTED'::text NOT NULL,
    score numeric NOT NULL,
    evidence jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    CONSTRAINT cognitive_diagnoses_state_check CHECK ((state = ANY (ARRAY['SUSPECTED'::text, 'LIKELY'::text, 'DIAGNOSIS_REQUIRED'::text, 'CONFIRMED'::text, 'REJECTED'::text])))
);


--
-- Name: concept_explanations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.concept_explanations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    concept_id uuid NOT NULL,
    language character varying(10) NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: concept_knowledge_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.concept_knowledge_state (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    concept_id uuid NOT NULL,
    subject_id uuid NOT NULL,
    mastery_state text DEFAULT 'UNKNOWN'::text NOT NULL,
    understanding_score numeric,
    independence_score numeric,
    application_score numeric,
    retention_score numeric,
    transfer_score numeric,
    active_misconception_count integer DEFAULT 0 NOT NULL,
    critical_misconception_count integer DEFAULT 0 NOT NULL,
    recurring_misconception_count integer DEFAULT 0 NOT NULL,
    evidence_count integer DEFAULT 0 NOT NULL,
    independent_evidence_count integer DEFAULT 0 NOT NULL,
    first_evidence_at timestamp with time zone,
    last_evidence_at timestamp with time zone,
    last_practiced_at timestamp with time zone,
    last_retrieved_at timestamp with time zone,
    last_transfer_at timestamp with time zone,
    last_validated_at timestamp with time zone,
    next_review_at timestamp with time zone,
    next_validation_at timestamp with time zone,
    active_validation_cycle_id uuid,
    validation_readiness text DEFAULT 'INSUFFICIENT_EVIDENCE'::text NOT NULL,
    state_reason jsonb,
    projection_version integer DEFAULT 1 NOT NULL,
    mastery_policy_version integer NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT concept_knowledge_state_mastery_state_check CHECK ((mastery_state = ANY (ARRAY['UNKNOWN'::text, 'LEARNING'::text, 'DEVELOPING'::text, 'PROVISIONAL_MASTERY'::text, 'VALIDATED_MASTERY'::text, 'AT_RISK'::text, 'INTERVENTION_REQUIRED'::text]))),
    CONSTRAINT concept_knowledge_state_validation_readiness_check CHECK ((validation_readiness = ANY (ARRAY['READY'::text, 'INSUFFICIENT_EVIDENCE'::text, 'WAITING_FOR_RETENTION'::text, 'TRANSFER_REQUIRED'::text, 'ACTIVE_CRITICAL_MISCONCEPTION'::text])))
);


--
-- Name: concept_localizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.concept_localizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    concept_id uuid NOT NULL,
    language character varying(10) NOT NULL,
    label text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: concept_relationships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.concept_relationships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_concept_id uuid NOT NULL,
    target_concept_id uuid NOT NULL,
    relationship_type text NOT NULL,
    confidence numeric DEFAULT 0.5 NOT NULL,
    source text DEFAULT 'AI_INFERRED'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    academic_context jsonb,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT concept_relationships_check CHECK ((source_concept_id <> target_concept_id)),
    CONSTRAINT concept_relationships_confidence_check CHECK (((confidence >= (0)::numeric) AND (confidence <= (1)::numeric))),
    CONSTRAINT concept_relationships_relationship_type_check CHECK ((relationship_type = ANY (ARRAY['PREREQUISITE_OF'::text, 'DEPENDS_ON'::text, 'RELATED_TO'::text, 'EXTENSION_OF'::text, 'APPLIES_TO'::text, 'COMMONLY_CONFUSED_WITH'::text]))),
    CONSTRAINT concept_relationships_source_check CHECK ((source = ANY (ARRAY['MANUAL'::text, 'AI_INFERRED'::text, 'CURRICULUM'::text, 'CONTENT_INFERRED'::text, 'SYSTEM'::text]))),
    CONSTRAINT concept_relationships_status_check CHECK ((status = ANY (ARRAY['active'::text, 'rejected'::text, 'superseded'::text])))
);


--
-- Name: concepts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.concepts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subject_id uuid NOT NULL,
    canonical_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    subtopic_id uuid
);


--
-- Name: content_chunks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_chunks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_id uuid NOT NULL,
    chunk_text text NOT NULL,
    seq_order integer NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    chunk_embedding public.vector(1536),
    concept_mappings uuid[] DEFAULT '{}'::uuid[]
);


--
-- Name: content_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_sources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    subject_id uuid NOT NULL,
    source_type character varying(50) NOT NULL,
    source_language character varying(10) NOT NULL,
    uploaded_at timestamp with time zone DEFAULT now(),
    storage_path text NOT NULL,
    metadata jsonb
);


--
-- Name: errors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.errors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    concept_id uuid NOT NULL,
    subject_id uuid NOT NULL,
    error_type character varying(30) NOT NULL,
    source_type character varying(30) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: learning_debt; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.learning_debt (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    concept_id uuid NOT NULL,
    subject_id uuid NOT NULL,
    severity integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    resolved_at timestamp with time zone,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL
);


--
-- Name: learning_debt_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.learning_debt_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    debt_id uuid NOT NULL,
    old_severity integer NOT NULL,
    new_severity integer NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: learning_evidence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.learning_evidence (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    concept_id uuid NOT NULL,
    source_type character varying(50) NOT NULL,
    result character varying(20) NOT NULL,
    difficulty numeric(5,2) NOT NULL,
    "timestamp" timestamp with time zone DEFAULT now(),
    subject_id uuid,
    activity_type text,
    learning_mode text,
    hints_used integer DEFAULT 0 NOT NULL,
    ai_assistance_type text DEFAULT 'NONE'::text NOT NULL,
    confidence_before_answer text,
    metadata jsonb,
    score_percent numeric,
    CONSTRAINT learning_evidence_ai_assistance_type_check CHECK ((ai_assistance_type = ANY (ARRAY['NONE'::text, 'HINT'::text, 'MULTIPLE_HINTS'::text, 'TUTOR_GUIDANCE'::text, 'TUTOR_EXPLANATION'::text, 'WORKED_EXAMPLE'::text, 'OTHER'::text]))),
    CONSTRAINT learning_evidence_confidence_before_answer_check CHECK ((confidence_before_answer = ANY (ARRAY['NOT_SURE'::text, 'SOMEWHAT_SURE'::text, 'VERY_SURE'::text]))),
    CONSTRAINT learning_evidence_learning_mode_check CHECK ((learning_mode = ANY (ARRAY['SOLO'::text, 'COACH'::text, 'AI_NATIVE'::text])))
);


--
-- Name: mastery_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastery_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    mastery_id uuid NOT NULL,
    old_score numeric(5,2),
    new_score numeric(5,2) NOT NULL,
    delta_reason character varying(50) NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: mastery_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastery_policies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    version integer NOT NULL,
    effective_from timestamp with time zone DEFAULT now() NOT NULL,
    minimum_understanding numeric NOT NULL,
    minimum_independence numeric NOT NULL,
    minimum_application numeric NOT NULL,
    minimum_retention numeric NOT NULL,
    minimum_transfer numeric NOT NULL,
    requires_transfer boolean DEFAULT true NOT NULL,
    maximum_critical_misconceptions integer DEFAULT 0 NOT NULL,
    minimum_evidence_count integer NOT NULL,
    minimum_independent_evidence_count integer NOT NULL,
    retention_min_gap_days integer NOT NULL,
    validation_window_days integer DEFAULT 14 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: mastery_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastery_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    concept_id uuid NOT NULL,
    subject_id uuid NOT NULL,
    mastery_score numeric(5,2) DEFAULT 0 NOT NULL,
    confidence_score numeric(5,2) DEFAULT 0 NOT NULL,
    last_practiced timestamp with time zone,
    last_assessed timestamp with time zone,
    attempt_count integer DEFAULT 0 NOT NULL,
    correct_count integer DEFAULT 0 NOT NULL,
    incorrect_count integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    next_review_date date
);


--
-- Name: misconception_signatures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.misconception_signatures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    concept_id uuid NOT NULL,
    misconception_code text NOT NULL,
    description text NOT NULL,
    canonical_explanation text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_critical boolean DEFAULT false NOT NULL
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    notification_type character varying(50) NOT NULL,
    title text NOT NULL,
    message text NOT NULL,
    delivered_at timestamp with time zone DEFAULT now(),
    read_at timestamp with time zone
);


--
-- Name: parent_student_relationships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.parent_student_relationships (
    parent_id uuid NOT NULL,
    student_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    status character varying(20) DEFAULT 'accepted'::character varying NOT NULL,
    responded_at timestamp with time zone,
    CONSTRAINT parent_student_relationships_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'accepted'::character varying, 'declined'::character varying])::text[])))
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    user_type character varying(20) NOT NULL,
    full_name text,
    created_at timestamp with time zone DEFAULT now(),
    clerk_id character varying,
    CONSTRAINT profiles_user_type_check CHECK (((user_type)::text = ANY ((ARRAY['admin'::character varying, 'parent'::character varying, 'student'::character varying])::text[])))
);


--
-- Name: quiz_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quiz_sessions (
    id text NOT NULL,
    student_id uuid NOT NULL,
    concept_id uuid,
    subject_id uuid NOT NULL,
    questions jsonb NOT NULL,
    status text DEFAULT 'active'::text,
    created_at timestamp without time zone DEFAULT now(),
    completed_at timestamp without time zone,
    expires_at timestamp without time zone NOT NULL,
    language character varying(10) DEFAULT 'en'::character varying NOT NULL,
    concept_ids uuid[],
    quiz_mode character varying(30) DEFAULT 'topic_practice'::character varying NOT NULL,
    hints_used_questions integer[] DEFAULT '{}'::integer[] NOT NULL,
    activity_type text,
    evidence_mode text,
    CONSTRAINT quiz_sessions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text, 'expired'::text])))
);


--
-- Name: remediation_paths; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.remediation_paths (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    diagnosis_id uuid,
    target_concept_id uuid NOT NULL,
    root_cause_concept_id uuid NOT NULL,
    pattern text NOT NULL,
    state text DEFAULT 'DETECTED'::text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    CONSTRAINT remediation_paths_state_check CHECK ((state = ANY (ARRAY['DETECTED'::text, 'DIAGNOSING'::text, 'CONFIRMED'::text, 'REPAIRING'::text, 'VERIFYING'::text, 'RESOLVED'::text, 'REJECTED'::text])))
);


--
-- Name: remediation_steps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.remediation_steps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    remediation_path_id uuid NOT NULL,
    step_type text NOT NULL,
    concept_id uuid NOT NULL,
    sequence integer NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    result jsonb,
    completed_at timestamp with time zone,
    CONSTRAINT remediation_steps_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'completed'::text, 'skipped'::text]))),
    CONSTRAINT remediation_steps_step_type_check CHECK ((step_type = ANY (ARRAY['LEARN'::text, 'GUIDED_PRACTICE'::text, 'RETRIEVAL'::text, 'EXPLAIN'::text, 'TRANSFER'::text, 'SOLO_VERIFY'::text])))
);


--
-- Name: student_academic_profile; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_academic_profile (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    country_of_study text DEFAULT 'OTHER'::text NOT NULL,
    school_year text,
    curriculum_type text DEFAULT 'not_sure'::text NOT NULL,
    ib_programme text,
    ib_year text,
    academic_year text,
    school_name text,
    profile_completed boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT student_academic_profile_country_of_study_check CHECK ((country_of_study = ANY (ARRAY['CO'::text, 'MX'::text, 'US'::text, 'DE'::text, 'OTHER'::text]))),
    CONSTRAINT student_academic_profile_curriculum_type_check CHECK ((curriculum_type = ANY (ARRAY['national'::text, 'ib'::text, 'other'::text, 'not_sure'::text]))),
    CONSTRAINT student_academic_profile_ib_programme_check CHECK ((ib_programme = ANY (ARRAY['MYP'::text, 'DP'::text])))
);


--
-- Name: student_availability; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_availability (
    student_id uuid NOT NULL,
    study_start_time time without time zone DEFAULT '16:30:00'::time without time zone NOT NULL,
    study_end_time time without time zone DEFAULT '18:30:00'::time without time zone NOT NULL,
    max_daily_minutes integer DEFAULT 120 NOT NULL,
    timezone character varying(50) DEFAULT 'UTC'::character varying NOT NULL,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: student_misconceptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_misconceptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    misconception_signature_id uuid NOT NULL,
    occurrence_count integer DEFAULT 1 NOT NULL,
    last_seen timestamp with time zone DEFAULT now() NOT NULL,
    evidence jsonb
);


--
-- Name: student_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_profiles (
    id uuid NOT NULL,
    parent_id uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: students; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.students (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    clerk_id text NOT NULL,
    email text NOT NULL,
    name text,
    language text DEFAULT 'en'::text,
    timezone text DEFAULT 'UTC'::text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: study_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.study_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    generated_at timestamp with time zone DEFAULT now(),
    status character varying(20) DEFAULT 'active'::character varying
);


--
-- Name: study_session_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.study_session_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    concept_id uuid NOT NULL,
    item_type character varying(50) NOT NULL,
    reason character varying(100) NOT NULL,
    sequence integer NOT NULL,
    duration_estimate_minutes integer
);


--
-- Name: study_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.study_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    plan_id uuid NOT NULL,
    scheduled_date date NOT NULL,
    estimated_duration_minutes integer NOT NULL,
    completed_at timestamp with time zone,
    completion_status character varying(20) DEFAULT 'pending'::character varying
);


--
-- Name: subject_mastery_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subject_mastery_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    subject_id uuid NOT NULL,
    snapshot_date date NOT NULL,
    avg_mastery_score integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT subject_mastery_snapshots_avg_mastery_score_check CHECK (((avg_mastery_score >= 0) AND (avg_mastery_score <= 100)))
);


--
-- Name: subjects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subjects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    name character varying(100) NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    target_language character varying(10),
    quiz_language_mode character varying(20) DEFAULT 'match_interface'::character varying NOT NULL,
    ib_programme character varying(10) DEFAULT 'none'::character varying NOT NULL,
    ib_subject_group character varying(40),
    ib_level character varying(2),
    CONSTRAINT subjects_ib_level_check CHECK (((ib_level IS NULL) OR ((ib_level)::text = ANY ((ARRAY['SL'::character varying, 'HL'::character varying])::text[])))),
    CONSTRAINT subjects_ib_programme_check CHECK (((ib_programme)::text = ANY ((ARRAY['none'::character varying, 'MYP'::character varying, 'DP'::character varying])::text[]))),
    CONSTRAINT subjects_quiz_language_mode_check CHECK (((quiz_language_mode)::text = ANY ((ARRAY['match_interface'::character varying, 'fixed_english'::character varying])::text[])))
);


--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    status text DEFAULT 'unpaid'::text NOT NULL,
    provider text DEFAULT 'mercadopago'::text NOT NULL,
    provider_subscription_id text,
    provider_payer_email text,
    current_period_end timestamp with time zone,
    manually_set_by_admin boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT subscriptions_status_check CHECK ((status = ANY (ARRAY['unpaid'::text, 'active'::text, 'past_due'::text, 'canceled'::text])))
);


--
-- Name: subtopic_localizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subtopic_localizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subtopic_id uuid NOT NULL,
    language text NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: subtopics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subtopics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    topic_id uuid NOT NULL,
    name text NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: topic_localizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.topic_localizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    topic_id uuid NOT NULL,
    language text NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: topics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.topics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subject_id uuid NOT NULL,
    name text NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tutor_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tutor_conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    subject_id uuid,
    title character varying(200),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tutor_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tutor_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    role character varying(20) NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tutor_messages_role_check CHECK (((role)::text = ANY ((ARRAY['user'::character varying, 'assistant'::character varying])::text[])))
);


--
-- Name: user_language_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_language_preferences (
    user_id uuid NOT NULL,
    interface_language character varying(10) DEFAULT 'en'::character varying NOT NULL,
    preferred_learning_language character varying(10) DEFAULT 'en'::character varying NOT NULL,
    source_language character varying(10) DEFAULT 'en'::character varying NOT NULL,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: validation_cycles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.validation_cycles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    concept_id uuid NOT NULL,
    subject_id uuid NOT NULL,
    trigger_type text NOT NULL,
    trigger_evidence_id uuid,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    validation_deadline timestamp with time zone NOT NULL,
    status text DEFAULT 'OPEN'::text NOT NULL,
    mastery_policy_version integer NOT NULL,
    initial_knowledge_state jsonb,
    validated_at timestamp with time zone,
    closed_at timestamp with time zone,
    final_outcome text,
    outcome_reason text,
    reopened_from_cycle_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT validation_cycles_final_outcome_check CHECK ((final_outcome = ANY (ARRAY['VALIDATED_MASTERY'::text, 'DEVELOPING'::text, 'INTERVENTION_REQUIRED'::text]))),
    CONSTRAINT validation_cycles_status_check CHECK ((status = ANY (ARRAY['OPEN'::text, 'CLOSED'::text]))),
    CONSTRAINT validation_cycles_trigger_type_check CHECK ((trigger_type = ANY (ARRAY['LOW_BASELINE'::text, 'CONFIRMED_MISCONCEPTION'::text, 'DIAGNOSTIC_FAILURE'::text, 'REPEATED_CONCEPTUAL_ERROR'::text, 'APPLICATION_FAILURE'::text, 'TRANSFER_FAILURE'::text, 'RETENTION_FAILURE'::text, 'KNOWLEDGE_DECAY'::text, 'EXTERNAL_ASSESSMENT_CONFLICT'::text])))
);


--
-- Name: validation_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.validation_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    validation_cycle_id uuid NOT NULL,
    event_type text NOT NULL,
    metadata jsonb,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: verification_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.verification_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    quiz_session_id text NOT NULL,
    student_id uuid NOT NULL,
    concept_id uuid NOT NULL,
    original_question_index integer,
    original_question jsonb NOT NULL,
    original_score_percent numeric NOT NULL,
    verification_question jsonb NOT NULL,
    trigger_ids jsonb NOT NULL,
    original_response text,
    verification_response text,
    grading_confidence numeric,
    verification_grading_confidence numeric,
    variant_equivalence_confidence numeric,
    assessment_confidence_before numeric NOT NULL,
    assessment_confidence_after numeric,
    outcome text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    CONSTRAINT verification_attempts_assessment_confidence_after_check CHECK (((assessment_confidence_after IS NULL) OR ((assessment_confidence_after >= (0)::numeric) AND (assessment_confidence_after <= (100)::numeric)))),
    CONSTRAINT verification_attempts_assessment_confidence_before_check CHECK (((assessment_confidence_before >= (0)::numeric) AND (assessment_confidence_before <= (100)::numeric))),
    CONSTRAINT verification_attempts_grading_confidence_check CHECK (((grading_confidence IS NULL) OR ((grading_confidence >= (0)::numeric) AND (grading_confidence <= (1)::numeric)))),
    CONSTRAINT verification_attempts_original_question_index_check CHECK (((original_question_index IS NULL) OR (original_question_index >= 0))),
    CONSTRAINT verification_attempts_original_score_percent_check CHECK (((original_score_percent >= (0)::numeric) AND (original_score_percent <= (100)::numeric))),
    CONSTRAINT verification_attempts_outcome_check CHECK (((outcome IS NULL) OR (outcome = ANY (ARRAY['CONFIRMED'::text, 'CONTRADICTED'::text, 'INCONCLUSIVE'::text])))),
    CONSTRAINT verification_attempts_trigger_ids_check CHECK ((jsonb_typeof(trigger_ids) = 'array'::text)),
    CONSTRAINT verification_attempts_variant_equivalence_confidence_check CHECK (((variant_equivalence_confidence IS NULL) OR ((variant_equivalence_confidence >= (0)::numeric) AND (variant_equivalence_confidence <= (1)::numeric)))),
    CONSTRAINT verification_attempts_verification_grading_confidence_check CHECK (((verification_grading_confidence IS NULL) OR ((verification_grading_confidence >= (0)::numeric) AND (verification_grading_confidence <= (1)::numeric))))
);


--
-- Name: analytics_events analytics_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events
    ADD CONSTRAINT analytics_events_pkey PRIMARY KEY (id);


--
-- Name: assessment_concept_coverage assessment_concept_coverage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_concept_coverage
    ADD CONSTRAINT assessment_concept_coverage_pkey PRIMARY KEY (assessment_occurrence_id, concept_id);


--
-- Name: assessment_occurrences assessment_occurrences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_occurrences
    ADD CONSTRAINT assessment_occurrences_pkey PRIMARY KEY (id);


--
-- Name: assessment_results assessment_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_results
    ADD CONSTRAINT assessment_results_pkey PRIMARY KEY (id);


--
-- Name: assessment_schedule_rules assessment_schedule_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_schedule_rules
    ADD CONSTRAINT assessment_schedule_rules_pkey PRIMARY KEY (id);


--
-- Name: backfill_runs backfill_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backfill_runs
    ADD CONSTRAINT backfill_runs_pkey PRIMARY KEY (id);


--
-- Name: calibration_conflicts calibration_conflicts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calibration_conflicts
    ADD CONSTRAINT calibration_conflicts_pkey PRIMARY KEY (id);


--
-- Name: cognitive_diagnoses cognitive_diagnoses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cognitive_diagnoses
    ADD CONSTRAINT cognitive_diagnoses_pkey PRIMARY KEY (id);


--
-- Name: concept_explanations concept_explanations_concept_id_language_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concept_explanations
    ADD CONSTRAINT concept_explanations_concept_id_language_key UNIQUE (concept_id, language);


--
-- Name: concept_explanations concept_explanations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concept_explanations
    ADD CONSTRAINT concept_explanations_pkey PRIMARY KEY (id);


--
-- Name: concept_knowledge_state concept_knowledge_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concept_knowledge_state
    ADD CONSTRAINT concept_knowledge_state_pkey PRIMARY KEY (id);


--
-- Name: concept_knowledge_state concept_knowledge_state_student_id_concept_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concept_knowledge_state
    ADD CONSTRAINT concept_knowledge_state_student_id_concept_id_key UNIQUE (student_id, concept_id);


--
-- Name: concept_localizations concept_localizations_concept_id_language_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concept_localizations
    ADD CONSTRAINT concept_localizations_concept_id_language_key UNIQUE (concept_id, language);


--
-- Name: concept_localizations concept_localizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concept_localizations
    ADD CONSTRAINT concept_localizations_pkey PRIMARY KEY (id);


--
-- Name: concept_relationships concept_relationships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concept_relationships
    ADD CONSTRAINT concept_relationships_pkey PRIMARY KEY (id);


--
-- Name: concept_relationships concept_relationships_source_concept_id_target_concept_id_r_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concept_relationships
    ADD CONSTRAINT concept_relationships_source_concept_id_target_concept_id_r_key UNIQUE (source_concept_id, target_concept_id, relationship_type);


--
-- Name: concepts concepts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concepts
    ADD CONSTRAINT concepts_pkey PRIMARY KEY (id);


--
-- Name: concepts concepts_subject_id_canonical_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concepts
    ADD CONSTRAINT concepts_subject_id_canonical_id_key UNIQUE (subject_id, canonical_id);


--
-- Name: content_chunks content_chunks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_chunks
    ADD CONSTRAINT content_chunks_pkey PRIMARY KEY (id);


--
-- Name: content_sources content_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_sources
    ADD CONSTRAINT content_sources_pkey PRIMARY KEY (id);


--
-- Name: errors errors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.errors
    ADD CONSTRAINT errors_pkey PRIMARY KEY (id);


--
-- Name: learning_debt_events learning_debt_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_debt_events
    ADD CONSTRAINT learning_debt_events_pkey PRIMARY KEY (id);


--
-- Name: learning_debt learning_debt_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_debt
    ADD CONSTRAINT learning_debt_pkey PRIMARY KEY (id);


--
-- Name: learning_debt learning_debt_student_id_concept_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_debt
    ADD CONSTRAINT learning_debt_student_id_concept_id_key UNIQUE (student_id, concept_id);


--
-- Name: learning_evidence learning_evidence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_evidence
    ADD CONSTRAINT learning_evidence_pkey PRIMARY KEY (id);


--
-- Name: mastery_events mastery_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastery_events
    ADD CONSTRAINT mastery_events_pkey PRIMARY KEY (id);


--
-- Name: mastery_policies mastery_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastery_policies
    ADD CONSTRAINT mastery_policies_pkey PRIMARY KEY (id);


--
-- Name: mastery_policies mastery_policies_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastery_policies
    ADD CONSTRAINT mastery_policies_version_key UNIQUE (version);


--
-- Name: mastery_records mastery_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastery_records
    ADD CONSTRAINT mastery_records_pkey PRIMARY KEY (id);


--
-- Name: mastery_records mastery_records_student_id_concept_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastery_records
    ADD CONSTRAINT mastery_records_student_id_concept_id_key UNIQUE (student_id, concept_id);


--
-- Name: misconception_signatures misconception_signatures_concept_id_misconception_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.misconception_signatures
    ADD CONSTRAINT misconception_signatures_concept_id_misconception_code_key UNIQUE (concept_id, misconception_code);


--
-- Name: misconception_signatures misconception_signatures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.misconception_signatures
    ADD CONSTRAINT misconception_signatures_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: parent_student_relationships parent_student_relationships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parent_student_relationships
    ADD CONSTRAINT parent_student_relationships_pkey PRIMARY KEY (parent_id, student_id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: quiz_sessions quiz_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_sessions
    ADD CONSTRAINT quiz_sessions_pkey PRIMARY KEY (id);


--
-- Name: remediation_paths remediation_paths_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remediation_paths
    ADD CONSTRAINT remediation_paths_pkey PRIMARY KEY (id);


--
-- Name: remediation_steps remediation_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remediation_steps
    ADD CONSTRAINT remediation_steps_pkey PRIMARY KEY (id);


--
-- Name: student_academic_profile student_academic_profile_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_academic_profile
    ADD CONSTRAINT student_academic_profile_pkey PRIMARY KEY (id);


--
-- Name: student_academic_profile student_academic_profile_student_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_academic_profile
    ADD CONSTRAINT student_academic_profile_student_id_key UNIQUE (student_id);


--
-- Name: student_availability student_availability_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_availability
    ADD CONSTRAINT student_availability_pkey PRIMARY KEY (student_id);


--
-- Name: student_misconceptions student_misconceptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_misconceptions
    ADD CONSTRAINT student_misconceptions_pkey PRIMARY KEY (id);


--
-- Name: student_misconceptions student_misconceptions_student_id_misconception_signature_i_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_misconceptions
    ADD CONSTRAINT student_misconceptions_student_id_misconception_signature_i_key UNIQUE (student_id, misconception_signature_id);


--
-- Name: student_profiles student_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_profiles
    ADD CONSTRAINT student_profiles_pkey PRIMARY KEY (id);


--
-- Name: students students_clerk_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_clerk_id_key UNIQUE (clerk_id);


--
-- Name: students students_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_pkey PRIMARY KEY (id);


--
-- Name: study_plans study_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_plans
    ADD CONSTRAINT study_plans_pkey PRIMARY KEY (id);


--
-- Name: study_session_items study_session_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_session_items
    ADD CONSTRAINT study_session_items_pkey PRIMARY KEY (id);


--
-- Name: study_sessions study_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_sessions
    ADD CONSTRAINT study_sessions_pkey PRIMARY KEY (id);


--
-- Name: subject_mastery_snapshots subject_mastery_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subject_mastery_snapshots
    ADD CONSTRAINT subject_mastery_snapshots_pkey PRIMARY KEY (id);


--
-- Name: subject_mastery_snapshots subject_mastery_snapshots_subject_id_snapshot_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subject_mastery_snapshots
    ADD CONSTRAINT subject_mastery_snapshots_subject_id_snapshot_date_key UNIQUE (subject_id, snapshot_date);


--
-- Name: subjects subjects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subjects
    ADD CONSTRAINT subjects_pkey PRIMARY KEY (id);


--
-- Name: subjects subjects_student_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subjects
    ADD CONSTRAINT subjects_student_id_name_key UNIQUE (student_id, name);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_student_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_student_id_key UNIQUE (student_id);


--
-- Name: subtopic_localizations subtopic_localizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subtopic_localizations
    ADD CONSTRAINT subtopic_localizations_pkey PRIMARY KEY (id);


--
-- Name: subtopic_localizations subtopic_localizations_subtopic_id_language_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subtopic_localizations
    ADD CONSTRAINT subtopic_localizations_subtopic_id_language_key UNIQUE (subtopic_id, language);


--
-- Name: subtopics subtopics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subtopics
    ADD CONSTRAINT subtopics_pkey PRIMARY KEY (id);


--
-- Name: topic_localizations topic_localizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.topic_localizations
    ADD CONSTRAINT topic_localizations_pkey PRIMARY KEY (id);


--
-- Name: topic_localizations topic_localizations_topic_id_language_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.topic_localizations
    ADD CONSTRAINT topic_localizations_topic_id_language_key UNIQUE (topic_id, language);


--
-- Name: topics topics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.topics
    ADD CONSTRAINT topics_pkey PRIMARY KEY (id);


--
-- Name: tutor_conversations tutor_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_conversations
    ADD CONSTRAINT tutor_conversations_pkey PRIMARY KEY (id);


--
-- Name: tutor_messages tutor_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_messages
    ADD CONSTRAINT tutor_messages_pkey PRIMARY KEY (id);


--
-- Name: user_language_preferences user_language_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_language_preferences
    ADD CONSTRAINT user_language_preferences_pkey PRIMARY KEY (user_id);


--
-- Name: validation_cycles validation_cycles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.validation_cycles
    ADD CONSTRAINT validation_cycles_pkey PRIMARY KEY (id);


--
-- Name: validation_events validation_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.validation_events
    ADD CONSTRAINT validation_events_pkey PRIMARY KEY (id);


--
-- Name: verification_attempts verification_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verification_attempts
    ADD CONSTRAINT verification_attempts_pkey PRIMARY KEY (id);


--
-- Name: concept_explanations_concept_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX concept_explanations_concept_idx ON public.concept_explanations USING btree (concept_id);


--
-- Name: concepts_subtopic_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX concepts_subtopic_idx ON public.concepts USING btree (subtopic_id);


--
-- Name: content_chunks_embedding_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_chunks_embedding_idx ON public.content_chunks USING ivfflat (chunk_embedding public.vector_cosine_ops) WITH (lists='100');


--
-- Name: errors_student_concept_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX errors_student_concept_idx ON public.errors USING btree (student_id, concept_id);


--
-- Name: errors_student_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX errors_student_type_idx ON public.errors USING btree (student_id, error_type);


--
-- Name: idx_acc_concept; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_acc_concept ON public.assessment_concept_coverage USING btree (concept_id);


--
-- Name: idx_analytics_events_event_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_analytics_events_event_name ON public.analytics_events USING btree (event_name);


--
-- Name: idx_analytics_events_student_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_analytics_events_student_id ON public.analytics_events USING btree (student_id);


--
-- Name: idx_assessment_occurrence_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assessment_occurrence_date ON public.assessment_occurrences USING btree (scheduled_date);


--
-- Name: idx_backfill_runs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_backfill_runs_status ON public.backfill_runs USING btree (status);


--
-- Name: idx_calibration_conflicts_concept; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_calibration_conflicts_concept ON public.calibration_conflicts USING btree (concept_id);


--
-- Name: idx_calibration_conflicts_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_calibration_conflicts_student ON public.calibration_conflicts USING btree (student_id);


--
-- Name: idx_cks_concept; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cks_concept ON public.concept_knowledge_state USING btree (concept_id);


--
-- Name: idx_cks_mastery_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cks_mastery_state ON public.concept_knowledge_state USING btree (mastery_state);


--
-- Name: idx_cks_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cks_student ON public.concept_knowledge_state USING btree (student_id);


--
-- Name: idx_cognitive_diagnoses_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cognitive_diagnoses_lookup ON public.cognitive_diagnoses USING btree (student_id, target_concept_id, state);


--
-- Name: idx_concept_relationships_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_concept_relationships_source ON public.concept_relationships USING btree (source_concept_id, relationship_type) WHERE (status = 'active'::text);


--
-- Name: idx_concept_relationships_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_concept_relationships_target ON public.concept_relationships USING btree (target_concept_id, relationship_type) WHERE (status = 'active'::text);


--
-- Name: idx_concepts_subject; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_concepts_subject ON public.concepts USING btree (subject_id);


--
-- Name: idx_debt_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_debt_status ON public.learning_debt USING btree (status);


--
-- Name: idx_debt_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_debt_student ON public.learning_debt USING btree (student_id);


--
-- Name: idx_learning_evidence_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_learning_evidence_student ON public.learning_evidence USING btree (student_id);


--
-- Name: idx_mastery_concept; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mastery_concept ON public.mastery_records USING btree (concept_id);


--
-- Name: idx_mastery_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mastery_student ON public.mastery_records USING btree (student_id);


--
-- Name: idx_mastery_student_subject; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mastery_student_subject ON public.mastery_records USING btree (student_id, subject_id);


--
-- Name: idx_plan_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_plan_student ON public.study_plans USING btree (student_id);


--
-- Name: idx_remediation_paths_student_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_remediation_paths_student_state ON public.remediation_paths USING btree (student_id, state);


--
-- Name: idx_remediation_steps_path; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_remediation_steps_path ON public.remediation_steps USING btree (remediation_path_id, sequence);


--
-- Name: idx_student_misconceptions_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_student_misconceptions_student ON public.student_misconceptions USING btree (student_id, last_seen DESC);


--
-- Name: idx_study_sessions_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_study_sessions_date ON public.study_sessions USING btree (scheduled_date);


--
-- Name: idx_validation_cycles_concept; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_validation_cycles_concept ON public.validation_cycles USING btree (concept_id);


--
-- Name: idx_validation_cycles_one_open; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_validation_cycles_one_open ON public.validation_cycles USING btree (student_id, concept_id) WHERE (status = 'OPEN'::text);


--
-- Name: idx_validation_cycles_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_validation_cycles_status ON public.validation_cycles USING btree (status);


--
-- Name: idx_validation_cycles_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_validation_cycles_student ON public.validation_cycles USING btree (student_id);


--
-- Name: idx_validation_events_cycle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_validation_events_cycle ON public.validation_events USING btree (validation_cycle_id);


--
-- Name: idx_verification_attempts_concept; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_verification_attempts_concept ON public.verification_attempts USING btree (concept_id);


--
-- Name: idx_verification_attempts_quiz_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_verification_attempts_quiz_session ON public.verification_attempts USING btree (quiz_session_id);


--
-- Name: idx_verification_attempts_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_verification_attempts_student ON public.verification_attempts USING btree (student_id);


--
-- Name: learning_debt_events_debt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX learning_debt_events_debt_idx ON public.learning_debt_events USING btree (debt_id);


--
-- Name: profiles_clerk_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX profiles_clerk_id_key ON public.profiles USING btree (clerk_id) WHERE (clerk_id IS NOT NULL);


--
-- Name: quiz_sessions_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX quiz_sessions_status_idx ON public.quiz_sessions USING btree (status, expires_at);


--
-- Name: quiz_sessions_student_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX quiz_sessions_student_idx ON public.quiz_sessions USING btree (student_id);


--
-- Name: subject_mastery_snapshots_subject_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subject_mastery_snapshots_subject_idx ON public.subject_mastery_snapshots USING btree (subject_id, snapshot_date);


--
-- Name: subscriptions_provider_subscription_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subscriptions_provider_subscription_idx ON public.subscriptions USING btree (provider_subscription_id);


--
-- Name: subtopic_localizations_subtopic_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subtopic_localizations_subtopic_idx ON public.subtopic_localizations USING btree (subtopic_id);


--
-- Name: subtopics_topic_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subtopics_topic_idx ON public.subtopics USING btree (topic_id);


--
-- Name: topic_localizations_topic_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX topic_localizations_topic_idx ON public.topic_localizations USING btree (topic_id);


--
-- Name: topics_subject_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX topics_subject_idx ON public.topics USING btree (subject_id);


--
-- Name: tutor_conversations_student_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tutor_conversations_student_idx ON public.tutor_conversations USING btree (student_id);


--
-- Name: tutor_messages_conversation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tutor_messages_conversation_idx ON public.tutor_messages USING btree (conversation_id);


--
-- Name: analytics_events analytics_events_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events
    ADD CONSTRAINT analytics_events_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id);


--
-- Name: assessment_concept_coverage assessment_concept_coverage_assessment_occurrence_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_concept_coverage
    ADD CONSTRAINT assessment_concept_coverage_assessment_occurrence_id_fkey FOREIGN KEY (assessment_occurrence_id) REFERENCES public.assessment_occurrences(id);


--
-- Name: assessment_concept_coverage assessment_concept_coverage_concept_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_concept_coverage
    ADD CONSTRAINT assessment_concept_coverage_concept_id_fkey FOREIGN KEY (concept_id) REFERENCES public.concepts(id);


--
-- Name: assessment_occurrences assessment_occurrences_rule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_occurrences
    ADD CONSTRAINT assessment_occurrences_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES public.assessment_schedule_rules(id);


--
-- Name: assessment_occurrences assessment_occurrences_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_occurrences
    ADD CONSTRAINT assessment_occurrences_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subjects(id);


--
-- Name: assessment_results assessment_results_occurrence_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_results
    ADD CONSTRAINT assessment_results_occurrence_id_fkey FOREIGN KEY (occurrence_id) REFERENCES public.assessment_occurrences(id);


--
-- Name: assessment_results assessment_results_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_results
    ADD CONSTRAINT assessment_results_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.profiles(id);


--
-- Name: assessment_schedule_rules assessment_schedule_rules_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_schedule_rules
    ADD CONSTRAINT assessment_schedule_rules_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subjects(id);


--
-- Name: calibration_conflicts calibration_conflicts_assessment_result_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calibration_conflicts
    ADD CONSTRAINT calibration_conflicts_assessment_result_id_fkey FOREIGN KEY (assessment_result_id) REFERENCES public.assessment_results(id);


--
-- Name: calibration_conflicts calibration_conflicts_concept_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calibration_conflicts
    ADD CONSTRAINT calibration_conflicts_concept_id_fkey FOREIGN KEY (concept_id) REFERENCES public.concepts(id);


--
-- Name: calibration_conflicts calibration_conflicts_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calibration_conflicts
    ADD CONSTRAINT calibration_conflicts_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id);


--
-- Name: cognitive_diagnoses cognitive_diagnoses_candidate_concept_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cognitive_diagnoses
    ADD CONSTRAINT cognitive_diagnoses_candidate_concept_id_fkey FOREIGN KEY (candidate_concept_id) REFERENCES public.concepts(id) ON DELETE CASCADE;


--
-- Name: cognitive_diagnoses cognitive_diagnoses_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cognitive_diagnoses
    ADD CONSTRAINT cognitive_diagnoses_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;


--
-- Name: cognitive_diagnoses cognitive_diagnoses_target_concept_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cognitive_diagnoses
    ADD CONSTRAINT cognitive_diagnoses_target_concept_id_fkey FOREIGN KEY (target_concept_id) REFERENCES public.concepts(id) ON DELETE CASCADE;


--
-- Name: concept_explanations concept_explanations_concept_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concept_explanations
    ADD CONSTRAINT concept_explanations_concept_id_fkey FOREIGN KEY (concept_id) REFERENCES public.concepts(id);


--
-- Name: concept_knowledge_state concept_knowledge_state_concept_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concept_knowledge_state
    ADD CONSTRAINT concept_knowledge_state_concept_id_fkey FOREIGN KEY (concept_id) REFERENCES public.concepts(id);


--
-- Name: concept_knowledge_state concept_knowledge_state_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concept_knowledge_state
    ADD CONSTRAINT concept_knowledge_state_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id);


--
-- Name: concept_knowledge_state concept_knowledge_state_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concept_knowledge_state
    ADD CONSTRAINT concept_knowledge_state_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subjects(id);


--
-- Name: concept_localizations concept_localizations_concept_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concept_localizations
    ADD CONSTRAINT concept_localizations_concept_id_fkey FOREIGN KEY (concept_id) REFERENCES public.concepts(id);


--
-- Name: concept_relationships concept_relationships_source_concept_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concept_relationships
    ADD CONSTRAINT concept_relationships_source_concept_id_fkey FOREIGN KEY (source_concept_id) REFERENCES public.concepts(id) ON DELETE CASCADE;


--
-- Name: concept_relationships concept_relationships_target_concept_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concept_relationships
    ADD CONSTRAINT concept_relationships_target_concept_id_fkey FOREIGN KEY (target_concept_id) REFERENCES public.concepts(id) ON DELETE CASCADE;


--
-- Name: concepts concepts_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concepts
    ADD CONSTRAINT concepts_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subjects(id);


--
-- Name: concepts concepts_subtopic_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concepts
    ADD CONSTRAINT concepts_subtopic_id_fkey FOREIGN KEY (subtopic_id) REFERENCES public.subtopics(id);


--
-- Name: content_chunks content_chunks_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_chunks
    ADD CONSTRAINT content_chunks_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.content_sources(id);


--
-- Name: content_sources content_sources_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_sources
    ADD CONSTRAINT content_sources_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.profiles(id);


--
-- Name: content_sources content_sources_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_sources
    ADD CONSTRAINT content_sources_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subjects(id);


--
-- Name: errors errors_concept_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.errors
    ADD CONSTRAINT errors_concept_id_fkey FOREIGN KEY (concept_id) REFERENCES public.concepts(id);


--
-- Name: errors errors_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.errors
    ADD CONSTRAINT errors_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.profiles(id);


--
-- Name: errors errors_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.errors
    ADD CONSTRAINT errors_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subjects(id);


--
-- Name: learning_debt learning_debt_concept_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_debt
    ADD CONSTRAINT learning_debt_concept_id_fkey FOREIGN KEY (concept_id) REFERENCES public.concepts(id);


--
-- Name: learning_debt_events learning_debt_events_debt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_debt_events
    ADD CONSTRAINT learning_debt_events_debt_id_fkey FOREIGN KEY (debt_id) REFERENCES public.learning_debt(id) ON DELETE CASCADE;


--
-- Name: learning_debt learning_debt_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_debt
    ADD CONSTRAINT learning_debt_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.profiles(id);


--
-- Name: learning_debt learning_debt_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_debt
    ADD CONSTRAINT learning_debt_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subjects(id);


--
-- Name: learning_evidence learning_evidence_concept_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_evidence
    ADD CONSTRAINT learning_evidence_concept_id_fkey FOREIGN KEY (concept_id) REFERENCES public.concepts(id);


--
-- Name: learning_evidence learning_evidence_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_evidence
    ADD CONSTRAINT learning_evidence_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.profiles(id);


--
-- Name: learning_evidence learning_evidence_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_evidence
    ADD CONSTRAINT learning_evidence_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subjects(id);


--
-- Name: mastery_events mastery_events_mastery_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastery_events
    ADD CONSTRAINT mastery_events_mastery_id_fkey FOREIGN KEY (mastery_id) REFERENCES public.mastery_records(id);


--
-- Name: mastery_records mastery_records_concept_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastery_records
    ADD CONSTRAINT mastery_records_concept_id_fkey FOREIGN KEY (concept_id) REFERENCES public.concepts(id);


--
-- Name: mastery_records mastery_records_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastery_records
    ADD CONSTRAINT mastery_records_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.profiles(id);


--
-- Name: mastery_records mastery_records_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastery_records
    ADD CONSTRAINT mastery_records_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subjects(id);


--
-- Name: misconception_signatures misconception_signatures_concept_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.misconception_signatures
    ADD CONSTRAINT misconception_signatures_concept_id_fkey FOREIGN KEY (concept_id) REFERENCES public.concepts(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.profiles(id);


--
-- Name: parent_student_relationships parent_student_relationships_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parent_student_relationships
    ADD CONSTRAINT parent_student_relationships_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.profiles(id);


--
-- Name: parent_student_relationships parent_student_relationships_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parent_student_relationships
    ADD CONSTRAINT parent_student_relationships_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.profiles(id);


--
-- Name: quiz_sessions quiz_sessions_concept_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_sessions
    ADD CONSTRAINT quiz_sessions_concept_id_fkey FOREIGN KEY (concept_id) REFERENCES public.concepts(id);


--
-- Name: quiz_sessions quiz_sessions_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_sessions
    ADD CONSTRAINT quiz_sessions_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;


--
-- Name: quiz_sessions quiz_sessions_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_sessions
    ADD CONSTRAINT quiz_sessions_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subjects(id);


--
-- Name: remediation_paths remediation_paths_diagnosis_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remediation_paths
    ADD CONSTRAINT remediation_paths_diagnosis_id_fkey FOREIGN KEY (diagnosis_id) REFERENCES public.cognitive_diagnoses(id) ON DELETE SET NULL;


--
-- Name: remediation_paths remediation_paths_root_cause_concept_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remediation_paths
    ADD CONSTRAINT remediation_paths_root_cause_concept_id_fkey FOREIGN KEY (root_cause_concept_id) REFERENCES public.concepts(id) ON DELETE CASCADE;


--
-- Name: remediation_paths remediation_paths_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remediation_paths
    ADD CONSTRAINT remediation_paths_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;


--
-- Name: remediation_paths remediation_paths_target_concept_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remediation_paths
    ADD CONSTRAINT remediation_paths_target_concept_id_fkey FOREIGN KEY (target_concept_id) REFERENCES public.concepts(id) ON DELETE CASCADE;


--
-- Name: remediation_steps remediation_steps_concept_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remediation_steps
    ADD CONSTRAINT remediation_steps_concept_id_fkey FOREIGN KEY (concept_id) REFERENCES public.concepts(id) ON DELETE CASCADE;


--
-- Name: remediation_steps remediation_steps_remediation_path_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remediation_steps
    ADD CONSTRAINT remediation_steps_remediation_path_id_fkey FOREIGN KEY (remediation_path_id) REFERENCES public.remediation_paths(id) ON DELETE CASCADE;


--
-- Name: student_academic_profile student_academic_profile_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_academic_profile
    ADD CONSTRAINT student_academic_profile_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;


--
-- Name: student_availability student_availability_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_availability
    ADD CONSTRAINT student_availability_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.profiles(id);


--
-- Name: student_misconceptions student_misconceptions_misconception_signature_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_misconceptions
    ADD CONSTRAINT student_misconceptions_misconception_signature_id_fkey FOREIGN KEY (misconception_signature_id) REFERENCES public.misconception_signatures(id) ON DELETE CASCADE;


--
-- Name: student_misconceptions student_misconceptions_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_misconceptions
    ADD CONSTRAINT student_misconceptions_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;


--
-- Name: student_profiles student_profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_profiles
    ADD CONSTRAINT student_profiles_id_fkey FOREIGN KEY (id) REFERENCES public.profiles(id);


--
-- Name: student_profiles student_profiles_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_profiles
    ADD CONSTRAINT student_profiles_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.profiles(id);


--
-- Name: study_plans study_plans_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_plans
    ADD CONSTRAINT study_plans_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.profiles(id);


--
-- Name: study_session_items study_session_items_concept_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_session_items
    ADD CONSTRAINT study_session_items_concept_id_fkey FOREIGN KEY (concept_id) REFERENCES public.concepts(id);


--
-- Name: study_session_items study_session_items_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_session_items
    ADD CONSTRAINT study_session_items_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.study_sessions(id);


--
-- Name: study_sessions study_sessions_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_sessions
    ADD CONSTRAINT study_sessions_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.study_plans(id);


--
-- Name: subject_mastery_snapshots subject_mastery_snapshots_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subject_mastery_snapshots
    ADD CONSTRAINT subject_mastery_snapshots_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;


--
-- Name: subject_mastery_snapshots subject_mastery_snapshots_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subject_mastery_snapshots
    ADD CONSTRAINT subject_mastery_snapshots_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subjects(id) ON DELETE CASCADE;


--
-- Name: subjects subjects_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subjects
    ADD CONSTRAINT subjects_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.profiles(id);


--
-- Name: subscriptions subscriptions_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;


--
-- Name: subtopic_localizations subtopic_localizations_subtopic_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subtopic_localizations
    ADD CONSTRAINT subtopic_localizations_subtopic_id_fkey FOREIGN KEY (subtopic_id) REFERENCES public.subtopics(id) ON DELETE CASCADE;


--
-- Name: subtopics subtopics_topic_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subtopics
    ADD CONSTRAINT subtopics_topic_id_fkey FOREIGN KEY (topic_id) REFERENCES public.topics(id);


--
-- Name: topic_localizations topic_localizations_topic_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.topic_localizations
    ADD CONSTRAINT topic_localizations_topic_id_fkey FOREIGN KEY (topic_id) REFERENCES public.topics(id) ON DELETE CASCADE;


--
-- Name: topics topics_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.topics
    ADD CONSTRAINT topics_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subjects(id);


--
-- Name: tutor_conversations tutor_conversations_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_conversations
    ADD CONSTRAINT tutor_conversations_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.profiles(id);


--
-- Name: tutor_conversations tutor_conversations_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_conversations
    ADD CONSTRAINT tutor_conversations_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subjects(id);


--
-- Name: tutor_messages tutor_messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_messages
    ADD CONSTRAINT tutor_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.tutor_conversations(id) ON DELETE CASCADE;


--
-- Name: user_language_preferences user_language_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_language_preferences
    ADD CONSTRAINT user_language_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id);


--
-- Name: validation_cycles validation_cycles_concept_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.validation_cycles
    ADD CONSTRAINT validation_cycles_concept_id_fkey FOREIGN KEY (concept_id) REFERENCES public.concepts(id);


--
-- Name: validation_cycles validation_cycles_reopened_from_cycle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.validation_cycles
    ADD CONSTRAINT validation_cycles_reopened_from_cycle_id_fkey FOREIGN KEY (reopened_from_cycle_id) REFERENCES public.validation_cycles(id);


--
-- Name: validation_cycles validation_cycles_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.validation_cycles
    ADD CONSTRAINT validation_cycles_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id);


--
-- Name: validation_cycles validation_cycles_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.validation_cycles
    ADD CONSTRAINT validation_cycles_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subjects(id);


--
-- Name: validation_events validation_events_validation_cycle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.validation_events
    ADD CONSTRAINT validation_events_validation_cycle_id_fkey FOREIGN KEY (validation_cycle_id) REFERENCES public.validation_cycles(id);


--
-- Name: verification_attempts verification_attempts_concept_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verification_attempts
    ADD CONSTRAINT verification_attempts_concept_id_fkey FOREIGN KEY (concept_id) REFERENCES public.concepts(id);


--
-- Name: verification_attempts verification_attempts_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verification_attempts
    ADD CONSTRAINT verification_attempts_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id);


--
-- PostgreSQL database dump complete
--


