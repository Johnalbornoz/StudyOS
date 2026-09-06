-- StudyUs Phase 7 Step 7D1: server-side trusted Transfer task registry.
--
-- Fully additive: ONE new table, no changes to any existing table, no
-- data rewrite, no seed rows.
--
-- 7D exposed a concrete integrity requirement that 7A0/7C1 had
-- deliberately deferred: AI-proposed task metadata (distance, novelty
-- dimensions, target concepts, context domain, task family) must
-- survive the generation -> submission client round trip WITHOUT the
-- browser ever becoming authoritative for it. StudyUs has no signed-
-- envelope / HMAC primitive, so the safe bridge is a persisted
-- registry: /transfer/generate writes one row here keyed by
-- transferTaskId; /transfer/submit loads it by id and trusts ONLY the
-- persisted values (plus a prompt_exact_hash check that the submitted
-- prompt is byte-identical to the generated one).
--
-- Holds NO raw prompt, NO student answer, NO AI feedback, NO learner
-- state. novelty_validation_passed is written by 7D2's deterministic
-- validator (never by the AI, never by the client); at 7D1 it is
-- always false.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS transfer_task_instances (
  id UUID PRIMARY KEY,                       -- == transferTaskId (server-minted)
  student_id UUID NOT NULL REFERENCES students(id),
  concept_id UUID NOT NULL REFERENCES concepts(id),
  subject_id UUID REFERENCES subjects(id),

  transfer_distance TEXT NOT NULL
    CHECK (transfer_distance IN ('NEAR', 'MID', 'FAR')),
  transfer_modality TEXT NOT NULL
    CHECK (transfer_modality IN ('STRUCTURAL', 'REPRESENTATIONAL')),

  novelty_dimensions TEXT[] NOT NULL DEFAULT '{}',
  target_concept_ids UUID[] NOT NULL DEFAULT '{}',
  context_domain TEXT,

  task_family_id TEXT NOT NULL,

  -- structural (numeric-normalized) similarity hash -- anti-memorization
  prompt_fingerprint TEXT NOT NULL,
  -- exact-content hash -- generation<->submission integrity
  prompt_exact_hash TEXT NOT NULL,

  generator_version TEXT,
  generator_prompt_version TEXT NOT NULL,

  -- written by 7D2's deterministic novelty validator ONLY. false at 7D1.
  novelty_validation_passed BOOLEAN NOT NULL DEFAULT false,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- submit loads by id (the PK already covers that). These support the
-- 7B2 recent-structural-duplicate scan reading from the registry and a
-- future cleanup job.
CREATE INDEX IF NOT EXISTS idx_transfer_task_instances_student_concept
  ON transfer_task_instances (student_id, concept_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transfer_task_instances_fingerprint
  ON transfer_task_instances (student_id, concept_id, prompt_fingerprint);
