-- StudyUs Phase 2B: Evidence Idempotency & Mastery Integrity.
--
-- Additive only. Adds one nullable column and one partial unique index
-- to learning_evidence, and the same shape to assessment_results;
-- alters nothing existing. See docs/architecture/digital-learning-twin.md's
-- "Evidence Idempotency" section and
-- docs/audits/STUDYUS_PHASE_2B_EVIDENCE_IDEMPOTENCY.md for the full
-- design.
--
-- ---------------------------------------------------------------------
-- learning_evidence.operation_key (Phase 2A §45): learning_evidence had
-- only a primary key on `id` (server-generated) -- no way to tell
-- whether two rows came from the same logical learner action (a
-- network retry, a double-click, a concurrent duplicate request) or
-- from two genuinely separate attempts. `operation_key` is StudyUs's
-- answer: an opaque, deterministic string built from a stable domain
-- identity (e.g. a quiz session id, a verification attempt id, an
-- activity id minted at generation time) plus the concept it applies
-- to -- see src/lib/algorithms/evidence-idempotency.ts for the exact
-- encoding.
--
-- assessment_results.submission_token: a real school exam result can
-- legitimately be corrected/re-entered later -- the same
-- assessment_occurrences.id is NOT itself a safe dedup key (Phase 2B
-- Step 8's correction: "do not decide that all submissions for the
-- same occurrence are duplicates"). submission_token is instead an
-- opaque id the CLIENT mints once per deliberate "Record Result" form
-- submission and reuses across any retry of that one action; a
-- genuinely new correction gets a new token. See
-- src/services/exam-result.service.ts and
-- src/app/dashboard/subjects/[id]/AssessmentPanel.tsx.
--
-- NULL is deliberate and permanent for populations that predate or
-- fall outside this guarantee, not just a migration-day artifact:
-- (1) every row written before these columns existed (historical
-- evidence/results are never backfilled with a fabricated key -- Step
-- 6/Phase 2B), and (2) writers that do not supply a stable identity
-- (see the Phase 2B report's Evidence Writer Audit -- the generic
-- record-evidence route requires one from every caller instead, so
-- this case is narrower than it looks). Postgres treats every NULL as
-- distinct under a unique index, so any number of NULL-keyed rows can
-- coexist -- exactly "no idempotency guarantee" for those rows,
-- unchanged from before this migration.
--
-- Both partial indexes (WHERE ... IS NOT NULL) are the actual
-- database-level uniqueness guarantee Phase 2A's finding required: two
-- concurrent INSERTs carrying the same non-null key can never both
-- succeed -- the second blocks on the first, then fails with a 23505
-- unique_violation once the first commits (or proceeds normally if the
-- first rolled back). src/services/mastery.service.ts is the only
-- INSERT INTO learning_evidence call site in the codebase (confirmed
-- by a fresh grep this phase) and, together with
-- src/services/exam-result.service.ts for assessment_results, is the
-- only place that interprets this violation as ALREADY_APPLIED rather
-- than an error.
-- ---------------------------------------------------------------------

ALTER TABLE learning_evidence
  ADD COLUMN IF NOT EXISTS operation_key text;

CREATE UNIQUE INDEX IF NOT EXISTS learning_evidence_operation_key_unique_idx
  ON learning_evidence (operation_key)
  WHERE operation_key IS NOT NULL;

ALTER TABLE assessment_results
  ADD COLUMN IF NOT EXISTS submission_token text;

CREATE UNIQUE INDEX IF NOT EXISTS assessment_results_submission_token_unique_idx
  ON assessment_results (submission_token)
  WHERE submission_token IS NOT NULL;
