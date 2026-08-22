ALTER TABLE subjects
  ADD COLUMN IF NOT EXISTS ib_programme VARCHAR(10) NOT NULL DEFAULT 'none'
    CHECK (ib_programme IN ('none', 'MYP', 'DP')),
  ADD COLUMN IF NOT EXISTS ib_subject_group VARCHAR(40),
  ADD COLUMN IF NOT EXISTS ib_level VARCHAR(2)
    CHECK (ib_level IS NULL OR ib_level IN ('SL', 'HL'));
