-- StudyUs Phase 2D: Intervention Lifecycle -- concurrency safety.
--
-- Additive only. Adds one partial unique index to remediation_paths;
-- alters nothing existing. See
-- docs/audits/STUDYUS_PHASE_2_FINAL_COGNITIVE_MASTERY_CERTIFICATION.md
-- §3.7 for the full exactly-once audit.
--
-- ---------------------------------------------------------------------
-- src/services/remediation.service.ts::startRemediation already checks
-- "is there already an open remediation path for this diagnosis?"
-- before inserting a new one (getActiveRemediationForDiagnosis), making
-- a single caller's repeated calls deterministic. But a plain
-- SELECT-then-INSERT is not itself race-proof under two genuinely
-- concurrent calls (a double-click, two tabs, a network retry racing
-- the original request) -- exactly the class of bug Phase 2B's own
-- exactly-once work exists to close for evidence writes, applied here
-- to the Intervention Lifecycle's own INSERT.
--
-- This index makes "at most one non-terminal remediation path per
-- diagnosis" a real, database-enforced invariant, not just an
-- application-level convention: a second concurrent INSERT for the
-- same diagnosis_id while one of CONFIRMED/REPAIRING/VERIFYING already
-- exists is rejected with a 23505 unique_violation, which
-- startRemediation now catches and treats as ALREADY_APPLIED (returns
-- the winning caller's path), the same pattern
-- learning_evidence.operation_key already established.
--
-- A partial index (not a full unique constraint) is used because a
-- diagnosis legitimately accumulates multiple TERMINAL
-- (RESOLVED/REJECTED) remediation_paths over time (Phase 2D's own
-- audit: a REJECTED attempt does not prevent a later, genuinely new
-- attempt) -- only the concurrently-open set needs to be constrained
-- to at most one.
-- ---------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS remediation_paths_open_per_diagnosis_idx
  ON remediation_paths (diagnosis_id)
  WHERE state IN ('CONFIRMED', 'REPAIRING', 'VERIFYING');
