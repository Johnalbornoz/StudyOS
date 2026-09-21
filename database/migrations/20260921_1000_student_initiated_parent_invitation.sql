-- Onboarding/authorization rework (2026-09-21): student-initiated
-- parent invitations.
--
-- `parent_student_relationships.parent_id` is `NOT NULL` and part of
-- its composite primary key `(parent_id, student_id)` -- a parent must
-- already have a `profiles` row before any row in that table can name
-- them, which makes it structurally impossible to represent "a student
-- invited someone@example.com, who has not registered yet" in that
-- table without either (a) making a primary-key column nullable
-- (Postgres forbids NULL in a PK) or (b) inventing a synthetic
-- placeholder profile for an email that may never sign up. Neither is
-- acceptable, so this is a genuinely new, minimal, additive table --
-- not a parallel relationship/authorization system. Once an invitation
-- is accepted, the REAL grant of access is still, exclusively, a row
-- in the existing `parent_student_relationships` table
-- (status='accepted'), created by the same code path F10 already
-- certified -- this table only tracks the pre-registration invite
-- step, never access itself.
--
-- Fully idempotent (IF NOT EXISTS everywhere) and never applied
-- automatically by build/start -- apply explicitly via
-- `npm run db:migrate`, same governance as every other migration here.

CREATE TABLE IF NOT EXISTS public.parent_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.profiles(id),
  invited_email text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  CONSTRAINT parent_invitations_status_check CHECK (status IN ('pending', 'accepted', 'declined', 'revoked'))
);

-- At most one PENDING invitation per (student, email) -- re-inviting an
-- already-pending email is a no-op, never a duplicate row. Case-
-- insensitive: "Parent@x.com" and "parent@x.com" are the same invitee.
CREATE UNIQUE INDEX IF NOT EXISTS idx_parent_invitations_one_pending
  ON public.parent_invitations (student_id, lower(invited_email))
  WHERE status = 'pending';

-- The lookup a PARENT's own acceptance screen needs: "invitations
-- addressed to MY verified email" -- never a search by arbitrary email.
CREATE INDEX IF NOT EXISTS idx_parent_invitations_by_email
  ON public.parent_invitations (lower(invited_email))
  WHERE status = 'pending';
