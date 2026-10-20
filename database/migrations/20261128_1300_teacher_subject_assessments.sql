-- TEACHER -- teacher-assigned subject Test / Mock (ADDITIVE ONLY). Follows 20261127_1100.
--
-- Operator rules (overnight pilot 2026-10-16, contract docs/orchestration/OVERNIGHT_2026-10-16_CONTRACTS.md section 3):
-- a Teacher assigns a subject Test ("Prueba por materia") or a subject Mock ("Simulacro por materia") to one student,
-- several students or the whole class. One teacher_interventions row per recipient (grouped by assignment_group_id,
-- exactly as a class assignment), each attempt one quiz_sessions row (subject_assessment_setup.assignmentId = the
-- recipient's teacher_interventions.id, attemptNumber 1..maxAttempts), registered in teacher_intervention_executions.
--
-- What this migration does:
--   1. teacher_interventions.intervention_type admits SUBJECT_TEST and SUBJECT_MOCK (CHECK widened, same name).
--   2. teacher_interventions.target_type admits SUBJECT (CHECK widened, same name); target_consistency_check gains a
--      SUBJECT branch in which every target FK is NULL (the subject and concepts live in the jsonb below). Every
--      existing branch is reproduced verbatim from the live definition.
--   3. teacher_interventions.subject_assessment_assignment jsonb (nullable): the frozen per-assignment configuration
--      { version, kind, subjectId, conceptIds, allSubject, difficultyBand, plan, timing { timed, durationMinutes,
--      recommendedDurationMinutes, ... }, maxAttempts, window { startDate, endDate, timezone, opensAt, closesAt },
--      feedbackPolicy, feedbackRelease, attemptLink, learner { subjectId, conceptIds }, frozenAt }. A SUBJECT row must
--      carry it (CHECK), no other row may.
--   4. teacher_intervention_executions.execution_type admits SUBJECT_ASSESSMENT (one row per attempt; idempotency key
--      'attempt:<n>' is the concurrency guard for starting attempt n).
--   5. An index for reading a recipient's attempts (quiz_sessions by subject_assessment_setup->>'assignmentId').
-- No row is rewritten. Existing CONCEPT / SKILL / COMPETENCY / LEARNING_OBJECTIVE / EXAM rows are unaffected.
--
-- Rollback (only while no SUBJECT row exists; otherwise delete those rows first -- never evidence):
--   DROP INDEX IF EXISTS idx_quiz_sessions_subject_assignment;
--   ALTER TABLE public.teacher_intervention_executions DROP CONSTRAINT IF EXISTS teacher_intervention_executions_execution_type_check;
--   ALTER TABLE public.teacher_intervention_executions ADD CONSTRAINT teacher_intervention_executions_execution_type_check
--     CHECK (execution_type IN ('TOPIC_PRACTICE', 'SKILL_PRACTICE', 'COMPETENCY_PRACTICE', 'EXAM_PRACTICE'));
--   ALTER TABLE public.teacher_interventions DROP CONSTRAINT IF EXISTS teacher_interventions_subject_assignment_check;
--   ALTER TABLE public.teacher_interventions DROP COLUMN IF EXISTS subject_assessment_assignment;
--   (then re-create teacher_interventions_intervention_type_check, _target_type_check and _target_consistency_check
--    exactly as in 20261002_1000_f11c4_exam_reinforcement_execution.sql / 20260928_1000_f11b_teacher_intervention_domain.sql)
--   DELETE FROM schema_migrations WHERE version = '20261128_1300';

ALTER TABLE public.teacher_interventions ADD COLUMN IF NOT EXISTS subject_assessment_assignment jsonb;

ALTER TABLE public.teacher_interventions DROP CONSTRAINT IF EXISTS teacher_interventions_intervention_type_check;
ALTER TABLE public.teacher_interventions ADD CONSTRAINT teacher_interventions_intervention_type_check
  CHECK (intervention_type IN ('CONCEPT_REINFORCEMENT', 'SKILL_PRACTICE', 'COMPETENCY_PRACTICE', 'EXAM_PRACTICE', 'SUBJECT_TEST', 'SUBJECT_MOCK'));

ALTER TABLE public.teacher_interventions DROP CONSTRAINT IF EXISTS teacher_interventions_target_type_check;
ALTER TABLE public.teacher_interventions ADD CONSTRAINT teacher_interventions_target_type_check
  CHECK (target_type IN ('CONCEPT', 'SKILL', 'COMPETENCY', 'LEARNING_OBJECTIVE', 'EXAM', 'SUBJECT'));

ALTER TABLE public.teacher_interventions DROP CONSTRAINT IF EXISTS teacher_interventions_target_consistency_check;
ALTER TABLE public.teacher_interventions ADD CONSTRAINT teacher_interventions_target_consistency_check
  CHECK (
    (target_type = 'CONCEPT' AND concept_id IS NOT NULL AND skill_id IS NULL AND competency_id IS NULL AND learning_objective_id IS NULL AND exam_profile_id IS NULL) OR
    (target_type = 'SKILL' AND skill_id IS NOT NULL AND concept_id IS NULL AND competency_id IS NULL AND learning_objective_id IS NULL AND exam_profile_id IS NULL) OR
    (target_type = 'COMPETENCY' AND competency_id IS NOT NULL AND concept_id IS NULL AND skill_id IS NULL AND learning_objective_id IS NULL AND exam_profile_id IS NULL) OR
    (target_type = 'LEARNING_OBJECTIVE' AND learning_objective_id IS NOT NULL AND concept_id IS NULL AND skill_id IS NULL AND competency_id IS NULL AND exam_profile_id IS NULL) OR
    (
      target_type = 'EXAM' AND concept_id IS NULL AND skill_id IS NULL AND competency_id IS NULL
      AND exam_profile_id IS NOT NULL AND simulation_type IS NOT NULL
      AND (
        (simulation_type = 'TOPIC_EXAM' AND learning_objective_id IS NOT NULL AND academic_subject_id IS NULL) OR
        (simulation_type = 'DOMAIN_EXAM' AND academic_subject_id IS NOT NULL AND learning_objective_id IS NULL) OR
        (simulation_type IN ('MINI_MOCK', 'FULL_MOCK') AND learning_objective_id IS NULL AND academic_subject_id IS NULL)
      )
    ) OR
    (
      target_type = 'SUBJECT' AND concept_id IS NULL AND skill_id IS NULL AND competency_id IS NULL AND learning_objective_id IS NULL
      AND exam_profile_id IS NULL AND simulation_type IS NULL AND academic_subject_id IS NULL
    )
  );

ALTER TABLE public.teacher_interventions DROP CONSTRAINT IF EXISTS teacher_interventions_subject_assignment_check;
ALTER TABLE public.teacher_interventions ADD CONSTRAINT teacher_interventions_subject_assignment_check
  CHECK (
    (intervention_type IN ('SUBJECT_TEST', 'SUBJECT_MOCK') AND target_type = 'SUBJECT' AND subject_assessment_assignment IS NOT NULL) OR
    (intervention_type NOT IN ('SUBJECT_TEST', 'SUBJECT_MOCK') AND target_type <> 'SUBJECT' AND subject_assessment_assignment IS NULL)
  );

ALTER TABLE public.teacher_intervention_executions DROP CONSTRAINT IF EXISTS teacher_intervention_executions_execution_type_check;
ALTER TABLE public.teacher_intervention_executions ADD CONSTRAINT teacher_intervention_executions_execution_type_check
  CHECK (execution_type IN ('TOPIC_PRACTICE', 'SKILL_PRACTICE', 'COMPETENCY_PRACTICE', 'EXAM_PRACTICE', 'SUBJECT_ASSESSMENT'));

CREATE INDEX IF NOT EXISTS idx_quiz_sessions_subject_assignment
  ON public.quiz_sessions ((subject_assessment_setup->>'assignmentId'))
  WHERE subject_assessment_setup ? 'assignmentId';
