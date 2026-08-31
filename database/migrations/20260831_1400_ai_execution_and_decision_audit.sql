-- StudyUs Phase 0E2: AI Execution & Decision Audit Trail.
--
-- Additive only. Creates two new tables; alters nothing existing.
-- See docs/architecture/audit-trail.md for the full design and
-- docs/audits/STUDYUS_PHASE_0E2_AUDIT_TRAIL.md for the audit report.
--
-- ---------------------------------------------------------------------
-- Identity note (Step 4/7 of the Phase 0E2 task): StudyUs's student
-- identity is split across two unlinked primary-key spaces kept in
-- sync by application convention only (see the "Current StudyUs
-- Student Identity Contract" block in src/lib/auth.ts, Phase 0C).
-- `learning_evidence`/`mastery_records` FK student_id -> profiles(id);
-- `concept_knowledge_state`/`validation_cycles`/`verification_attempts`/
-- `analytics_events` FK student_id -> students(id). This phase's audit
-- tables aggregate decisions from BOTH families (a MASTERY_UPDATED
-- decision's context comes from the profiles-linked side; a
-- VERIFICATION_REQUIRED decision's context comes from the
-- students-linked side). A single FK target would be technically
-- incorrect for whichever domain it wasn't chosen for while being a
-- silent no-op join for the other (the two spaces hold the same UUID
-- for a given real student, per the enforced sync guarantee -- 0
-- orphans confirmed in every Phase 0B/0C/0D check). Per Step 4's
-- explicit instruction ("accuracy is more important than pretending
-- the identity architecture is cleaner than it is"), student_id on
-- BOTH new tables is deliberately a plain, nullable, UNCONSTRAINED
-- uuid column -- not an FK to either table. concept_id/subject_id have
-- no such split and are real FKs.
-- ---------------------------------------------------------------------

-- ==========================================================================
-- ai_execution_events -- one row per executeAI() call (src/lib/ai/gateway.ts)
-- ==========================================================================
-- Provenance, not surveillance: never stores a raw prompt, raw AI
-- response, student answer text, student name/email, or any credential.
-- See src/lib/ai/audit.ts for the single write path (AIExecutionAuditSink).

CREATE TABLE IF NOT EXISTS ai_execution_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id      uuid NOT NULL UNIQUE,          -- matches AIExecutionMetadata.executionId (Phase 0E1)
  capability        text NOT NULL,                  -- AICapability, e.g. 'GRADING'
  risk              text NOT NULL,                  -- AIRiskLevel, e.g. 'HIGH_RISK'
  provider          text NOT NULL,                  -- 'anthropic' | 'openai'
  model             text NOT NULL,
  prompt_id         text NOT NULL,                  -- src/lib/ai/prompt-registry.ts id
  prompt_version    text NOT NULL,
  status            text NOT NULL,                  -- 'SUCCESS' | 'FAILURE'
  validation_status text NOT NULL,                  -- 'PASSED' | 'FAILED' | 'NOT_APPLICABLE'
  fallback_used     boolean NOT NULL DEFAULT false,
  error_code        text,                           -- AIErrorCode when status = 'FAILURE'
  duration_ms       integer NOT NULL,
  student_id        uuid,                           -- deliberately unconstrained -- see identity note above
  subject_id        uuid REFERENCES subjects(id) ON DELETE SET NULL,
  concept_id        uuid REFERENCES concepts(id) ON DELETE SET NULL,
  source_component  text,                           -- e.g. 'quiz-generation.service.ts:gradeAnswer'
  source_id         text,                           -- caller-defined, e.g. a quiz session id
  metadata          jsonb,                          -- safe, non-content metadata only (see privacy note)
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_execution_events_status_check CHECK (status IN ('SUCCESS', 'FAILURE')),
  CONSTRAINT ai_execution_events_validation_status_check CHECK (validation_status IN ('PASSED', 'FAILED', 'NOT_APPLICABLE')),
  CONSTRAINT ai_execution_events_duration_ms_check CHECK (duration_ms >= 0)
);

COMMENT ON TABLE ai_execution_events IS
  'Phase 0E2 cross-engine audit trail: one row per AI provider execution through src/lib/ai/gateway.ts. Provenance only -- no raw prompt/response/credential content. Never a domain source-of-truth table.';
COMMENT ON COLUMN ai_execution_events.student_id IS
  'Deliberately NOT a foreign key -- StudyUs student identity is split across students(id)/profiles(id) (see Phase 0C). Logically valid in either space; kept in sync by application convention, not a DB constraint.';

CREATE INDEX IF NOT EXISTS ai_execution_events_student_id_idx ON ai_execution_events (student_id) WHERE student_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_execution_events_concept_id_idx ON ai_execution_events (concept_id) WHERE concept_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_execution_events_capability_idx ON ai_execution_events (capability);
CREATE INDEX IF NOT EXISTS ai_execution_events_created_at_idx ON ai_execution_events (created_at);

-- ==========================================================================
-- decision_events -- one row per important existing deterministic decision
-- ==========================================================================
-- Cross-engine auditability layered ON TOP of domain history tables
-- (mastery_events, concept_knowledge_state, verification_attempts,
-- learning_debt_events, student_misconceptions) -- it never replaces
-- them. Those remain the authoritative domain records; decision_events
-- answers "why", with a uniform shape across every engine.

CREATE TABLE IF NOT EXISTS decision_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id       uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  decision_type     text NOT NULL,                  -- e.g. 'MASTERY_UPDATED', see docs/architecture/audit-trail.md for the full taxonomy
  engine            text NOT NULL,                  -- e.g. 'mastery-engine'
  engine_version    text NOT NULL,                  -- e.g. 'v1' -- a plain code constant, not fabricated semantic versioning
  student_id        uuid,                           -- deliberately unconstrained -- see identity note above
  subject_id        uuid REFERENCES subjects(id) ON DELETE SET NULL,
  concept_id        uuid REFERENCES concepts(id) ON DELETE SET NULL,
  source_event_type text,                           -- which domain table this decision was derived from, e.g. 'learning_evidence'
  source_event_id   uuid,                           -- polymorphic (meaning depends on source_event_type) -- deliberately no single FK target
  previous_state    jsonb,
  new_state         jsonb,
  reason_code       text,                           -- machine-readable, drawn only from reasons the existing algorithm actually exposes
  reason_details    jsonb,
  ai_execution_id   uuid REFERENCES ai_execution_events (execution_id) ON DELETE SET NULL,
  metadata          jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE decision_events IS
  'Phase 0E2 cross-engine audit trail: one row per important existing deterministic decision (mastery update, knowledge-state projection, verification required/resolved, learning debt created/resolved, misconception recorded). Never a domain source-of-truth table -- mastery_events/concept_knowledge_state/verification_attempts/learning_debt_events/student_misconceptions remain authoritative.';
COMMENT ON COLUMN decision_events.ai_execution_id IS
  'Set only when this decision''s evidence came from an unambiguous single AI execution (see docs/architecture/audit-trail.md Step 15) -- never fabricated when evidence was deterministic or spanned multiple/no AI calls.';

CREATE INDEX IF NOT EXISTS decision_events_decision_type_idx ON decision_events (decision_type);
CREATE INDEX IF NOT EXISTS decision_events_student_id_idx ON decision_events (student_id) WHERE student_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS decision_events_concept_id_idx ON decision_events (concept_id) WHERE concept_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS decision_events_ai_execution_id_idx ON decision_events (ai_execution_id) WHERE ai_execution_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS decision_events_source_event_idx ON decision_events (source_event_type, source_event_id) WHERE source_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS decision_events_created_at_idx ON decision_events (created_at);
