-- Phase 2.2B: Knowledge Validation Over Time.
-- See docs/architecture/phase-2-2-knowledge-validation.md for the design.
-- Fully additive: two new tables.

CREATE TABLE IF NOT EXISTS validation_cycles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id),
  concept_id UUID NOT NULL REFERENCES concepts(id),
  subject_id UUID NOT NULL REFERENCES subjects(id),

  trigger_type TEXT NOT NULL CHECK (trigger_type IN (
    'LOW_BASELINE', 'CONFIRMED_MISCONCEPTION', 'DIAGNOSTIC_FAILURE', 'REPEATED_CONCEPTUAL_ERROR',
    'APPLICATION_FAILURE', 'TRANSFER_FAILURE', 'RETENTION_FAILURE', 'KNOWLEDGE_DECAY', 'EXTERNAL_ASSESSMENT_CONFLICT'
  )),
  trigger_evidence_id UUID,

  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  validation_deadline TIMESTAMPTZ NOT NULL,

  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),

  mastery_policy_version INT NOT NULL,
  initial_knowledge_state JSONB,

  validated_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  final_outcome TEXT CHECK (final_outcome IN ('VALIDATED_MASTERY', 'DEVELOPING', 'INTERVENTION_REQUIRED')),
  outcome_reason TEXT,

  reopened_from_cycle_id UUID REFERENCES validation_cycles(id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enforces "one active cycle per student/concept" at the database level,
-- not just in application code -- a duplicate open() call is a no-op by
-- construction, not just by convention.
CREATE UNIQUE INDEX IF NOT EXISTS idx_validation_cycles_one_open
  ON validation_cycles(student_id, concept_id) WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS idx_validation_cycles_student ON validation_cycles(student_id);
CREATE INDEX IF NOT EXISTS idx_validation_cycles_concept ON validation_cycles(concept_id);
CREATE INDEX IF NOT EXISTS idx_validation_cycles_status ON validation_cycles(status);

CREATE TABLE IF NOT EXISTS validation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  validation_cycle_id UUID NOT NULL REFERENCES validation_cycles(id),
  event_type TEXT NOT NULL,
  metadata JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_validation_events_cycle ON validation_events(validation_cycle_id);
