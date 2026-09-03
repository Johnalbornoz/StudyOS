-- StudyUs Phase 2F: Error Taxonomy Reconciliation.
--
-- Adapts, then closes, a real (not merely cosmetic) taxonomy leak;
-- alters nothing else. See
-- docs/audits/STUDYUS_PHASE_2_FINAL_COGNITIVE_MASTERY_CERTIFICATION.md
-- §5 for the full audit.
--
-- ---------------------------------------------------------------------
-- `errors.error_type` had no CHECK constraint, so any string up to 30
-- characters could be written there. In practice, two writers fed it:
-- error-intelligence.service.ts::recordError (called from quiz
-- grading, whose result can be one of GradingErrorType's 7 values --
-- the canonical 5 plus ARITHMETIC/UNIT) and
-- mastery.service.ts::updateMastery's errorClassification path (a
-- caller-supplied free-form string, unvalidated by any enum). Neither
-- boundary enforced the 5-value canonical ErrorType
-- (error-intelligence.service.ts) that every reader --
-- cognitive-diagnosis.service.ts's root-cause recurrence count,
-- error-intelligence.service.ts's own pattern-meaning lookup -- was
-- written against. A live production check this phase found 2 real
-- ARITHMETIC rows already persisted: a genuinely live, not merely
-- theoretical, taxonomy leak that silently excluded those errors from
-- root-cause investigation.
--
-- The mapping is proven, not invented: ARITHMETIC -> CARELESS is
-- CARELESS's own pre-existing definition in error-intelligence.service.ts
-- ("small execution slips (arithmetic, sign errors, typos)"); UNIT ->
-- PROCEDURAL, since a unit-conversion slip is a procedural-step
-- omission. No UNIT rows exist in production as of this writing (the
-- backfill below is future-proofing, not correcting live data for that
-- value) -- see the accompanying application fix
-- (error-intelligence.service.ts::toCanonicalErrorType, applied at
-- both write sites) for where new writes are prevented from ever
-- reaching a non-canonical value again.
--
-- This is a versioned adaptation of 2 known rows via a proven mapping,
-- not a casual destructive rewrite (Phase 2F.4) -- provenance
-- (student_id/concept_id/subject_id/source_type/created_at) is
-- untouched; only the error_type label itself is corrected to the
-- taxonomy every reader already assumed.
-- ---------------------------------------------------------------------

UPDATE errors SET error_type = 'CARELESS' WHERE error_type = 'ARITHMETIC';
UPDATE errors SET error_type = 'PROCEDURAL' WHERE error_type = 'UNIT';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'errors_error_type_check'
  ) THEN
    ALTER TABLE errors
      ADD CONSTRAINT errors_error_type_check CHECK (error_type IN ('CONCEPTUAL', 'PROCEDURAL', 'CARELESS', 'INCOMPLETE', 'MISREADING'));
  END IF;
END $$;
