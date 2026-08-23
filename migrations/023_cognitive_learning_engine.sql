-- Phase 2: Cognitive Learning Engine.
-- All additive, no destructive changes to any Phase 1 table.
-- learning_evidence.metadata (already jsonb, migration 021) and new
-- source_type values (no CHECK constraint on that column) carry the
-- new evidence kinds -- no schema change needed there.

-- Cognitive Knowledge Graph: a second structure alongside the existing
-- Subject->Topic->Subtopic->Concept organizational hierarchy, answering
-- "what must be understood before this?" rather than "where does this
-- live?". Concepts already belong to exactly one subject, and a
-- subject already carries academic context (ib_programme/ib_level) --
-- academic_context here is an optional finer-grained override, not the
-- primary scoping mechanism.
CREATE TABLE IF NOT EXISTS concept_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  target_concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL CHECK (relationship_type IN (
    'PREREQUISITE_OF', 'DEPENDS_ON', 'RELATED_TO', 'EXTENSION_OF', 'APPLIES_TO', 'COMMONLY_CONFUSED_WITH'
  )),
  confidence NUMERIC NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  source TEXT NOT NULL DEFAULT 'AI_INFERRED' CHECK (source IN (
    'MANUAL', 'AI_INFERRED', 'CURRICULUM', 'CONTENT_INFERRED', 'SYSTEM'
  )),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'rejected', 'superseded')),
  academic_context JSONB,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (source_concept_id != target_concept_id),
  UNIQUE (source_concept_id, target_concept_id, relationship_type)
);
CREATE INDEX IF NOT EXISTS idx_concept_relationships_target ON concept_relationships(target_concept_id, relationship_type) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_concept_relationships_source ON concept_relationships(source_concept_id, relationship_type) WHERE status = 'active';

-- One row per (student, target concept, candidate root-cause concept)
-- investigation. A real diagnostic process, not a cache -- persisted
-- because it represents an active line of inquiry the student may
-- resume across sessions.
CREATE TABLE IF NOT EXISTS cognitive_diagnoses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  target_concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  candidate_concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'SUSPECTED' CHECK (state IN (
    'SUSPECTED', 'LIKELY', 'DIAGNOSIS_REQUIRED', 'CONFIRMED', 'REJECTED'
  )),
  score NUMERIC NOT NULL,
  evidence JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_cognitive_diagnoses_lookup ON cognitive_diagnoses(student_id, target_concept_id, state);

CREATE TABLE IF NOT EXISTS remediation_paths (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  diagnosis_id UUID REFERENCES cognitive_diagnoses(id) ON DELETE SET NULL,
  target_concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  root_cause_concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  pattern TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'DETECTED' CHECK (state IN (
    'DETECTED', 'DIAGNOSING', 'CONFIRMED', 'REPAIRING', 'VERIFYING', 'RESOLVED', 'REJECTED'
  )),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_remediation_paths_student_state ON remediation_paths(student_id, state);

CREATE TABLE IF NOT EXISTS remediation_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  remediation_path_id UUID NOT NULL REFERENCES remediation_paths(id) ON DELETE CASCADE,
  step_type TEXT NOT NULL CHECK (step_type IN (
    'LEARN', 'GUIDED_PRACTICE', 'RETRIEVAL', 'EXPLAIN', 'TRANSFER', 'SOLO_VERIFY'
  )),
  concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  sequence INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'completed', 'skipped')),
  result JSONB,
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_remediation_steps_path ON remediation_steps(remediation_path_id, sequence);

-- Normalized misconceptions (not free text) so recurrence across
-- questions/sessions can actually be detected and grouped.
CREATE TABLE IF NOT EXISTS misconception_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  misconception_code TEXT NOT NULL,
  description TEXT NOT NULL,
  canonical_explanation TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (concept_id, misconception_code)
);

CREATE TABLE IF NOT EXISTS student_misconceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  misconception_signature_id UUID NOT NULL REFERENCES misconception_signatures(id) ON DELETE CASCADE,
  occurrence_count INT NOT NULL DEFAULT 1,
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  evidence JSONB,
  UNIQUE (student_id, misconception_signature_id)
);
CREATE INDEX IF NOT EXISTS idx_student_misconceptions_student ON student_misconceptions(student_id, last_seen DESC);
