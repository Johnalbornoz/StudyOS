-- StudyUs Phase 7 Step 7C1: canonical Transfer State schema foundation.
--
-- Fully additive: ONE new table, no changes to any existing table, no
-- data rewrite. Mirrors concept_memory_state's conventions exactly
-- (surrogate UUID id PK, FK'd student_id/concept_id, UNIQUE(student_id,
-- concept_id) as the logical key, CHECK-constrained enum/range columns,
-- created_at/updated_at TIMESTAMPTZ DEFAULT NOW(), explicit per-column
-- lookup indexes).
--
-- NOT wired into any live code path as of this migration. No production
-- caller reads or writes this table yet:
--   * the projector (projectConceptTransferState) is 7C2,
--   * historical backfill is 7C3,
--   * Phase 4 consumption is 7E.
-- After this migration the expected row count is ZERO and stays zero
-- until 7C2/7C3.
--
-- The state row is shaped to receive the aggregates that
-- src/lib/transfer-policy.ts's transferDepthTransition needs
-- (per-distance success counts, the set of distinct novelty
-- dimensions demonstrated, the last successful distance/time, and the
-- monotonic transfer_depth). Task-family continuity is deliberately
-- NOT persisted here: the 7C2 projector derives it from the same
-- bounded canonical learning_evidence scan it already performs, once
-- 7D generation emits structured task metadata. Nothing in this schema
-- makes novelty-dimension coverage, task families, or FAR
-- generalization "established" before that structured metadata exists.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS concept_transfer_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id),
  concept_id UUID NOT NULL REFERENCES concepts(id),

  -- Advisory mirror of computeTransferScore at projection time; the
  -- Knowledge State `transfer` dimension still recomputes its own value
  -- from learning_evidence (unchanged). NULL before the first
  -- qualifying attempt.
  demonstrated_transfer_score INT
    CHECK (demonstrated_transfer_score IS NULL OR (demonstrated_transfer_score >= 0 AND demonstrated_transfer_score <= 100)),

  near_transfer_success_count INT NOT NULL DEFAULT 0 CHECK (near_transfer_success_count >= 0),
  mid_transfer_success_count  INT NOT NULL DEFAULT 0 CHECK (mid_transfer_success_count  >= 0),
  far_transfer_success_count  INT NOT NULL DEFAULT 0 CHECK (far_transfer_success_count  >= 0),

  -- Distinct NoveltyDimension values demonstrated in a qualifying
  -- SUCCESS. Empty until 7D metadata exists -- never populated by 7C1.
  distinct_novelty_dimensions_ok TEXT[] NOT NULL DEFAULT '{}',

  last_successful_transfer_at TIMESTAMPTZ,
  last_successful_transfer_distance TEXT
    CHECK (last_successful_transfer_distance IS NULL OR last_successful_transfer_distance IN ('NEAR', 'MID', 'FAR')),

  transfer_depth TEXT NOT NULL DEFAULT 'NONE'
    CHECK (transfer_depth IN ('NONE', 'NEAR_DEMONSTRATED', 'GENERALIZED', 'ROBUST')),

  policy_version INT NOT NULL CHECK (policy_version > 0),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (student_id, concept_id)
);

-- Future Phase 4 (7E) reads every row for one student in one batch.
-- The UNIQUE(student_id, concept_id) index already covers
-- `WHERE student_id = $1` by leftmost prefix; this explicit index is
-- kept only for parity with concept_memory_state's own convention.
CREATE INDEX IF NOT EXISTS idx_concept_transfer_state_student ON concept_transfer_state(student_id);
CREATE INDEX IF NOT EXISTS idx_concept_transfer_state_concept ON concept_transfer_state(concept_id);
