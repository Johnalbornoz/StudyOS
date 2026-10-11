-- L10 SF-8 (4/5 of the L10 schema batch) -- role onboarding carrier.
-- Findings: L3 P2-14, CR-10 (onboarding part).
--
-- A Student has an onboarding state (student_academic_profile and the
-- onboarding gate). A Parent and a Teacher had none: there was nowhere to
-- record "this account has completed its Parent / Teacher onboarding", so
-- neither role could be routed to onboarding once and then left alone.
--
-- user_role_onboarding is that carrier: one row per (account, role).
--   completed_at IS NULL  -> onboarding started, not finished
--   completed_at NOT NULL -> finished; revisiting skips it
--   no row                -> never started
--
-- STATUS OF THE SPEC: decision D-4 (which profile fields a Parent and a
-- Teacher fill in) was not ruled when this was written. The carrier
-- therefore fixes only what does not depend on it -- completion -- and keeps
-- the answers in `profile` (jsonb), validated by the application against
-- whatever D-4 specifies. If D-4 names fields that deserve their own
-- columns, that is a follow-up migration; nothing here has to be undone.
--
-- Limited to PARENT and TEACHER: the Student keeps its existing model, and
-- INSTITUTION_ADMIN / STUDYUS_ADMIN are capabilities with no onboarding.
--
-- No existing account gets a row: every current Parent and Teacher reads as
-- "never started". Whether they are sent through onboarding or treated as
-- already onboarded is a product choice for the lanes that build the screens
-- (PA-4, TE-5); this file does not decide it.
--
-- Rollback:
--   DROP TABLE IF EXISTS public.user_role_onboarding;
--   DELETE FROM schema_migrations WHERE version = '20261120_1300';

CREATE TABLE IF NOT EXISTS public.user_role_onboarding (
  user_id uuid NOT NULL REFERENCES public.users(id),
  role text NOT NULL,
  profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_role_onboarding_pkey PRIMARY KEY (user_id, role),
  CONSTRAINT user_role_onboarding_role_check CHECK (role IN ('PARENT', 'TEACHER')),
  CONSTRAINT user_role_onboarding_profile_object CHECK (jsonb_typeof(profile) = 'object')
);

COMMENT ON TABLE public.user_role_onboarding IS
  'L10 SF-8: onboarding completion (and D-4 profile answers) for the PARENT and TEACHER roles. One row per (account, role).';
