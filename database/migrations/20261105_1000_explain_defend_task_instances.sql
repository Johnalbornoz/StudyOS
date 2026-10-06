-- Human Agency P0-3 -- server-side authoritative Explain & Defend task registry (additive).
--
-- Before: /api/cognitive/explain/generate returned the grading rubric (expectedElements) to the browser
-- BEFORE the Student answered, and /api/cognitive/explain/submit graded the answer against whatever
-- prompt / expectedElements / conceptLabel the client sent back -- the client could change the criteria an
-- AI grader used to update mastery.
--
-- After: generate persists the task here, keyed by the server-minted activityId, and returns only the
-- presentation (prompt + activityId). submit loads THIS row by (activityId, student) and grades against the
-- persisted prompt, expectedElements and concept label only; a client-supplied rubric is rejected. Same
-- pattern as transfer_task_instances (20260908_1000).
--
-- Holds the generated question and its rubric (server authority), never the Student's answer, never AI
-- feedback, never learner state. No backfill: there is no trustworthy source for historical rubrics (they
-- only ever existed in the browser), so pre-existing activities simply cannot be submitted after deploy and
-- the Student generates a new one.
--
-- Rollback:
--   DROP TABLE IF EXISTS public.explain_defend_task_instances;
--   DELETE FROM schema_migrations WHERE version = '20261105_1000';

CREATE TABLE IF NOT EXISTS public.explain_defend_task_instances (
  id uuid PRIMARY KEY,                                   -- == activityId (server-minted at generate)
  student_id uuid NOT NULL REFERENCES public.students(id),
  subject_id uuid NOT NULL REFERENCES public.subjects(id),
  concept_id uuid NOT NULL REFERENCES public.concepts(id),
  concept_label text NOT NULL CHECK (char_length(concept_label) BETWEEN 1 AND 300),
  activity_type text NOT NULL CHECK (activity_type IN ('EXPLAIN', 'JUSTIFY', 'ERROR_ANALYSIS', 'PREDICT', 'COMPARE', 'TEACH_BACK')),
  language text NOT NULL CHECK (char_length(language) BETWEEN 2 AND 10),
  prompt text NOT NULL CHECK (char_length(prompt) BETWEEN 1 AND 4000),
  expected_elements jsonb NOT NULL CHECK (jsonb_typeof(expected_elements) = 'array'),
  rubric_version text NOT NULL,                          -- the server rubric contract this task was generated under
  generator_prompt_id text NOT NULL,
  generator_prompt_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CONSTRAINT explain_defend_task_instances_expiry_check CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_explain_defend_task_instances_student
  ON public.explain_defend_task_instances (student_id, concept_id, created_at DESC);
