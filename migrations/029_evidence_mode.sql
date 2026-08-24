-- Phase 3A: Evidence Mode Engine. Fully additive -- historical
-- quiz_sessions rows keep NULL here and get their Evidence Mode
-- derived on read from their (unchanged) quiz_mode, via the exact
-- same mapping new rows are stamped with at creation. See
-- src/lib/activity-taxonomy.ts and src/services/quiz-persistence.service.ts.
--
-- RECOVERY NOTE: this migration was already applied directly to the
-- live Neon database before the accidental local deletion (verified
-- manually: quiz_sessions.activity_type and quiz_sessions.evidence_mode
-- both already exist). This file is reconstructed as a repository
-- artifact only -- it uses ADD COLUMN IF NOT EXISTS, so re-running it
-- against the live database remains a safe no-op. It was NOT
-- re-executed as part of this recovery.
ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS activity_type TEXT;
ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS evidence_mode TEXT;
