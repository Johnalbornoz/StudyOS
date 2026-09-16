-- CANON-R5R1: trusted v1 launch marker, persisted on quiz_sessions.
--
-- Fully additive: three new NULLABLE columns on the existing
-- quiz_sessions table, no changes to any other table, no data rewrite,
-- no backfill (every pre-existing row simply has all three columns
-- NULL, exactly like a legacy session created after this migration).
--
-- Written at generation time (storeQuiz), read back at submission time
-- (getQuizSession) -- the server-persisted source of truth for "was
-- this quiz session genuinely launched under Pedagogical Engine v1,"
-- never re-derived from a client-supplied claim at submission time
-- (see src/lib/pedagogical-decision/v1-practice-launch-marker.ts).
--
-- This migration is NOT applied by this phase -- no live DB access in
-- this environment (see docs/CANON_R5R1_V1_EVIDENCE_AND_RESULTS.md's
-- STATUS section). It is written and reviewed so a future
-- Preview-connected session can run `npm run db:migrate` and have it
-- applied automatically, to PREVIEW ONLY -- Production cutover remains
-- unconfigured.
-- ---------------------------------------------------------------------

ALTER TABLE quiz_sessions
  ADD COLUMN IF NOT EXISTS pedagogical_policy_version TEXT,
  ADD COLUMN IF NOT EXISTS canonical_revision TEXT,
  ADD COLUMN IF NOT EXISTS canonical_stage TEXT;
