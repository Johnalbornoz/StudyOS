-- Student-owned scheduled assessments (ledger 86 -> 87) -- the schedule of a
-- Student's own partial exam ("Crear examen" on a Subject, intent
-- AD_HOC_CONCEPT_EXAM).
--
-- Ruling (Orchestrator, 2026-10-11): a Student may schedule an ad-hoc exam
-- for a DATE AND TIME, may hold several at once -- several for the same
-- Subject, over different concept subsets -- and each schedule keeps exactly
-- what was chosen: Student, Subject, the exact concepts, size (depth), time
-- available, difficulty, the moment and the Student's timezone.
--
-- Why new tables. Nothing existing can hold this:
--   assessment_occurrences / assessment_schedule_rules   the school's "next
--       exam" of a Subject: one record, a DATE only, not the Student's own.
--   learning_plan_item        the machine's plan: one concept, a DATE only.
--   simulation_plans          requires an official exam version.
-- These tables reference none of them and none of them references these.
-- Nothing here says official, mock, predicted grade or exam version: the
-- only intent the table accepts is AD_HOC_CONCEPT_EXAM.
--
-- Shape.
--   student_scheduled_assessments            one row per schedule. NO
--       uniqueness on (student, subject): any number may coexist.
--   student_scheduled_assessment_concepts    the exact concept scope, one row
--       per concept. `concept_count` on the parent is the size of the scope
--       when it was saved: if a concept is later deleted (its row goes with
--       it), the launch can see that the scope is no longer the one that was
--       scheduled and refuses instead of starting a smaller exam.
--
-- Lifecycle: SCHEDULED -> STARTED -> COMPLETED, and SCHEDULED -> CANCELLED.
-- A started schedule points at the quiz session that executes it.
-- quiz_sessions.id is TEXT (baseline), so quiz_session_id is TEXT with a real
-- foreign key; ON DELETE SET NULL because sessions are operational rows that
-- housekeeping may remove, and the schedule's own history must survive that.
--
-- Additive only: no existing table, column, constraint or row changes.
--
-- Rollback:
--   DROP TABLE IF EXISTS public.student_scheduled_assessment_concepts;
--   DROP TABLE IF EXISTS public.student_scheduled_assessments;
--   DELETE FROM schema_migrations WHERE version = '20261121_1000';

CREATE TABLE IF NOT EXISTS public.student_scheduled_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  intent text NOT NULL DEFAULT 'AD_HOC_CONCEPT_EXAM',
  scheduled_at timestamptz NOT NULL,
  -- the Student's IANA timezone when the schedule was saved (e.g. America/Bogota)
  timezone text NOT NULL,
  depth text NOT NULL,
  available_minutes integer,
  -- the difficulty the Student chose (the Question Bank's item bands); NULL = not stated
  difficulty_band text,
  concept_count integer NOT NULL,
  status text NOT NULL DEFAULT 'SCHEDULED',
  quiz_session_id text REFERENCES public.quiz_sessions(id) ON DELETE SET NULL,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT student_scheduled_assessments_intent_check CHECK (intent = 'AD_HOC_CONCEPT_EXAM'),
  CONSTRAINT student_scheduled_assessments_depth_check CHECK (depth IN ('QUICK', 'BALANCED', 'DEEP')),
  CONSTRAINT student_scheduled_assessments_status_check CHECK (status IN ('SCHEDULED', 'STARTED', 'COMPLETED', 'CANCELLED')),
  CONSTRAINT student_scheduled_assessments_timezone_check CHECK (char_length(timezone) BETWEEN 1 AND 64),
  CONSTRAINT student_scheduled_assessments_difficulty_check CHECK (difficulty_band IS NULL OR difficulty_band IN ('LOW', 'MEDIUM', 'HIGH')),
  CONSTRAINT student_scheduled_assessments_minutes_check CHECK (available_minutes IS NULL OR available_minutes BETWEEN 1 AND 600),
  CONSTRAINT student_scheduled_assessments_concept_count_check CHECK (concept_count BETWEEN 1 AND 60),
  -- a schedule that was never started has no session and no start; one that started says when
  CONSTRAINT student_scheduled_assessments_lifecycle_check CHECK (
    (status IN ('SCHEDULED', 'CANCELLED') AND quiz_session_id IS NULL AND started_at IS NULL AND completed_at IS NULL)
    OR (status = 'STARTED' AND started_at IS NOT NULL AND completed_at IS NULL)
    OR (status = 'COMPLETED' AND started_at IS NOT NULL AND completed_at IS NOT NULL)
  ),
  CONSTRAINT student_scheduled_assessments_cancelled_check CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS public.student_scheduled_assessment_concepts (
  scheduled_assessment_id uuid NOT NULL REFERENCES public.student_scheduled_assessments(id) ON DELETE CASCADE,
  concept_id uuid NOT NULL REFERENCES public.concepts(id) ON DELETE CASCADE,
  PRIMARY KEY (scheduled_assessment_id, concept_id)
);

-- the Student's upcoming schedules, soonest first
CREATE INDEX IF NOT EXISTS idx_student_scheduled_assessments_upcoming
  ON public.student_scheduled_assessments (student_id, scheduled_at)
  WHERE status = 'SCHEDULED';

-- the Student's schedules by status and moment (history, started, cancelled)
CREATE INDEX IF NOT EXISTS idx_student_scheduled_assessments_student_status
  ON public.student_scheduled_assessments (student_id, status, scheduled_at);

-- the schedules of one Subject (deliberately NOT unique: several may coexist)
CREATE INDEX IF NOT EXISTS idx_student_scheduled_assessments_subject
  ON public.student_scheduled_assessments (subject_id, scheduled_at);

-- one schedule per executing session, and the completion's lookup by session
CREATE UNIQUE INDEX IF NOT EXISTS uq_student_scheduled_assessments_session
  ON public.student_scheduled_assessments (quiz_session_id)
  WHERE quiz_session_id IS NOT NULL;

-- the concept side of the scope (and of the cascade from concepts)
CREATE INDEX IF NOT EXISTS idx_student_scheduled_assessment_concepts_concept
  ON public.student_scheduled_assessment_concepts (concept_id);
