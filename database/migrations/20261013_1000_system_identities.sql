-- Admin/Auth reset block -- technical (non-human) identities.
--
-- Some catalog/curriculum records need a `users` row as their
-- editor/reviewer/publisher (e.g. the pilot exam catalog seed). Those
-- rows are service identities, not people: they have no Clerk account,
-- never sign in, and must not appear in human-account lists, counts or
-- Clerk reconciliation. This column marks them explicitly instead of
-- inferring it from naming conventions.
--
-- Additive only, defaults to false (every existing row stays human).
-- Never applied automatically -- governed runner only.

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.users.is_system IS
  'Technical/service identity (no Clerk account, never signs in). Excluded from human user lists, counts and Clerk reconciliation.';
