-- StudyUs Phase 8 Step 8A1: persistent rolling learning-plan foundation.
--
-- Fully additive: TWO new tables, no changes to any existing table, no
-- data rewrite, no seed rows, no DROP / RENAME / ALTER of anything.
-- The legacy study_plans / study_sessions / study_session_items tables
-- and /api/study-plan/generate are UNTOUCHED -- their deprecation is
-- later Phase 8 work.
--
-- NOT wired into any live code path as of this migration:
--   * the plan projector (sole writer)        -> 8B1
--   * the read-only plan boundary             -> 8B1
--   * orchestration candidate gathering       -> 8C1
--   * the 14-day deterministic planner        -> 8D1
--   * event-driven replanning triggers        -> 8E1
--   * Today / plan UX                         -> 8F1
-- After this migration the expected row count for BOTH tables is ZERO
-- and stays zero until 8B1+ writers exist. If a row appears before
-- then, a writer leaked in early -- investigate.
--
-- Shapes mirror src/lib/learning-plan-state.ts and the canonical
-- vocabulary in src/lib/learning-orchestration-policy.ts. The 14-day
-- rolling-horizon bound is enforced BOTH here (a safe `date + integer`
-- CHECK) and in the pure policy/tests.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS learning_plan (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id),

  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'SUPERSEDED')),

  -- src/lib/learning-orchestration-policy.ts ORCHESTRATION_POLICY_VERSION
  orchestration_policy_version INT NOT NULL
    CHECK (orchestration_policy_version > 0),

  horizon_start DATE NOT NULL,
  horizon_end DATE NOT NULL,
  planning_anchor_at TIMESTAMPTZ NOT NULL,

  -- IANA timezone string; `timezone_assumed` is true until a real one
  -- has been captured for the learner (0/6 production students have one
  -- as of 8A1 -- see the 8A0 audit).
  timezone TEXT NOT NULL,
  timezone_assumed BOOLEAN NOT NULL DEFAULT true,

  -- Objective / context references only (assessment ids, goal refs) --
  -- never learner-state truth, never a LearningDecision blob.
  goal_context JSONB NOT NULL DEFAULT '{}',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CHECK (horizon_end >= horizon_start),
  -- ORCHESTRATION_HORIZON_DAYS (14) inclusive: end is at most start + 13.
  CHECK (horizon_end <= horizon_start + 13)
);

-- Exactly ONE ACTIVE plan per student (canonical). SUPERSEDED plans
-- accumulate as history and are unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS idx_learning_plan_one_active
  ON learning_plan (student_id)
  WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_learning_plan_student
  ON learning_plan (student_id);


CREATE TABLE IF NOT EXISTS learning_plan_item (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES learning_plan(id),
  student_id UUID NOT NULL REFERENCES students(id),
  subject_id UUID NOT NULL REFERENCES subjects(id),
  concept_id UUID REFERENCES concepts(id),  -- NULL for a subject-level item (e.g. MOCK_EXAM)

  scheduled_date DATE NOT NULL,
  time_window TEXT,  -- optional soft label, never a hard clock

  -- Revalidated against Phase 4 before launch -- a hint, not authority.
  intended_activity_type TEXT NOT NULL
    CHECK (intended_activity_type IN (
      'PRACTICE', 'REVIEW', 'SOLO_CHECK', 'DIAGNOSTIC_CHECK', 'REMEDIATION',
      'SOLO_VERIFY', 'TRANSFER', 'RETENTION_CHECK', 'CUMULATIVE_ASSESSMENT', 'MOCK_EXAM'
    )),

  -- Machine provenance -- never rendered raw, never learner prose.
  reason_code TEXT NOT NULL
    CHECK (reason_code IN (
      'ASSESSMENT_APPROACHING', 'RETENTION_DUE', 'REMEDIATION_REQUIRED', 'VERIFICATION_READY',
      'PREREQUISITE_FIRST', 'TRANSFER_PROGRESSION', 'MISCONCEPTION_BLOCK', 'LEARNING_DEBT',
      'CURRICULUM_PROGRESSION', 'LEARNER_REQUESTED'
    )),
  source TEXT NOT NULL
    CHECK (source IN (
      'PHASE4_DECISION', 'RETENTION_WINDOW', 'TRANSFER_READINESS', 'ASSESSMENT_PREP',
      'CURRICULUM_PROGRESSION', 'REMEDIATION', 'PREREQUISITE', 'MANUAL_RESCHEDULE'
    )),

  -- Phase 4's own priorityScore at plan time -- carried for sequencing
  -- / history, NEVER re-derived by Phase 8.
  priority_at_plan_time INT NOT NULL,
  estimated_minutes INT NOT NULL CHECK (estimated_minutes > 0),

  status TEXT NOT NULL DEFAULT 'PLANNED'
    CHECK (status IN ('PLANNED', 'READY', 'COMPLETED', 'SKIPPED', 'EXPIRED', 'SUPERSEDED')),

  orchestration_policy_version INT NOT NULL
    CHECK (orchestration_policy_version > 0),

  -- Deterministic identity (buildLearningPlanItemOperationKey). Global
  -- uniqueness is safe because the key embeds the student id.
  operation_key TEXT NOT NULL,

  -- Bounded primitive facts + a canonical source pointer. Never student
  -- answers, AI output, prompts, PII, or a full decision blob.
  provenance JSONB NOT NULL DEFAULT '{}',

  -- Set when a replan replaced this item (a "move" = SUPERSEDE old +
  -- ADD new). Nullable self-FK, NO cascade.
  superseded_by_item_id UUID REFERENCES learning_plan_item(id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_learning_plan_item_operation_key
  ON learning_plan_item (operation_key);

CREATE INDEX IF NOT EXISTS idx_learning_plan_item_plan_date
  ON learning_plan_item (plan_id, scheduled_date);

-- Live-item reads for one student over the horizon.
CREATE INDEX IF NOT EXISTS idx_learning_plan_item_student_date_live
  ON learning_plan_item (student_id, scheduled_date)
  WHERE status IN ('PLANNED', 'READY');

CREATE INDEX IF NOT EXISTS idx_learning_plan_item_student_concept
  ON learning_plan_item (student_id, concept_id);
