-- StudyUs Phase 2C: Misconception Lifecycle.
--
-- Additive only. Adds lifecycle columns to student_misconceptions;
-- alters nothing existing. See docs/architecture/phase-2-2-knowledge-
-- validation.md's "Misconception Lifecycle (Phase 2C)" section and
-- docs/audits/STUDYUS_PHASE_2C_MISCONCEPTION_LIFECYCLE.md for the
-- full design.
--
-- ---------------------------------------------------------------------
-- Why this exists (Phase 1F / Phase 2A): student_misconceptions had no
-- way to distinguish a misconception the learner CURRENTLY holds from
-- one observed once, historically, and since corrected. Every
-- misconception, once recorded, stayed "active" forever by
-- construction -- a real false-negative Mastery risk, since a critical
-- misconception's presence gates VALIDATED_MASTERY
-- (knowledge-state.service.ts::determineMasteryState's criticalOk).
--
-- `status` ('ACTIVE' | 'RESOLVED') is StudyUs's answer: one current-
-- state row per (student, signature) -- the existing
-- UNIQUE(student_id, misconception_signature_id) constraint already
-- gives this table exactly that shape, so no new "episode" table is
-- introduced. `resolved_at`/`resolved_by_evidence_id` record the most
-- recent resolution; `reactivation_count` records how many times a
-- resolved misconception has reappeared. `occurrence_count` (existing,
-- unchanged in meaning) stays a lifetime, never-decremented total --
-- current truth belongs to `status`, historical frequency belongs to
-- `occurrence_count`. Full transition history (each observation,
-- resolution, and reactivation as its own event) lives in the existing
-- decision_events audit trail (MISCONCEPTION_RECORDED/_RESOLVED/
-- _REACTIVATED), not duplicated here.
--
-- Historical rows: DEFAULT 'ACTIVE' is the only epistemically honest
-- migration for rows that predate lifecycle tracking -- there is no
-- evidence they were ever resolved, so marking them RESOLVED would
-- fabricate a resolution that never happened. They remain ACTIVE until
-- genuine resolution evidence is observed post-migration (Phase 2C
-- Step 30: PRE_LIFECYCLE_MISCONCEPTION_STATUS = ASSUMED_ACTIVE_UNTIL_REVALIDATED).
-- No row is deleted, no timestamp is fabricated. (As of this writing,
-- production has zero rows in this table, so this default's practical
-- effect today is on future rows only -- documented for when it isn't.)
--
-- Adding a NOT NULL column with a constant DEFAULT is a fast,
-- metadata-only operation on PostgreSQL 11+ (no table rewrite).
-- ---------------------------------------------------------------------

ALTER TABLE student_misconceptions
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by_evidence_id uuid REFERENCES learning_evidence(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reactivation_count integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'student_misconceptions_status_check'
  ) THEN
    ALTER TABLE student_misconceptions
      ADD CONSTRAINT student_misconceptions_status_check CHECK (status IN ('ACTIVE', 'RESOLVED'));
  END IF;
END $$;

-- Hot query shape post-Phase-2C: "this student's currently ACTIVE
-- misconceptions" (getRecurringMisconceptions, the Twin, NBA/today-plan
-- attention surfaces) -- student_id + status. concept-scoped reads
-- (getMisconceptionCountsForConcept) still join through
-- misconception_signatures and are covered well enough by that table's
-- own existing (concept_id, misconception_code) unique index plus this
-- table's existing (student_id, misconception_signature_id) unique
-- index -- no additional index justified for that path.
CREATE INDEX IF NOT EXISTS idx_student_misconceptions_student_status
  ON student_misconceptions (student_id, status);
