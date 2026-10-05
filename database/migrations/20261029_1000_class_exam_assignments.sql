-- Exam eligibility -- explicit, auditable exam / assessment assignment to a class.
--
-- Strictly additive: one new table, no change to any existing object.
-- Never applied automatically -- governed runner only (DEV first, then
-- Preview; this release never targets Production).
--
--   class_exam_assignments -- an Institution Admin (or the class's Teacher)
--                             adds a preparation objective (objective catalogue
--                             key, e.g. 'pisa.2022', 'cie.igcse.0580.extended')
--                             to a class. Students actively enrolled in the
--                             class see it in Exam Preparation as "Asignado por
--                             tu institución". It never changes a Student's
--                             Academic Profile, curriculum, learner state,
--                             scoring or evidence. Revocation keeps the row
--                             (status REVOKED); every grant / revoke / denial
--                             is also written to academic_governance_events.
--
-- Rollback (only if nothing depends on it yet):
--   DROP TABLE IF EXISTS public.class_exam_assignments;

CREATE TABLE IF NOT EXISTS public.class_exam_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES public.institutions(id),
  class_id uuid NOT NULL REFERENCES public.classes(id),
  objective_key text NOT NULL,
  assigned_by_user_id uuid NOT NULL REFERENCES public.users(id),
  assigned_by_scope text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by_user_id uuid REFERENCES public.users(id),
  CONSTRAINT class_exam_assignments_objective_key_check CHECK (objective_key ~ '^[a-z0-9._-]{1,120}$'),
  CONSTRAINT class_exam_assignments_scope_check CHECK (assigned_by_scope IN ('INSTITUTION', 'TEACHER')),
  CONSTRAINT class_exam_assignments_status_check CHECK (status IN ('ACTIVE', 'REVOKED')),
  CONSTRAINT class_exam_assignments_revoked_check CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL))
);

-- One active assignment of an objective per class (a retry is idempotent).
CREATE UNIQUE INDEX IF NOT EXISTS uq_class_exam_assignments_active
  ON public.class_exam_assignments (class_id, objective_key) WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_class_exam_assignments_institution
  ON public.class_exam_assignments (institution_id, status);

COMMENT ON TABLE public.class_exam_assignments IS
  'Explicit exam / assessment objective assigned to a class (Exam Preparation eligibility). Never modifies the Student curriculum; audited in academic_governance_events.';
