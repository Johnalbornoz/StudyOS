-- Phase 3 Pre-flight: historical Knowledge State backfill audit trail,
-- and exam-concept-attribution granularity. Fully additive.
-- See docs/architecture/phase-3-adaptive-learning-orchestration.md.
--
-- RECOVERY NOTE: this migration was already applied directly to the
-- live Neon database before the accidental local deletion (verified
-- manually: public.backfill_runs, assessment_concept_coverage.source_granularity
-- both already exist). This file is reconstructed as a repository
-- artifact only -- it uses CREATE TABLE IF NOT EXISTS / ADD COLUMN IF
-- NOT EXISTS throughout, so re-running it against the live database
-- remains a safe no-op. It was NOT re-executed as part of this recovery.

-- One row per backfill invocation (a run may span several batched
-- calls when resuming from a cursor). Metrics are aggregate counts
-- only -- never raw evidence/answer content -- so this table is safe
-- to inspect without touching student privacy.
CREATE TABLE IF NOT EXISTS backfill_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL DEFAULT 'KNOWLEDGE_STATE',
  status TEXT NOT NULL DEFAULT 'RUNNING', -- RUNNING | COMPLETED | FAILED
  dry_run BOOLEAN NOT NULL DEFAULT false,
  student_filter UUID, -- NULL = all students
  cursor_student_id UUID,
  cursor_concept_id UUID,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_backfill_runs_status ON backfill_runs(status);

-- assessment_concept_coverage rows are already the highest-precision
-- attribution source available (explicit concept-level mapping); this
-- column records HOW that mapping was derived, so a future
-- question-level or section-level derivation can self-declare a
-- tighter granularity without a schema change. Only 'MANUAL' is
-- actually produced today (mapAssessmentConceptCoverage's explicit
-- caller-supplied mappings) -- 'QUESTION_LEVEL'/'SECTION_LEVEL' are
-- reserved for when real school exams carry decomposed structure.
ALTER TABLE assessment_concept_coverage ADD COLUMN IF NOT EXISTS source_granularity TEXT NOT NULL DEFAULT 'MANUAL';
