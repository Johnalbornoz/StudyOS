-- L10 SF-10 (3/3 of the L10 schema batch) -- one persona per account,
-- enforced by the database. Findings: L3 P2-7, CR-11.
--
-- The product rule (Track A amendment, 2026-10-01; src/lib/identity/types.ts)
-- is: an account holds at most ONE persona -- STUDENT, PARENT or TEACHER.
-- INSTITUTION_ADMIN and STUDYUS_ADMIN are capabilities, not personas, and
-- are unaffected.
--
-- Until now only application code enforced it (assignSelfServiceRole under a
-- row lock; the admin console's addRole with a read-then-write check that
-- two concurrent grants could both pass). Any other writer -- a script, a
-- direct INSERT -- could add a second persona. This index makes the rule
-- hold whoever writes: at most one ACTIVE persona row per account.
--
-- Scope, deliberately ACTIVE rows only. The administrator's persona change
-- is "revoke the current persona, then grant the new one" (addRole), which
-- leaves a REVOKED row beside the new ACTIVE one; that is a supported flow
-- and stays valid. The stricter self-service rule -- a REVOKED persona still
-- counts and cannot be replaced by the account itself -- remains in
-- assignSelfServiceRole; it is a rule about who may change a persona, not
-- about what the table may hold.
--
-- DECISION: D-6, confirmed by the Orchestrator (L10-R2). One ACTIVE primary
-- persona per account; Student / Parent / Teacher are mutually exclusive
-- active personas; administrator and coordinator authority are privileges or
-- memberships, never an additional persona.
--
-- PRE-CHECK -- this migration REFUSES to apply if any account already holds
-- more than one ACTIVE persona. It changes no data and deletes no role: legacy
-- multi-persona accounts must be resolved deliberately by an administrator
-- first. The count to run beforehand (read-only):
--
--   SELECT user_id, array_agg(role ORDER BY role) AS personas
--   FROM user_roles WHERE role IN ('STUDENT', 'PARENT', 'TEACHER') AND status = 'ACTIVE'
--   GROUP BY user_id HAVING count(*) > 1;
--
-- It is the LAST file of the batch on purpose: if the pre-check stops it,
-- the two files before it are already applied and do not depend on it.
--
-- Rollback:
--   DROP INDEX IF EXISTS public.uq_user_roles_one_persona;
--   DELETE FROM schema_migrations WHERE version = '20261120_1200';

DO $$
DECLARE
  offenders integer;
BEGIN
  SELECT count(*) INTO offenders FROM (
    SELECT user_id FROM public.user_roles
    WHERE role IN ('STUDENT', 'PARENT', 'TEACHER') AND status = 'ACTIVE'
    GROUP BY user_id HAVING count(*) > 1
  ) t;
  IF offenders > 0 THEN
    RAISE EXCEPTION 'SF10_MULTI_PERSONA_ACCOUNTS_EXIST: % account(s) hold more than one ACTIVE persona role; resolve them before applying 20261120_1200 (see the query in this file''s header)', offenders;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_roles_one_persona
  ON public.user_roles (user_id)
  WHERE role IN ('STUDENT', 'PARENT', 'TEACHER') AND status = 'ACTIVE';
