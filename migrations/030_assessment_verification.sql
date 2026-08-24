-- Phase 3B: Assessment Verification Engine -- verification attempt
-- persistence. Fully additive, one new table.
--
-- NOT EXECUTED as part of this implementation pass -- design only,
-- pending explicit review/approval before running against Neon.
--
-- A verification attempt links the original (ambiguous) answer to the
-- follow-up question asked to disambiguate it, the deterministic
-- trigger(s) that requested it, and both the "before" and "after"
-- Assessment Confidence -- so the whole disambiguation is auditable
-- after the fact, without ever touching concept_knowledge_state or
-- mastery_records directly (this table records EVIDENCE about an
-- assessment attempt's trustworthiness, not mastery itself).
-- Numeric scales below are confirmed directly against the actual
-- application code that writes these columns (not assumed) --
-- src/services/assessment-verification.service.ts unless noted:
--   * assessment_confidence_before/after: calculateAssessmentConfidence()
--     in src/lib/assessment-confidence.ts always returns
--     `Math.round(Math.max(0, Math.min(100, confidence)))` -- a 0-100 scale.
--   * grading_confidence / verification_grading_confidence: both are
--     `grade.confidence` from gradeAnswer()/gradeStructuredAnswer() in
--     src/services/quiz-generation.service.ts, which clamp to
--     `Math.max(0, Math.min(1, ...))` (AI-graded) or fix it at exactly 1
--     (structured/deterministic grading) -- a 0-1 scale, NOT 0-100.
--     verification_grading_confidence is the same grade.confidence,
--     read from src/app/api/quizzes/verify/route.ts.
--   * variant_equivalence_confidence: evaluateVariantEquivalence()'s
--     `confidence = (checks passed) / (checks total)` in
--     quiz-generation.service.ts -- a 0-1 fraction, NOT 0-100.
CREATE TABLE IF NOT EXISTS verification_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- quiz_sessions.id is a TEXT id (e.g. "quiz-<timestamp>-<random>"),
  -- not a UUID -- matched here without a FK constraint since
  -- quiz_sessions rows are pruned/expired independently and this
  -- table should remain a readable audit trail even after that.
  quiz_session_id TEXT NOT NULL,
  student_id UUID NOT NULL REFERENCES students(id),
  concept_id UUID NOT NULL REFERENCES concepts(id),

  original_question_index INT CHECK (original_question_index IS NULL OR original_question_index >= 0),
  original_question JSONB NOT NULL,
  original_score_percent NUMERIC NOT NULL CHECK (original_score_percent >= 0 AND original_score_percent <= 100),
  verification_question JSONB NOT NULL,

  -- Array of VerificationTriggerId strings (src/lib/verification-triggers.ts)
  -- that caused this verification to be requested. Never a single reason
  -- collapsed to a string -- multiple triggers commonly co-occur.
  -- Enforced as a JSONB array, not merely "some JSON value".
  trigger_ids JSONB NOT NULL CHECK (jsonb_typeof(trigger_ids) = 'array'),

  original_response TEXT,
  verification_response TEXT,

  -- 0-1 scale (gradeAnswer/gradeStructuredAnswer's own grading confidence) -- see header note.
  grading_confidence NUMERIC CHECK (grading_confidence IS NULL OR (grading_confidence >= 0 AND grading_confidence <= 1)),
  verification_grading_confidence NUMERIC CHECK (verification_grading_confidence IS NULL OR (verification_grading_confidence >= 0 AND verification_grading_confidence <= 1)),

  -- 0-1 scale (evaluateVariantEquivalence's checks-passed fraction) -- see header note.
  variant_equivalence_confidence NUMERIC CHECK (variant_equivalence_confidence IS NULL OR (variant_equivalence_confidence >= 0 AND variant_equivalence_confidence <= 1)),

  -- 0-100 scale (calculateAssessmentConfidence's own output) -- see header note.
  assessment_confidence_before NUMERIC NOT NULL CHECK (assessment_confidence_before >= 0 AND assessment_confidence_before <= 100),
  assessment_confidence_after NUMERIC CHECK (assessment_confidence_after IS NULL OR (assessment_confidence_after >= 0 AND assessment_confidence_after <= 100)),

  -- NULL while pending a verification response; otherwise exactly one of
  -- VerificationOutcome's three values (assessment-verification.service.ts).
  outcome TEXT CHECK (outcome IS NULL OR outcome IN ('CONFIRMED', 'CONTRADICTED', 'INCONCLUSIVE')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_verification_attempts_student ON verification_attempts(student_id);
CREATE INDEX IF NOT EXISTS idx_verification_attempts_concept ON verification_attempts(concept_id);
CREATE INDEX IF NOT EXISTS idx_verification_attempts_quiz_session ON verification_attempts(quiz_session_id);
