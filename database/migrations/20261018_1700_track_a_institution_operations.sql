-- ============================================================================
-- Track A -- Institution workspace: core administration from the UI (DEV).
--
-- Strictly additive (one CHECK is widened). Never applied automatically --
-- governed runner only. Existing rows keep their meaning: every existing grade
-- and class is ACTIVE; every existing membership keeps its status.
--
--  1. grades: academic level, programme (catalog programme or a label),
--     academic year, status ACTIVE / ARCHIVED (+ archived_at, updated_at).
--     Archiving never deletes: classes, enrollments and history stay.
--  2. classes: status ACTIVE / ARCHIVED, period (e.g. "2026-2027", "T1"),
--     archived_at, updated_at. An archived class keeps its enrollments,
--     plan, assignments, evidence and learner history (read-only history).
--  3. institution_memberships: two more states for teachers --
--     INVITED (the coordinator invited an existing teacher account; the
--     teacher accepts -> APPROVED) and SUSPENDED (the institutional relation
--     is paused: no class access; reactivation -> APPROVED). invited_at,
--     invited_by_user_id and suspended_at record when / who.
--
-- Rollback (manual, DEV only; only while no row uses the new values):
--   ALTER TABLE institution_memberships DROP CONSTRAINT IF EXISTS institution_memberships_status_check;
--   ALTER TABLE institution_memberships ADD CONSTRAINT institution_memberships_status_check CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'REVOKED'));
--   ALTER TABLE institution_memberships DROP COLUMN IF EXISTS invited_at, DROP COLUMN IF EXISTS invited_by_user_id, DROP COLUMN IF EXISTS suspended_at;
--   ALTER TABLE classes DROP COLUMN IF EXISTS status, DROP COLUMN IF EXISTS period, DROP COLUMN IF EXISTS archived_at, DROP COLUMN IF EXISTS updated_at;
--   ALTER TABLE grades DROP COLUMN IF EXISTS academic_level, DROP COLUMN IF EXISTS programme_label, DROP COLUMN IF EXISTS academic_programme_id,
--     DROP COLUMN IF EXISTS academic_year, DROP COLUMN IF EXISTS status, DROP COLUMN IF EXISTS archived_at, DROP COLUMN IF EXISTS updated_at;
--   DELETE FROM schema_migrations WHERE version = '20261018_1700';
-- ============================================================================

-- 1 ------------------------------------------------------------------------
ALTER TABLE grades ADD COLUMN IF NOT EXISTS academic_level text;
ALTER TABLE grades ADD COLUMN IF NOT EXISTS programme_label text;
ALTER TABLE grades ADD COLUMN IF NOT EXISTS academic_programme_id uuid REFERENCES academic_programmes(id);
ALTER TABLE grades ADD COLUMN IF NOT EXISTS academic_year text;
ALTER TABLE grades ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE grades ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE grades ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'grades_status_check') THEN
    ALTER TABLE grades ADD CONSTRAINT grades_status_check CHECK (status IN ('ACTIVE', 'ARCHIVED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'grades_archived_consistency') THEN
    ALTER TABLE grades ADD CONSTRAINT grades_archived_consistency CHECK ((status = 'ARCHIVED') = (archived_at IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'grades_name_length') THEN
    ALTER TABLE grades ADD CONSTRAINT grades_name_length CHECK (char_length(name) BETWEEN 1 AND 120) NOT VALID;
  END IF;
END $$;

-- 2 ------------------------------------------------------------------------
ALTER TABLE classes ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE classes ADD COLUMN IF NOT EXISTS period text;
ALTER TABLE classes ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE classes ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'classes_status_check') THEN
    ALTER TABLE classes ADD CONSTRAINT classes_status_check CHECK (status IN ('ACTIVE', 'ARCHIVED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'classes_archived_consistency') THEN
    ALTER TABLE classes ADD CONSTRAINT classes_archived_consistency CHECK ((status = 'ARCHIVED') = (archived_at IS NOT NULL));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_classes_institution_status ON classes (institution_id, status);

-- 3 ------------------------------------------------------------------------
ALTER TABLE institution_memberships ADD COLUMN IF NOT EXISTS invited_at timestamptz;
ALTER TABLE institution_memberships ADD COLUMN IF NOT EXISTS invited_by_user_id uuid REFERENCES users(id);
ALTER TABLE institution_memberships ADD COLUMN IF NOT EXISTS suspended_at timestamptz;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'institution_memberships_status_check' AND pg_get_constraintdef(oid) NOT LIKE '%SUSPENDED%') THEN
    ALTER TABLE institution_memberships DROP CONSTRAINT institution_memberships_status_check;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'institution_memberships_status_check') THEN
    ALTER TABLE institution_memberships ADD CONSTRAINT institution_memberships_status_check
      CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'REVOKED', 'INVITED', 'SUSPENDED'));
  END IF;
END $$;
