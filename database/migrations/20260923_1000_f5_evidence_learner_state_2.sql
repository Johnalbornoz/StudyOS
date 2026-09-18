-- F5: Evidence & Learner State 2.0 -- multidimensional analytical learner
-- state (Skill State, Competency State, Transfer analytics) derived from
-- Evidence, strictly additive. Zero changes to learning_evidence,
-- mastery_records, concept_knowledge_state, concept_memory_state,
-- concept_transfer_state, or any Canonical V2-owned table (see
-- docs/implementation/f5/F5_CURRENT_EVIDENCE_STATE_ASSESSMENT.md and
-- F5_CANONICAL_V2_BOUNDARY.md).
--
-- Knowledge State needs no new table -- concept_knowledge_state already
-- derives from Evidence and is already versioned via
-- mastery_policies/mastery_policy_version. This migration creates only
-- the three genuinely new dimensions plus their shared policy-versioning
-- table. No backfill: per F5_EVIDENCE_BACKFILL_SPEC.md, zero historical
-- evidence carries the new skill/competency/context tags this phase
-- introduces, so no row can be safely created for historical data --
-- sparse absence (NO_EVIDENCE by absence of a row) is the correct
-- representation, never a fabricated one.
--
-- Fully idempotent, never applied automatically by build/start -- apply
-- explicitly via `npm run db:migrate`.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.aggregation_policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dimension text NOT NULL,
  version integer NOT NULL,
  rules jsonb NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  effective_from timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aggregation_policy_versions_dimension_check CHECK (dimension IN ('SKILL', 'COMPETENCY', 'TRANSFER_ANALYTICS')),
  CONSTRAINT aggregation_policy_versions_status_check CHECK (status IN ('ACTIVE', 'RETIRED')),
  CONSTRAINT aggregation_policy_versions_dimension_version_unique UNIQUE (dimension, version)
);

-- At most one ACTIVE policy version per dimension -- a new version
-- retires the old one in the same transaction, never edits it in place.
CREATE UNIQUE INDEX IF NOT EXISTS idx_aggregation_policy_versions_one_active
  ON public.aggregation_policy_versions (dimension) WHERE status = 'ACTIVE';

INSERT INTO public.aggregation_policy_versions (dimension, version, rules)
VALUES
  ('SKILL', 1, '{"minimumEvidenceCount": 3, "independentPredicate": "ai_assistance_type = NONE", "consistentIndependentRequires": "the 3 most recent qualifying evidence rows are all independent and correct"}'::jsonb),
  ('COMPETENCY', 1, '{"minimumEvidenceCount": 3, "independentPredicate": "ai_assistance_type = NONE", "consistentIndependentRequires": "the 3 most recent qualifying evidence rows are all independent and correct", "note": "competency evidence is never synthesized from skill evidence"}'::jsonb),
  ('TRANSFER_ANALYTICS', 1, '{"note": "pure counting by contextCode -- no threshold, no state classification"}'::jsonb)
ON CONFLICT (dimension, version) DO NOTHING;

-- --- Skill State ---

CREATE TABLE IF NOT EXISTS public.learner_skill_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id),
  skill_id uuid NOT NULL REFERENCES public.skills(id),
  state text NOT NULL,
  evidence_count integer NOT NULL DEFAULT 0,
  independent_evidence_count integer NOT NULL DEFAULT 0,
  last_evidence_at timestamptz,
  policy_version_id uuid NOT NULL REFERENCES public.aggregation_policy_versions(id),
  computed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT learner_skill_state_state_check CHECK (state IN ('NO_EVIDENCE', 'INSUFFICIENT_EVIDENCE', 'EMERGING', 'CONSISTENT_INDEPENDENT')),
  CONSTRAINT learner_skill_state_student_skill_unique UNIQUE (student_id, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_learner_skill_state_student ON public.learner_skill_state (student_id);

-- --- Competency State ---

CREATE TABLE IF NOT EXISTS public.learner_competency_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id),
  competency_id uuid NOT NULL REFERENCES public.competencies(id),
  state text NOT NULL,
  evidence_count integer NOT NULL DEFAULT 0,
  independent_evidence_count integer NOT NULL DEFAULT 0,
  last_evidence_at timestamptz,
  policy_version_id uuid NOT NULL REFERENCES public.aggregation_policy_versions(id),
  computed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT learner_competency_state_state_check CHECK (state IN ('NO_EVIDENCE', 'INSUFFICIENT_EVIDENCE', 'EMERGING', 'CONSISTENT_INDEPENDENT')),
  CONSTRAINT learner_competency_state_student_competency_unique UNIQUE (student_id, competency_id)
);

CREATE INDEX IF NOT EXISTS idx_learner_competency_state_student ON public.learner_competency_state (student_id);

-- --- Transfer analytics (context diversity only -- see F5_TARGET_LEARNER_STATE_ARCHITECTURE.md
-- for why this is explicitly NOT a 6th transfer-depth vocabulary) ---

CREATE TABLE IF NOT EXISTS public.learner_transfer_analytics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id),
  concept_id uuid NOT NULL REFERENCES public.concepts(id),
  canonical_concept_id uuid REFERENCES public.canonical_concepts(id),
  context_familiar_count integer NOT NULL DEFAULT 0,
  context_altered_count integer NOT NULL DEFAULT 0,
  context_real_world_count integer NOT NULL DEFAULT 0,
  context_unfamiliar_count integer NOT NULL DEFAULT 0,
  context_cross_domain_count integer NOT NULL DEFAULT 0,
  distinct_context_count integer NOT NULL DEFAULT 0,
  policy_version_id uuid NOT NULL REFERENCES public.aggregation_policy_versions(id),
  computed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT learner_transfer_analytics_student_concept_unique UNIQUE (student_id, concept_id)
);

CREATE INDEX IF NOT EXISTS idx_learner_transfer_analytics_student ON public.learner_transfer_analytics (student_id);
CREATE INDEX IF NOT EXISTS idx_learner_transfer_analytics_canonical ON public.learner_transfer_analytics (canonical_concept_id);
