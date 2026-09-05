-- StudyUs Phase 6 Step 6D: canonical Memory Policy persistence +
-- Memory State schema.
--
-- Fully additive: two new tables, no changes to any existing table.
-- Mirrors migrations/025_knowledge_state.sql's mastery_policies /
-- concept_knowledge_state conventions exactly (typed columns, a
-- versioned immutable policy-snapshot table seeded via
-- ON CONFLICT DO NOTHING, a UNIQUE(student_id, concept_id) state
-- table with CHECK-constrained enum columns).
--
-- NOT wired into any live code path as of this migration. No
-- production caller reads or writes either table yet -- see
-- src/lib/memory-policy.ts (Steps 6C/6C-R, the frozen policy
-- constants this seed row must exactly match -- proven by
-- tests/unit/memory-model.test.ts's policy-consistency check) and
-- src/lib/algorithms/memory-model.ts (Step 6D, the pure normalization/
-- replay/live-signal module these tables are shaped to receive from,
-- once a future step wires a projector into
-- mastery.service.ts::updateMastery's existing transaction).
--
-- ---------------------------------------------------------------------
-- memory_policies: one immutable, versioned snapshot per MemoryPolicy
-- version, exactly like mastery_policies. qualifying_activity_types /
-- excluded_activity_types / review_interval_days_by_success_count are
-- stored as JSONB arrays rather than typed columns -- they are
-- variable-length, ordered lists (an ActivityType allow-list and a
-- success-count-indexed day sequence), which a fixed set of scalar
-- columns cannot represent without an awkward one-column-per-entry
-- schema. Every other MemoryPolicy field is a single scalar and gets
-- its own typed column, matching mastery_policies' own convention.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS memory_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version INT NOT NULL UNIQUE,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  minimum_retention_gap_days INT NOT NULL,
  qualifying_activity_types JSONB NOT NULL,
  excluded_activity_types JSONB NOT NULL,

  demonstrated_retention_max_evidence INT NOT NULL,
  recency_weight_decay NUMERIC NOT NULL,
  difficulty_weighting_enabled BOOLEAN NOT NULL DEFAULT false,
  cognitive_weighting_enabled BOOLEAN NOT NULL DEFAULT false,

  stability_developing_at_successes INT NOT NULL,
  stability_stable_at_successes INT NOT NULL,

  review_interval_days_by_success_count JSONB NOT NULL,
  minimum_review_interval_days INT NOT NULL,
  maximum_review_interval_days INT NOT NULL,

  retrievability_decay_constant_k NUMERIC NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Must exactly match MEMORY_POLICY_V1 in src/lib/memory-policy.ts.
INSERT INTO memory_policies (
  version,
  minimum_retention_gap_days, qualifying_activity_types, excluded_activity_types,
  demonstrated_retention_max_evidence, recency_weight_decay, difficulty_weighting_enabled, cognitive_weighting_enabled,
  stability_developing_at_successes, stability_stable_at_successes,
  review_interval_days_by_success_count, minimum_review_interval_days, maximum_review_interval_days,
  retrievability_decay_constant_k
)
VALUES (
  1,
  3, '["RETENTION_CHECK","SOLO_CHECK","SOLO_VERIFY","TRANSFER","CUMULATIVE_ASSESSMENT","MOCK_EXAM"]'::jsonb, '["PRACTICE","REVIEW","DIAGNOSTIC_CHECK"]'::jsonb,
  5, 0.80, false, false,
  1, 3,
  '[3,4,7,14,28,56,84]'::jsonb, 3, 84,
  0.7
)
ON CONFLICT (version) DO NOTHING;

-- ---------------------------------------------------------------------
-- concept_memory_state: ONLY event-driven persisted Phase 6 state, one
-- canonical row per (student_id, concept_id) -- mirrors
-- concept_knowledge_state's own shape/index/FK conventions exactly.
-- Deliberately holds NO live-derived field (retrievability_now,
-- forgetting_risk, days_overdue, retention_due, prediction_confidence,
-- memory_age) -- those are always computed fresh at read time by
-- src/lib/algorithms/memory-model.ts::computeLiveMemorySignals, never
-- persisted (Step 6B/6C's evidenced-vs-predicted invariant).
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS concept_memory_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id),
  concept_id UUID NOT NULL REFERENCES concepts(id),

  policy_version INT NOT NULL,

  initial_competence_anchor_at TIMESTAMPTZ,
  last_qualified_attempt_at TIMESTAMPTZ,
  last_successful_retention_at TIMESTAMPTZ,
  last_unsuccessful_retention_at TIMESTAMPTZ,

  demonstrated_retention_score NUMERIC
    CHECK (demonstrated_retention_score IS NULL OR (demonstrated_retention_score >= 0 AND demonstrated_retention_score <= 100)),
  retention_evidence_count INT NOT NULL DEFAULT 0
    CHECK (retention_evidence_count >= 0),
  consecutive_qualifying_successes INT NOT NULL DEFAULT 0
    CHECK (consecutive_qualifying_successes >= 0),

  memory_stability TEXT NOT NULL DEFAULT 'UNSTABLE'
    CHECK (memory_stability IN ('UNSTABLE', 'DEVELOPING', 'STABLE')),
  memory_status TEXT NOT NULL DEFAULT 'NOT_ESTABLISHED'
    CHECK (memory_status IN ('NOT_ESTABLISHED', 'WAITING_FOR_RETENTION', 'DEVELOPING', 'STABLE', 'AT_RISK')),

  next_review_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (student_id, concept_id)
);

CREATE INDEX IF NOT EXISTS idx_concept_memory_state_student ON concept_memory_state(student_id);
CREATE INDEX IF NOT EXISTS idx_concept_memory_state_concept ON concept_memory_state(concept_id);
CREATE INDEX IF NOT EXISTS idx_concept_memory_state_next_review_at ON concept_memory_state(next_review_at);
