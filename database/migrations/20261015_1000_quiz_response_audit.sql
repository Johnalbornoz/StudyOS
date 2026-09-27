-- QUIZ_RESPONSE_AUDIT_PERSISTENCE -- auditable per-question responses and grades.
--
-- Until now a submitted answer existed only in the request: quiz_sessions
-- keeps the questions, learning_evidence keeps one aggregate per concept,
-- and nothing kept what the learner actually wrote or how each question was
-- graded, so a final review could not be reconstructed or audited.
--
-- Two normalized tables, kept separate from each other and from
-- learning_evidence:
--   quiz_responses        -- WHAT the learner answered (verbatim), per question
--   quiz_response_grades  -- HOW it was graded, per response and grading model
--
-- The administered question is referenced immutably by the session row
-- (quiz_sessions.questions is never rewritten) + question_index +
-- question_fingerprint (sha256 of the administered question JSON).
-- No prompts or internal grader instructions are stored -- only the model
-- identity (provider / model / prompt id / prompt version / execution id).
--
-- Idempotency: one response per (session, question) and one grade per
-- (response, grading model, prompt version); writers use ON CONFLICT DO
-- NOTHING, so a repeated or concurrent submission never duplicates rows.
-- Client presentation/submission timestamps are deliberately NOT stored
-- (Step 10 data minimization); created_at / graded_at are server time.
-- Additive only: no existing table, row, or score is changed; no historical
-- session is backfilled or regraded. Governed runner only.

CREATE TABLE public.quiz_responses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    quiz_session_id text NOT NULL,
    question_index integer NOT NULL,
    question_id text,
    question_fingerprint text NOT NULL,
    question_type text NOT NULL,
    answer_format text NOT NULL,
    canonical_activity_type text,
    evidence_mode text,
    student_id uuid NOT NULL,
    concept_id uuid,
    student_answer text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT quiz_responses_pkey PRIMARY KEY (id),
    CONSTRAINT quiz_responses_session_fk FOREIGN KEY (quiz_session_id) REFERENCES public.quiz_sessions(id) ON DELETE CASCADE,
    CONSTRAINT quiz_responses_question_index_check CHECK (question_index >= 0),
    CONSTRAINT quiz_responses_fingerprint_check CHECK (question_fingerprint ~ '^[0-9a-f]{64}$'),
    CONSTRAINT quiz_responses_session_question_key UNIQUE (quiz_session_id, question_index)
);

CREATE INDEX quiz_responses_student_idx ON public.quiz_responses (student_id, created_at DESC);
CREATE INDEX quiz_responses_concept_idx ON public.quiz_responses (student_id, concept_id);

CREATE TABLE public.quiz_response_grades (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    response_id uuid NOT NULL,
    grading_model text NOT NULL,
    grader_provider text,
    grader_model text,
    grader_prompt_id text,
    -- NOT NULL so the idempotency key below is total (NULLs are distinct in UNIQUE):
    -- 'deterministic' / 'structured' when no AI prompt graded the answer.
    grader_prompt_version text NOT NULL,
    ai_execution_id text,
    is_correct boolean NOT NULL,
    score numeric(5,4) NOT NULL,
    final_judgment text NOT NULL,
    mathematical_correctness text,
    task_completion text,
    reasoning_quality text,
    missing_requirements text[] DEFAULT '{}'::text[] NOT NULL,
    learner_signal text,
    error_type text,
    misconception text,
    math_check_result text,
    math_check_setup text,
    feedback_did_well text,
    feedback_missing text[] DEFAULT '{}'::text[] NOT NULL,
    feedback_to_fix text,
    feedback_text text,
    graded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT quiz_response_grades_pkey PRIMARY KEY (id),
    CONSTRAINT quiz_response_grades_response_fk FOREIGN KEY (response_id) REFERENCES public.quiz_responses(id) ON DELETE CASCADE,
    CONSTRAINT quiz_response_grades_score_check CHECK (score >= 0 AND score <= 1),
    CONSTRAINT quiz_response_grades_judgment_check CHECK (final_judgment IN ('CORRECT', 'ALMOST', 'INCORRECT')),
    CONSTRAINT quiz_response_grades_math_check CHECK (mathematical_correctness IS NULL OR mathematical_correctness IN ('CORRECT', 'MINOR_SLIP', 'INCORRECT', 'NOT_APPLICABLE')),
    CONSTRAINT quiz_response_grades_task_check CHECK (task_completion IS NULL OR task_completion IN ('COMPLETE', 'PARTIAL', 'MISSING')),
    CONSTRAINT quiz_response_grades_reasoning_check CHECK (reasoning_quality IS NULL OR reasoning_quality IN ('STRONG', 'ADEQUATE', 'WEAK', 'INVALID', 'ABSENT')),
    CONSTRAINT quiz_response_grades_signal_check CHECK (learner_signal IS NULL OR learner_signal IN ('NONE', 'TASK_INCOMPLETE', 'MINOR_SLIP', 'MATH_ERROR', 'MISCONCEPTION')),
    CONSTRAINT quiz_response_grades_model_key UNIQUE (response_id, grading_model, grader_prompt_version)
);

CREATE INDEX quiz_response_grades_response_idx ON public.quiz_response_grades (response_id, graded_at DESC);

COMMENT ON TABLE public.quiz_responses IS 'Verbatim per-question learner answers (auditable). Separate from grading and from learning_evidence.';
COMMENT ON TABLE public.quiz_response_grades IS 'Per-response grading records (PEDAGOGICAL_V1 / STRUCTURED / LEGACY). Never rewritten; a regrade is a new row.';
