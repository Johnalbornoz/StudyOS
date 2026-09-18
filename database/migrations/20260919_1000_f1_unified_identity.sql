-- F1: Unified Identity, Roles & Workspaces -- canonical identity anchor
-- layered ADDITIVELY on top of the existing students/profiles split.
--
-- Does NOT replace students.id or profiles.id as any table's foreign
-- key target. Does NOT touch any learning-domain table. Backfill of
-- users/user_roles/students.user_id/profiles.user_id happens in a
-- separate script (scripts/backfill-unified-identity.ts, dry-run by
-- default), never inline in this migration, so it can be re-run,
-- resumed, and audited independently of schema application.
--
-- Fully idempotent (IF NOT EXISTS everywhere) and never applied
-- automatically by build/start -- apply explicitly via
-- `npm run db:migrate` through the governed ledger, same as every
-- other migration in this directory.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_id text NOT NULL,
  email text,
  status text NOT NULL DEFAULT 'ACTIVE',
  active_workspace text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_clerk_id_key UNIQUE (clerk_id),
  CONSTRAINT users_status_check CHECK (status IN ('ACTIVE', 'SUSPENDED')),
  CONSTRAINT users_active_workspace_check CHECK (
    active_workspace IS NULL OR active_workspace IN ('STUDENT', 'PARENT', 'TEACHER', 'INSTITUTION', 'ADMIN')
  )
);

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id),
  role text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  granted_via text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_roles_user_role_key UNIQUE (user_id, role),
  CONSTRAINT user_roles_role_check CHECK (role IN ('STUDENT', 'PARENT', 'TEACHER', 'INSTITUTION_ADMIN', 'STUDYUS_ADMIN')),
  CONSTRAINT user_roles_status_check CHECK (status IN ('ACTIVE', 'REVOKED')),
  CONSTRAINT user_roles_granted_via_check CHECK (granted_via IN ('SELF_REGISTRATION', 'BACKFILL', 'INVITATION'))
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON public.user_roles (user_id) WHERE status = 'ACTIVE';

ALTER TABLE public.students ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.users(id);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.users(id);

CREATE INDEX IF NOT EXISTS idx_students_user_id ON public.students (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON public.profiles (user_id) WHERE user_id IS NOT NULL;
