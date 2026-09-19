-- F11-C3 -- Competency Reinforcement Execution Orchestration.
--
-- Two small, additive, backward-compatible changes, mirroring F11-C2's
-- own Skill extension exactly:
--
-- 1. teacher_intervention_executions.execution_type gains a third
--    admissible value, 'COMPETENCY_PRACTICE'. Existing 'TOPIC_PRACTICE'
--    (F11-C1) and 'SKILL_PRACTICE' (F11-C2) rows are completely
--    unaffected -- this widens the CHECK, it never renames or
--    reinterprets anything.
--
-- 2. quiz_sessions gains one new, nullable column,
--    `target_competency_ids`, kept deliberately SEPARATE from F11-C2's
--    `target_skill_ids` (not reused/conflated) so a future quiz could,
--    in principle, carry both tags independently and traceably. NULL
--    for every existing row and for every ordinary or
--    Concept/Skill-reinforcement quiz going forward -- only F11-C3's own
--    Competency-reinforcement orchestration ever populates it.

ALTER TABLE public.teacher_intervention_executions
  DROP CONSTRAINT IF EXISTS teacher_intervention_executions_execution_type_check;
ALTER TABLE public.teacher_intervention_executions
  ADD CONSTRAINT teacher_intervention_executions_execution_type_check
  CHECK (execution_type IN ('TOPIC_PRACTICE', 'SKILL_PRACTICE', 'COMPETENCY_PRACTICE'));

ALTER TABLE public.quiz_sessions ADD COLUMN IF NOT EXISTS target_competency_ids uuid[];
