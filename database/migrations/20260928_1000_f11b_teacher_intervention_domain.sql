-- F11-B -- Teacher Intervention Domain.
--
-- Purely additive. Zero changes to Canonical V2, F2, F4, F5, F6, F7,
-- F8, F9, or F10 tables. A `teacher_interventions` row represents
-- Teacher PEDAGOGICAL INTENT + ASSIGNMENT -- never the execution
-- itself. F8's `intervention_sessions`/`intervention_attempts` remain
-- the sole owner of learner/self-service AI remediation execution and
-- canonical evidence writes; this table never writes to
-- learning_evidence, mastery_records, or any F8 table.
--
-- Scope correction from the F11-B architecture review: no
-- `resulting_intervention_session_id` and no
-- `assigned_via_class_batch_id` in this migration -- the F11
-- intervention <-> F8 execution translation contract, and class-level
-- batch assignment, are both deferred to a later phase. F11-B is
-- individual-student assignment only.

CREATE TABLE IF NOT EXISTS public.teacher_interventions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  assigned_by_user_id uuid NOT NULL REFERENCES public.users(id),
  institution_id uuid NOT NULL REFERENCES public.institutions(id),
  class_id uuid NOT NULL REFERENCES public.classes(id),
  student_id uuid NOT NULL REFERENCES public.students(id),

  target_type text NOT NULL,
  concept_id uuid REFERENCES public.concepts(id),
  skill_id uuid REFERENCES public.skills(id),
  competency_id uuid REFERENCES public.competencies(id),
  learning_objective_id uuid REFERENCES public.learning_objectives(id),

  intervention_type text NOT NULL,

  reason text,
  instructions text,

  assigned_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz,

  status text NOT NULL DEFAULT 'ASSIGNED',

  cancelled_at timestamptz,
  cancelled_by_user_id uuid REFERENCES public.users(id),
  cancellation_reason text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT teacher_interventions_target_type_check CHECK (target_type IN ('CONCEPT', 'SKILL', 'COMPETENCY', 'LEARNING_OBJECTIVE')),
  CONSTRAINT teacher_interventions_intervention_type_check CHECK (intervention_type IN ('CONCEPT_REINFORCEMENT', 'SKILL_PRACTICE', 'COMPETENCY_PRACTICE', 'EXAM_PRACTICE')),
  CONSTRAINT teacher_interventions_status_check CHECK (status IN ('ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED')),

  -- Exactly one target FK is populated, and it matches target_type --
  -- never a polymorphic edge with no referential integrity (mirrors
  -- F6's own stated rationale for concrete FK columns over one
  -- polymorphic table).
  CONSTRAINT teacher_interventions_target_consistency_check CHECK (
    (target_type = 'CONCEPT' AND concept_id IS NOT NULL AND skill_id IS NULL AND competency_id IS NULL AND learning_objective_id IS NULL) OR
    (target_type = 'SKILL' AND skill_id IS NOT NULL AND concept_id IS NULL AND competency_id IS NULL AND learning_objective_id IS NULL) OR
    (target_type = 'COMPETENCY' AND competency_id IS NOT NULL AND concept_id IS NULL AND skill_id IS NULL AND learning_objective_id IS NULL) OR
    (target_type = 'LEARNING_OBJECTIVE' AND learning_objective_id IS NOT NULL AND concept_id IS NULL AND skill_id IS NULL AND competency_id IS NULL)
  ),

  -- Cancellation metadata is populated exactly when, and only when,
  -- status is CANCELLED -- never left half-populated.
  CONSTRAINT teacher_interventions_cancellation_check CHECK (
    (status = 'CANCELLED' AND cancelled_at IS NOT NULL AND cancelled_by_user_id IS NOT NULL) OR
    (status != 'CANCELLED' AND cancelled_at IS NULL AND cancelled_by_user_id IS NULL AND cancellation_reason IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_teacher_interventions_student ON public.teacher_interventions (student_id, assigned_at DESC);
CREATE INDEX IF NOT EXISTS idx_teacher_interventions_assigned_by ON public.teacher_interventions (assigned_by_user_id, assigned_at DESC);
CREATE INDEX IF NOT EXISTS idx_teacher_interventions_class ON public.teacher_interventions (class_id);
CREATE INDEX IF NOT EXISTS idx_teacher_interventions_status ON public.teacher_interventions (status);
