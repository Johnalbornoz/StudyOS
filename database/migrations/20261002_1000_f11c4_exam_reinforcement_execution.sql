-- F11-C4 -- Exam Reinforcement Execution Orchestration.
--
-- Purely additive, mirroring F11-C2/C3's own precedent. F11-C4 targets
-- an F7/F9 exam-simulation activity rather than an F4 Concept/Skill/
-- Competency, so this migration widens the SAME two tables C1-C3 already
-- widened, plus adds the minimum new columns an EXAM target genuinely
-- needs -- no new table, no second execution registry, no duplicated
-- assessment/simulation state.
--
-- 1. teacher_interventions gains a fourth admissible target_type,
--    'EXAM' (widening the existing CHECK; CONCEPT/SKILL/COMPETENCY/
--    LEARNING_OBJECTIVE rows are completely unaffected).
--
-- 2. teacher_interventions gains THREE new nullable columns:
--      exam_profile_id     -- which of the student's OWN F7
--                              student_exam_profiles this intervention
--                              targets (never duplicated exam/version
--                              data -- the profile is the single
--                              source of truth for exam_definition_id/
--                              exam_version_id, resolved at start time).
--      simulation_type     -- which F9 SimulationType level
--                              (TOPIC_EXAM/DOMAIN_EXAM/MINI_MOCK/
--                              FULL_MOCK) the Teacher is assigning.
--                              Structurally admissible for all four --
--                              whether one actually STARTS depends
--                              entirely on F9's own real, unmodified
--                              getSimulationEligibility() (this is what
--                              keeps the PAA Full Mock Guard un-
--                              bypassable: F11-C4 never special-cases
--                              any simulation_type at the orchestration
--                              layer).
--      academic_subject_id -- required only for DOMAIN_EXAM (F9's own
--                              academicSubjectId parameter); NULL for
--                              every other simulation_type.
--    `learning_objective_id` (already existed, added by F11-B for its
--    own never-yet-used LEARNING_OBJECTIVE target_type) is REUSED for
--    TOPIC_EXAM's objective target -- no new column for it.
--
-- 3. The existing target-consistency CHECK is widened (DROP + ADD, same
--    name) to add the EXAM branch: exactly the F4 FKs stay NULL, exactly
--    exam_profile_id/simulation_type are populated, and
--    learning_objective_id/academic_subject_id are populated only for
--    the ONE simulation_type that actually needs them.
--
-- 4. teacher_intervention_executions.execution_type gains a fifth
--    admissible value, 'EXAM_PRACTICE'. Existing TOPIC_PRACTICE (C1),
--    SKILL_PRACTICE (C2), COMPETENCY_PRACTICE (C3) rows are completely
--    unaffected. execution_reference for an EXAM_PRACTICE row is a real
--    F9 simulation_attempts.id -- F11 stores orchestration linkage, not
--    assessment truth (no new attempt table, no copied attempt state).

ALTER TABLE public.teacher_interventions
  ADD COLUMN IF NOT EXISTS exam_profile_id uuid REFERENCES public.student_exam_profiles(id),
  ADD COLUMN IF NOT EXISTS simulation_type text,
  ADD COLUMN IF NOT EXISTS academic_subject_id uuid REFERENCES public.academic_subjects(id);

ALTER TABLE public.teacher_interventions
  DROP CONSTRAINT IF EXISTS teacher_interventions_target_type_check;
ALTER TABLE public.teacher_interventions
  ADD CONSTRAINT teacher_interventions_target_type_check
  CHECK (target_type IN ('CONCEPT', 'SKILL', 'COMPETENCY', 'LEARNING_OBJECTIVE', 'EXAM'));

ALTER TABLE public.teacher_interventions
  DROP CONSTRAINT IF EXISTS teacher_interventions_simulation_type_check;
ALTER TABLE public.teacher_interventions
  ADD CONSTRAINT teacher_interventions_simulation_type_check
  CHECK (simulation_type IS NULL OR simulation_type IN ('TOPIC_EXAM', 'DOMAIN_EXAM', 'MINI_MOCK', 'FULL_MOCK'));

ALTER TABLE public.teacher_interventions
  DROP CONSTRAINT IF EXISTS teacher_interventions_target_consistency_check;
ALTER TABLE public.teacher_interventions
  ADD CONSTRAINT teacher_interventions_target_consistency_check
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
    )
  );

ALTER TABLE public.teacher_intervention_executions
  DROP CONSTRAINT IF EXISTS teacher_intervention_executions_execution_type_check;
ALTER TABLE public.teacher_intervention_executions
  ADD CONSTRAINT teacher_intervention_executions_execution_type_check
  CHECK (execution_type IN ('TOPIC_PRACTICE', 'SKILL_PRACTICE', 'COMPETENCY_PRACTICE', 'EXAM_PRACTICE'));
