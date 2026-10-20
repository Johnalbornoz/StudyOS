-- Track A -- institution profile + coordinator (Institution Admin) invitations.
-- Additive and idempotent; DEV only until the track is merged.
--
-- 1. institutions: the profile a Platform Admin fills in at creation
--    (display name, country, region, curriculum, primary contact, timezone,
--    locale) and a unique `slug` (from the name) that blocks duplicate
--    institutions. Existing rows get a collision-free slug (name + id prefix).
--
-- 2. institution_admin_invitations: a coordinator invitation for a person who
--    may not have an account yet. Only a hash of the one-time token is
--    stored. At most one PENDING invitation per (institution, email).
--    Acceptance creates the APPROVED INSTITUTION_ADMIN membership through the
--    existing controlled path; nothing here grants access by itself.
--
-- Rollback (DEV only; one transaction):
--   DROP TABLE IF EXISTS institution_admin_invitations;
--   DROP INDEX IF EXISTS uq_institutions_slug;
--   ALTER TABLE institutions DROP CONSTRAINT IF EXISTS institutions_country_iso2;
--   ALTER TABLE institutions DROP COLUMN IF EXISTS display_name, DROP COLUMN IF EXISTS slug, DROP COLUMN IF EXISTS country,
--     DROP COLUMN IF EXISTS region, DROP COLUMN IF EXISTS curriculum, DROP COLUMN IF EXISTS primary_contact_name,
--     DROP COLUMN IF EXISTS primary_contact_email, DROP COLUMN IF EXISTS timezone, DROP COLUMN IF EXISTS locale;
--   DELETE FROM schema_migrations WHERE version = '20261018_1200';

ALTER TABLE institutions
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS region text,
  ADD COLUMN IF NOT EXISTS curriculum text,
  ADD COLUMN IF NOT EXISTS primary_contact_name text,
  ADD COLUMN IF NOT EXISTS primary_contact_email text,
  ADD COLUMN IF NOT EXISTS timezone text,
  ADD COLUMN IF NOT EXISTS locale text;

UPDATE institutions
SET slug = trim(both '-' from lower(regexp_replace(translate(name, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN'), '[^a-zA-Z0-9]+', '-', 'g')))
           || '-' || left(id::text, 8)
WHERE slug IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_institutions_slug ON institutions (slug);

ALTER TABLE institutions DROP CONSTRAINT IF EXISTS institutions_country_iso2;
ALTER TABLE institutions ADD CONSTRAINT institutions_country_iso2 CHECK (country IS NULL OR country ~ '^[A-Z]{2}$');

CREATE TABLE IF NOT EXISTS institution_admin_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institutions(id),
  email text NOT NULL,
  invitee_name text,
  token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED')),
  invited_by_user_id uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_user_id uuid REFERENCES users(id),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT institution_admin_invitations_email_lower CHECK (email = lower(email))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_institution_admin_invitation_pending
  ON institution_admin_invitations (institution_id, email) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_institution_admin_invitations_email ON institution_admin_invitations (email);
