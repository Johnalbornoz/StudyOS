-- Phase 2.2C: External Validation.
-- See docs/architecture/phase-2-2-knowledge-validation.md for the design.
-- Fully additive: two new tables. Reuses the existing assessment_results /
-- assessment_occurrences tables as the external evidence source rather
-- than inventing a new external_assessments table.

-- assessment_occurrences.topics is a flat text[] with no per-concept
-- weight or confidence -- not precise enough to compare against a
-- concept's own Knowledge State. This table adds that missing precision,
-- explicitly (never auto-inferred/fabricated from the topics array).
CREATE TABLE IF NOT EXISTS assessment_concept_coverage (
  assessment_occurrence_id UUID NOT NULL REFERENCES assessment_occurrences(id),
  concept_id UUID NOT NULL REFERENCES concepts(id),
  weight NUMERIC NOT NULL DEFAULT 1.0,
  mapping_confidence NUMERIC NOT NULL DEFAULT 0.5,
  PRIMARY KEY (assessment_occurrence_id, concept_id)
);
CREATE INDEX IF NOT EXISTS idx_acc_concept ON assessment_concept_coverage(concept_id);

-- Never a write path into concept_knowledge_state or mastery_records --
-- a calibration conflict is recorded and exposed, never auto-resolved
-- into a "corrected" internal score. Phase 3 decides what to do about it.
CREATE TABLE IF NOT EXISTS calibration_conflicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id),
  concept_id UUID NOT NULL REFERENCES concepts(id),
  assessment_result_id UUID NOT NULL REFERENCES assessment_results(id),

  internal_score NUMERIC NOT NULL,
  external_score NUMERIC NOT NULL,
  mapping_confidence NUMERIC NOT NULL,
  coverage_weight NUMERIC NOT NULL,
  conflict_magnitude NUMERIC NOT NULL,

  possible_interpretations JSONB NOT NULL,

  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_calibration_conflicts_student ON calibration_conflicts(student_id);
CREATE INDEX IF NOT EXISTS idx_calibration_conflicts_concept ON calibration_conflicts(concept_id);
