-- Phase 2.2A: Knowledge State Projection + Mastery Policy.
-- See docs/architecture/phase-2-2-knowledge-validation.md for the design.
-- Fully additive: two new tables, one new column on an existing table.

CREATE TABLE IF NOT EXISTS mastery_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version INT NOT NULL UNIQUE,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  minimum_understanding NUMERIC NOT NULL,
  minimum_independence NUMERIC NOT NULL,
  minimum_application NUMERIC NOT NULL,
  minimum_retention NUMERIC NOT NULL,
  minimum_transfer NUMERIC NOT NULL,
  requires_transfer BOOLEAN NOT NULL DEFAULT true,
  maximum_critical_misconceptions INT NOT NULL DEFAULT 0,

  minimum_evidence_count INT NOT NULL,
  minimum_independent_evidence_count INT NOT NULL,
  retention_min_gap_days INT NOT NULL,

  validation_window_days INT NOT NULL DEFAULT 14,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO mastery_policies (
  version, minimum_understanding, minimum_independence, minimum_application,
  minimum_retention, minimum_transfer, requires_transfer, maximum_critical_misconceptions,
  minimum_evidence_count, minimum_independent_evidence_count, retention_min_gap_days,
  validation_window_days
)
VALUES (1, 80, 80, 75, 75, 70, true, 0, 3, 2, 3, 14)
ON CONFLICT (version) DO NOTHING;

CREATE TABLE IF NOT EXISTS concept_knowledge_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id),
  concept_id UUID NOT NULL REFERENCES concepts(id),
  subject_id UUID NOT NULL REFERENCES subjects(id),

  mastery_state TEXT NOT NULL DEFAULT 'UNKNOWN'
    CHECK (mastery_state IN ('UNKNOWN','LEARNING','DEVELOPING','PROVISIONAL_MASTERY','VALIDATED_MASTERY','AT_RISK','INTERVENTION_REQUIRED')),

  understanding_score NUMERIC,
  independence_score NUMERIC,
  application_score NUMERIC,
  retention_score NUMERIC,
  transfer_score NUMERIC,

  active_misconception_count INT NOT NULL DEFAULT 0,
  critical_misconception_count INT NOT NULL DEFAULT 0,
  recurring_misconception_count INT NOT NULL DEFAULT 0,

  evidence_count INT NOT NULL DEFAULT 0,
  independent_evidence_count INT NOT NULL DEFAULT 0,

  first_evidence_at TIMESTAMPTZ,
  last_evidence_at TIMESTAMPTZ,
  last_practiced_at TIMESTAMPTZ,
  last_retrieved_at TIMESTAMPTZ,
  last_transfer_at TIMESTAMPTZ,
  last_validated_at TIMESTAMPTZ,

  next_review_at TIMESTAMPTZ,
  next_validation_at TIMESTAMPTZ,
  active_validation_cycle_id UUID,

  validation_readiness TEXT NOT NULL DEFAULT 'INSUFFICIENT_EVIDENCE'
    CHECK (validation_readiness IN ('READY','INSUFFICIENT_EVIDENCE','WAITING_FOR_RETENTION','TRANSFER_REQUIRED','ACTIVE_CRITICAL_MISCONCEPTION')),

  state_reason JSONB,

  projection_version INT NOT NULL DEFAULT 1,
  mastery_policy_version INT NOT NULL,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (student_id, concept_id)
);

CREATE INDEX IF NOT EXISTS idx_cks_student ON concept_knowledge_state(student_id);
CREATE INDEX IF NOT EXISTS idx_cks_concept ON concept_knowledge_state(concept_id);
CREATE INDEX IF NOT EXISTS idx_cks_mastery_state ON concept_knowledge_state(mastery_state);

ALTER TABLE misconception_signatures ADD COLUMN IF NOT EXISTS is_critical BOOLEAN NOT NULL DEFAULT false;
