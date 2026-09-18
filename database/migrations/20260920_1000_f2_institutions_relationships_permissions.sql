-- F2: Institutions, Relationships & Permissions -- authorization
-- relationships layered on top of F1's canonical users/user_roles.
--
-- Extends the EXISTING parent_student_relationships table (adds
-- 'revoked' status + relationship_type) rather than creating a
-- parallel LearnerRelationship table -- that authority already exists.
-- Institution/membership/grade/class/enrollment/assignment are
-- genuinely new (no prior table represented any of this).
--
-- Fully idempotent, never applied automatically by build/start --
-- apply explicitly via `npm run db:migrate`.
-- ---------------------------------------------------------------------

-- --- extend the existing parent relationship table (never replaced) ---

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'parent_student_relationships_status_check_v2'
  ) THEN
    ALTER TABLE public.parent_student_relationships
      DROP CONSTRAINT IF EXISTS parent_student_relationships_status_check;
    ALTER TABLE public.parent_student_relationships
      ADD CONSTRAINT parent_student_relationships_status_check_v2
      CHECK (status IN ('pending', 'accepted', 'declined', 'revoked'));
  END IF;
END $$;

ALTER TABLE public.parent_student_relationships
  ADD COLUMN IF NOT EXISTS relationship_type text NOT NULL DEFAULT 'PARENT';

-- --- new institution domain ---

CREATE TABLE IF NOT EXISTS public.institutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT institutions_status_check CHECK (status IN ('DRAFT', 'ACTIVE', 'SUSPENDED', 'ARCHIVED'))
);

CREATE TABLE IF NOT EXISTS public.institution_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES public.institutions(id),
  user_id uuid NOT NULL REFERENCES public.users(id),
  membership_role text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by_user_id uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT institution_memberships_role_check CHECK (membership_role IN ('TEACHER', 'INSTITUTION_ADMIN')),
  CONSTRAINT institution_memberships_status_check CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'REVOKED')),
  CONSTRAINT institution_memberships_unique UNIQUE (institution_id, user_id, membership_role)
);

CREATE INDEX IF NOT EXISTS idx_institution_memberships_user ON public.institution_memberships (user_id);
CREATE INDEX IF NOT EXISTS idx_institution_memberships_institution_status ON public.institution_memberships (institution_id, status);

CREATE TABLE IF NOT EXISTS public.grades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES public.institutions(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES public.institutions(id),
  grade_id uuid REFERENCES public.grades(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.class_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES public.classes(id),
  student_id uuid NOT NULL REFERENCES public.students(id),
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT class_enrollments_status_check CHECK (status IN ('ACTIVE', 'ENDED')),
  CONSTRAINT class_enrollments_unique UNIQUE (class_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_class_enrollments_student ON public.class_enrollments (student_id) WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS public.teacher_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_membership_id uuid NOT NULL REFERENCES public.institution_memberships(id),
  grade_id uuid REFERENCES public.grades(id),
  class_id uuid REFERENCES public.classes(id),
  subject_label text,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  CONSTRAINT teacher_assignments_status_check CHECK (status IN ('ACTIVE', 'ENDED'))
);

CREATE INDEX IF NOT EXISTS idx_teacher_assignments_membership_active ON public.teacher_assignments (institution_membership_id) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_class_active ON public.teacher_assignments (class_id) WHERE status = 'ACTIVE' AND class_id IS NOT NULL;
