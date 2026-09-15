-- CANON-R4R1: persistent migration-recognition storage.
--
-- Fully additive: ONE new table, no changes to any existing table, no
-- data rewrite, no seed rows, no rewrite of learning_evidence.
--
-- Preserves traceability for legacy achievements recognized as
-- satisfying a Pedagogical Engine v1 requirement at migration time,
-- WITHOUT ever fabricating a v1 evidence row. `recognition_basis`
-- distinguishes the one-time, LEARN-only automatic baseline
-- (LEGACY_MIGRATION_BASELINE, granted once per preexisting
-- (student, concept) pair) from the old-policy-dimension-grounded
-- ladder (LEGACY_POLICY_RECOGNITION, Practice/Prove/Retention/Transfer).
--
-- This migration is NOT applied by this phase -- no live DB access in
-- this environment (see docs/CANON_R4R1_PRE_V1_LEARN_BASELINE.md's
-- STATUS section). It is written and reviewed so a future
-- Preview-connected session can run `npm run db:migrate` and have it
-- applied automatically, to PREVIEW ONLY -- Production cutover remains
-- unconfigured.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pedagogical_requirement_recognition (
  -- Deterministically derived from (student_id, concept_id, requirement,
  -- migration_version) by the application layer (never a random UUID)
  -- so re-deriving the same recognition twice yields the same id --
  -- the basis of idempotent apply (Part 32).
  id TEXT PRIMARY KEY,

  student_id UUID NOT NULL REFERENCES students(id),
  concept_id UUID NOT NULL REFERENCES concepts(id),

  requirement TEXT NOT NULL
    CHECK (requirement IN ('LEARN', 'PRACTICE', 'PROVE', 'RETAIN', 'TRANSFER')),

  recognition_basis TEXT NOT NULL
    CHECK (recognition_basis IN ('LEGACY_MIGRATION_BASELINE', 'LEGACY_POLICY_RECOGNITION')),

  legacy_policy_version TEXT NOT NULL DEFAULT 'LEGACY_UNVERSIONED',

  -- Opaque learning_evidence.id values only, when traceable -- never
  -- learner content. Empty for a LEGACY_MIGRATION_BASELINE recognition
  -- (grounded in mere preexistence, not any specific row) and for any
  -- recognition grounded in an aggregate Concept Knowledge State read
  -- rather than individual rows.
  source_evidence_ids UUID[] NOT NULL DEFAULT '{}',

  reason_code TEXT NOT NULL,

  recognized_at TIMESTAMPTZ NOT NULL,
  migration_version TEXT NOT NULL,
  cutover_at TIMESTAMPTZ NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- The core idempotency/no-duplicates guarantee (Part 3's own
  -- recommended constraint, Part 32's own requirement): one recognition
  -- per (student, concept, requirement) per migration run.
  UNIQUE (student_id, concept_id, requirement, migration_version)
);

CREATE INDEX IF NOT EXISTS idx_pedagogical_requirement_recognition_lookup
  ON pedagogical_requirement_recognition (student_id, concept_id, migration_version);
