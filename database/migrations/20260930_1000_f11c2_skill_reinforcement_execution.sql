-- F11-C2 -- Skill Reinforcement Execution Orchestration.
--
-- Two small, additive, backward-compatible changes:
--
-- 1. teacher_intervention_executions.execution_type gains a second
--    admissible value, 'SKILL_PRACTICE'. Existing 'TOPIC_PRACTICE' rows
--    (F11-C1) are completely unaffected -- this widens the CHECK, it
--    never renames or reinterprets anything.
--
-- 2. quiz_sessions gains one new, nullable column, `target_skill_ids`.
--    NULL for every existing row and for every ordinary,
--    student-initiated Practice quiz going forward -- only F11-C2's own
--    Skill-reinforcement orchestration ever populates it. This is the
--    one additive extension task §9 explicitly authorized (rather than
--    forking or modifying the existing Practice engine's actual
--    generation/grading logic) so the real, unmodified submit route can
--    propagate an explicit Skill target into learning_evidence.metadata
--    without F11-C2 ever writing evidence itself.

ALTER TABLE public.teacher_intervention_executions
  DROP CONSTRAINT IF EXISTS teacher_intervention_executions_execution_type_check;
ALTER TABLE public.teacher_intervention_executions
  ADD CONSTRAINT teacher_intervention_executions_execution_type_check
  CHECK (execution_type IN ('TOPIC_PRACTICE', 'SKILL_PRACTICE'));

ALTER TABLE public.quiz_sessions ADD COLUMN IF NOT EXISTS target_skill_ids uuid[];
