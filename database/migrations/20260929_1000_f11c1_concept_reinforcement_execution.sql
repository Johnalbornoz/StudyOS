-- F11-C1 -- Concept Reinforcement Execution Orchestration.
--
-- Purely additive. Zero changes to any existing table, including
-- teacher_interventions (F11-B, frozen) and quiz_sessions/
-- learning_evidence/mastery_records (frozen, still the sole writer of
-- canonical evidence). This table holds only REFERENCES to real
-- executions, never a copy of their state or a second evidence/mastery
-- authority.
--
-- execution_type is constrained to a small, additive vocabulary --
-- 'TOPIC_PRACTICE' is the only value F11-C1 produces. Future adapters
-- (Skill/Competency/Exam, F11-C2/C3/C4) add new enum values here,
-- never a parallel table.
--
-- No cross-table FK on execution_reference: the referenced table
-- varies by execution_type (quiz_sessions today, a different table for
-- a future adapter), mirroring this codebase's own established
-- precedent for a deliberately un-FK'd id when the target genuinely
-- varies (e.g. learner_gap_diagnoses.concept_id).

CREATE TABLE IF NOT EXISTS public.teacher_intervention_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  teacher_intervention_id uuid NOT NULL REFERENCES public.teacher_interventions(id),

  execution_type text NOT NULL,
  execution_reference text NOT NULL,
  idempotency_key text NOT NULL,

  status text NOT NULL DEFAULT 'ACTIVE',

  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT teacher_intervention_executions_execution_type_check CHECK (execution_type IN ('TOPIC_PRACTICE')),
  CONSTRAINT teacher_intervention_executions_status_check CHECK (status IN ('ACTIVE', 'COMPLETED', 'EXPIRED')),
  CONSTRAINT teacher_intervention_executions_reference_nonempty_check CHECK (length(execution_reference) > 0),
  CONSTRAINT teacher_intervention_executions_idempotency_nonempty_check CHECK (length(idempotency_key) > 0),

  -- Orchestration-level idempotency (task's own explicit requirement --
  -- distinct from, and never a substitute for, F5's evidence-level
  -- idempotency): repeated start requests carrying the SAME logical key
  -- for the SAME intervention must recover the SAME row, never create
  -- a second one.
  CONSTRAINT teacher_intervention_executions_idempotency_unique UNIQUE (teacher_intervention_id, idempotency_key),

  -- Verified safe (not merely assumed) against the actual quiz_sessions
  -- id-minting scheme: storeQuiz() mints a fresh, unique quiz_sessions.id
  -- on every call, and this table's only writer (F11-C1's own
  -- orchestration service) always calls storeQuiz() exactly once per
  -- successfully-claimed idempotency key -- so one execution_reference
  -- can only ever legitimately belong to one teacher_intervention.
  CONSTRAINT teacher_intervention_executions_reference_unique UNIQUE (execution_type, execution_reference)
);

CREATE INDEX IF NOT EXISTS idx_teacher_intervention_executions_intervention ON public.teacher_intervention_executions (teacher_intervention_id);
CREATE INDEX IF NOT EXISTS idx_teacher_intervention_executions_status ON public.teacher_intervention_executions (status);
