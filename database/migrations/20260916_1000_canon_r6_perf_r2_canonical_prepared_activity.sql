-- CANON-R6-PERF-R2: selective canonical activity pre-generation.
--
-- Fully additive: ONE new table, no changes to any existing table, no
-- data rewrite, no backfill.
--
-- Deliberately generic naming (`canonical_prepared_activity`, `stage`
-- column CHECK-constrained but only 'PROVE' is ever written by this
-- phase) so a future phase can extend this same mechanism to
-- RETAIN/TRANSFER preparation without a second table -- but this
-- migration and every writer this phase adds activate ONLY PROVE (Part
-- 31/32's own instruction: "avoid a Prove-specific dead-end... but
-- activate only PROVE").
--
-- A row here is PREPARED CONTENT, never a learner attempt -- it is
-- explicitly NOT a quiz_sessions row, and creating one never implies a
-- quiz was administered. `consumed_by_quiz_id` is the ONLY link to a
-- real attempt, populated exactly once, atomically, at the moment a
-- learner's click actually turns prepared content into a real
-- quiz_sessions row (generate-and-take's own canonical_prove branch,
-- via `storeQuiz`) -- see
-- src/services/canonical-prepared-activity.service.ts.
--
-- The partial unique index below is the actual dedup guarantee (Part
-- 1/5): at most one ACTIVE (PREPARING or READY) prepared activity per
-- (student, concept, stage, pedagogical_policy_version). A second
-- preparation attempt for the same canonical identity while one is
-- already active is a structural no-op (INSERT ... ON CONFLICT DO
-- NOTHING), never a duplicate speculative generation. `canonical_revision`
-- is deliberately NOT part of this uniqueness key (Part 9: a revision
-- bump unrelated to the Prove contract must never be treated as "this
-- concept needs a brand-new preparation" while a perfectly compatible
-- one is already active) -- compatibility at consumption time is
-- checked against the stored `activity_contract` snapshot instead, in
-- application code, not via a DB constraint.
--
-- This migration is NOT applied by this phase -- no live DB access in
-- this environment (see
-- docs/CANON_R6_PERF_R2_PREGEN_AND_FOCUS_LOADING.md's STATUS section).
-- It is written and reviewed so a future Preview-connected session can
-- run `npm run db:migrate` and have it applied automatically, to
-- PREVIEW ONLY -- Production cutover remains unconfigured.
--
-- CANON-R6-PERF-R2R1 (stale-lock recovery) note: this schema already
-- supports that phase's own recovery mechanism with NO changes here --
-- `status` already includes 'INVALIDATED' and 'FAILED', and
-- `expires_at`/`created_at` already exist. That phase's own two cleanup
-- UPDATEs (retiring an expired READY row to INVALIDATED, and a stale
-- PREPARING row past its lease to FAILED) run entirely in application
-- code, against columns/values this table already has. See
-- docs/CANON_R6_PERF_R2R1_STALE_PREPARATION_RECOVERY.md.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS canonical_prepared_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  student_id UUID NOT NULL REFERENCES students(id),
  concept_id UUID NOT NULL REFERENCES concepts(id),

  -- Only 'PROVE' is ever written today; the column is intentionally
  -- widened in its CHECK so a future phase can add RETAIN/TRANSFER
  -- preparation onto this SAME table without another migration.
  stage TEXT NOT NULL CHECK (stage IN ('PROVE', 'RETAIN', 'TRANSFER')),

  pedagogical_policy_version TEXT NOT NULL,
  canonical_revision TEXT NOT NULL,

  -- Snapshot of the activityContract this batch was generated against
  -- (itemCount, difficulty, independence, supportLevel,
  -- minimumScorePercent) -- the SAME shape already used by
  -- quiz_sessions.canonical_activity_contract. Compared against the
  -- FRESH contract at consumption time; never trusted as still valid
  -- merely because the row exists.
  activity_contract JSONB NOT NULL,

  status TEXT NOT NULL DEFAULT 'PREPARING'
    CHECK (status IN ('PREPARING', 'READY', 'CONSUMED', 'INVALIDATED', 'FAILED')),

  -- NULL until READY. The actual generated (Quality-Gate-passed,
  -- novelty-filtered) question batch -- the SAME GeneratedQuestion[]
  -- shape quiz_sessions.questions already stores.
  questions JSONB,

  novelty_policy TEXT,
  -- Diagnostic only (Part 7): how many prior-Practice fingerprints this
  -- batch was checked against at PREPARATION time, and a content hash
  -- of that fingerprint set (never the fingerprints/question text
  -- themselves) -- lets consumption-time revalidation detect "new
  -- Practice happened since this was prepared" without persisting
  -- anything beyond what's already inside the prepared activity itself.
  prior_practice_fingerprint_basis JSONB,

  generation_operation_id TEXT,
  failure_reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ready_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,

  -- The ONE link to a real learner attempt -- populated exactly once,
  -- atomically, never implying preparation itself was an attempt.
  consumed_by_quiz_id TEXT REFERENCES quiz_sessions(id)
);

-- Part 1/5/10 -- the actual dedup + single-consumption guarantee: at
-- most one ACTIVE (PREPARING or READY) row per canonical identity. A
-- second concurrent preparation attempt (e.g. two rapid Practice
-- submissions) collides here and is a no-op, never a second
-- speculative batch.
CREATE UNIQUE INDEX IF NOT EXISTS idx_canonical_prepared_activity_one_active
  ON canonical_prepared_activity (student_id, concept_id, stage, pedagogical_policy_version)
  WHERE status IN ('PREPARING', 'READY');

-- Fast lookup at consumption time.
CREATE INDEX IF NOT EXISTS idx_canonical_prepared_activity_lookup
  ON canonical_prepared_activity (student_id, concept_id, stage, status);

-- Bounded TTL sweeps / cost observability queries.
CREATE INDEX IF NOT EXISTS idx_canonical_prepared_activity_expiry
  ON canonical_prepared_activity (expires_at)
  WHERE status IN ('PREPARING', 'READY');
