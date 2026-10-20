-- QF V5.2 -- the EXAM QUESTION BANK: certification, coverage and the Exam supply authority.
-- PROPOSAL: NOT IN database/migrations, NOT APPLIED ANYWHERE.
--
-- SCOPE. Everything here is STANDARDIZED EXAM content (EXAM_BANK_ITEM). Ordinary Learning and StudyUs Internal
-- Assessment have their own dynamic supply and their own item types (LEARNING_ITEM, INTERNAL_ASSESSMENT_ITEM); they
-- neither read nor write any table of this file.
--
-- This file lives under docs/ on purpose: the migration runner does not see it. It is the ONE proposal of the Exam
-- Bank line. Its slot is the next free one after the migrations of every line it must be integrated with:
--   87  20261121_1000_student_scheduled_assessments.sql              (AD_HOC, 557707f)
--   88  20261121_1100_qf51_construct_core_lineage.sql                (QF V5.1, 53abc42)
--   89  20261122_1000_learner_concept_curriculum_provenance.sql      (curriculum convergence, 9007a0a)
--   90  20261122_1100_canonical_concept_reviewed_aliases.sql         (reviewed aliases, 9007a0a)
--   91  20261122_1200_qf52_exam_bank_certification_coverage.sql      (this file)
-- An earlier draft of this file used the prefix 20261122_1100: that prefix belongs to the reviewed-aliases
-- migration. The slot is to be re-checked against every line again when the file is moved into database/migrations.
-- It is exercised only on a throwaway local Postgres by scripts/qf-step4b-ephemeral-db-test.sh, which applies all
-- five in that order.
--
-- V5.2 adds to the Step 4B model: versioned certification policies; a certification STATE per governed object,
-- decided by policy or by a person, with its reasons; eligibility SCOPES kept apart from certification (PILOT_PREVIEW
-- vs PRODUCTION, the latter only with an explicit release); a rights category on the instance; quarantine of an
-- envelope by an incident; coverage snapshots and gaps; batch state with checkpoints; audit results; and an
-- invariant that fails when a weaker Student eligibility view is left standing.
--
-- ADDITIVE. No table, column or row of an earlier migration is removed or rewritten. Three functions/views of
-- earlier migrations are replaced with definitions that are at least as strict:
--   student_eligible_item_instances   (88)             now also requires what this file introduces
--   question_bank_quality_guard()     (20261110_1500)  the per-item review rule is KEPT; one further, narrower way
--                                                      to ACTIVE is added for a core-derived item whose instance
--                                                      is deliverable (INHERITED_DETERMINISTIC_CERTIFICATION or
--                                                      an individual instance review). Nothing else is exempted.
--
-- What it adds:
--   A. assessment_blueprint_classifications / assessment_blueprint_buckets   what a governed blueprint IS, persisted
--   B. assessment_certifications                                             who certified what, when, on what evidence
--   C. assessment_renderer_envelopes                                         the envelope a renderer is certified for
--   D. assessment_item_instances.item_difficulty                             item difficulty 1..5, required
--   E. assessment_item_instances.certification_mode                          INDIVIDUAL_ITEM_REVIEW | INHERITED_DETERMINISTIC_CERTIFICATION
--   F. assessment_reviewer_qualifications                                    reviewer scope: canonical subject x registered system
-- Invariants: a certification is accepted only from a reviewer whose qualification covers its scope when it is
-- made; certifications are append-only and a later non-approval of the same object revokes; an adapter, a core or
-- a renderer becomes CERTIFIED only with such a record on its current content; an instance is stored only with a
-- difficulty, rights, a digest and one valid certification mode. Fail closed: neither mode valid = refused.
--
-- No row is inserted by this file: no reviewer, no qualification, no certification, no classification.

-- F. Reviewer qualifications -----------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.assessment_reviewer_qualifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reviewer_id text NOT NULL CHECK (length(btrim(reviewer_id)) > 0),
  -- an INTERNAL StudyUs certification authority; never an external academic accreditation
  authority text NOT NULL CHECK (authority IN ('INTERNAL_PILOT_REVIEWER')),
  canonical_subject text NOT NULL CHECK (length(btrim(canonical_subject)) > 0),
  system_id text NOT NULL REFERENCES public.assessment_systems(system_id) ON DELETE RESTRICT,
  granted_by text NOT NULL CHECK (length(btrim(granted_by)) > 0),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT assessment_reviewer_qualifications_dates_ck CHECK (revoked_at IS NULL OR revoked_at >= granted_at),
  CONSTRAINT assessment_reviewer_qualifications_uq UNIQUE (reviewer_id, authority, canonical_subject, system_id, granted_at)
);
CREATE OR REPLACE FUNCTION public.assessment_reviewer_qualification_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'REVIEWER_QUALIFICATION_NO_DELETE' USING ERRCODE = 'check_violation';
  END IF;
  -- a grant is never edited; it can only be revoked, once
  IF TG_OP = 'UPDATE' AND (OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL
     OR (to_jsonb(NEW) - 'revoked_at') IS DISTINCT FROM (to_jsonb(OLD) - 'revoked_at')) THEN
    RAISE EXCEPTION 'REVIEWER_QUALIFICATION_IS_IMMUTABLE' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_assessment_reviewer_qualification_guard ON public.assessment_reviewer_qualifications;
CREATE TRIGGER trg_assessment_reviewer_qualification_guard BEFORE UPDATE OR DELETE ON public.assessment_reviewer_qualifications
  FOR EACH ROW EXECUTE FUNCTION public.assessment_reviewer_qualification_guard();

-- B. Certification records ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.assessment_certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reviewer_id text NOT NULL,
  authority text NOT NULL CHECK (authority IN ('INTERNAL_PILOT_REVIEWER')),
  qualification_id uuid NOT NULL REFERENCES public.assessment_reviewer_qualifications(id) ON DELETE RESTRICT,
  canonical_subject text NOT NULL,
  system_id text NOT NULL REFERENCES public.assessment_systems(system_id) ON DELETE RESTRICT,
  object_type text NOT NULL CHECK (object_type IN ('CONSTRUCT_CORE', 'ASSESSMENT_ADAPTER', 'RENDERER_ENVELOPE', 'BLUEPRINT_CLASSIFICATION', 'CORE_APPLICABILITY', 'ITEM_INSTANCE')),
  object_id text NOT NULL CHECK (length(btrim(object_id)) > 0),
  object_version text NOT NULL CHECK (length(btrim(object_version)) > 0),
  decision text NOT NULL CHECK (decision IN ('APPROVE', 'APPROVE_WITH_CHANGES', 'REJECT')),
  decided_at timestamptz NOT NULL DEFAULT now(),
  -- sha256 of exactly what was reviewed
  evidence_hash text NOT NULL CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
  notes text,
  -- a decision other than a plain approval says why
  CONSTRAINT assessment_certifications_reason_ck CHECK (decision = 'APPROVE' OR (notes IS NOT NULL AND length(btrim(notes)) >= 10))
);
CREATE INDEX IF NOT EXISTS assessment_certifications_object_idx ON public.assessment_certifications (object_type, object_id, object_version, system_id, decided_at);

CREATE OR REPLACE FUNCTION public.assessment_certification_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  q public.assessment_reviewer_qualifications%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'CERTIFICATION_IS_APPEND_ONLY' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO q FROM public.assessment_reviewer_qualifications WHERE id = NEW.qualification_id;
  IF q.reviewer_id IS DISTINCT FROM NEW.reviewer_id OR q.authority IS DISTINCT FROM NEW.authority THEN
    RAISE EXCEPTION 'CERTIFICATION_REVIEWER_NOT_QUALIFIED: %', NEW.reviewer_id USING ERRCODE = 'check_violation';
  END IF;
  IF q.canonical_subject IS DISTINCT FROM NEW.canonical_subject OR q.system_id IS DISTINCT FROM NEW.system_id THEN
    RAISE EXCEPTION 'CERTIFICATION_SCOPE_NOT_COVERED: % x %', NEW.canonical_subject, NEW.system_id USING ERRCODE = 'check_violation';
  END IF;
  IF q.granted_at > NEW.decided_at OR (q.revoked_at IS NOT NULL AND NEW.decided_at >= q.revoked_at) THEN
    RAISE EXCEPTION 'CERTIFICATION_QUALIFICATION_NOT_IN_FORCE: %', NEW.reviewer_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_assessment_certification_guard ON public.assessment_certifications;
CREATE TRIGGER trg_assessment_certification_guard BEFORE INSERT OR UPDATE OR DELETE ON public.assessment_certifications
  FOR EACH ROW EXECUTE FUNCTION public.assessment_certification_guard();

-- V5.2: certification policies, versioned and content-hashed ------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.assessment_certification_policies (
  policy_hash text PRIMARY KEY CHECK (policy_hash ~ '^[a-f0-9]{64}$'),
  policy_id text NOT NULL CHECK (length(btrim(policy_id)) > 0),
  version text NOT NULL CHECK (length(btrim(version)) > 0),
  -- the scopes a certification under this policy may grant. A calibration policy never lists PRODUCTION.
  may_grant_scopes text[] NOT NULL CHECK (may_grant_scopes <@ ARRAY['PILOT_PREVIEW', 'PRODUCTION']),
  policy jsonb NOT NULL CHECK (jsonb_typeof(policy) = 'object' AND jsonb_typeof(policy->'rules') = 'array' AND jsonb_typeof(policy->'deliverableRights') = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assessment_certification_policies_version_uq UNIQUE (policy_id, version)
);

-- V5.2: the certification STATE of a governed object, decided by a policy or by a person, with its reasons ----------
CREATE TABLE IF NOT EXISTS public.assessment_object_certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  object_type text NOT NULL CHECK (object_type IN ('CONSTRUCT_CORE', 'ASSESSMENT_ADAPTER', 'RENDERER_ENVELOPE', 'BLUEPRINT_CLASSIFICATION', 'CORE_APPLICABILITY')),
  object_id text NOT NULL CHECK (length(btrim(object_id)) > 0),
  object_version text NOT NULL CHECK (length(btrim(object_version)) > 0),
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  state text NOT NULL CHECK (state IN ('DRAFT', 'VALIDATING', 'AUTOMATED_CERTIFIED_PILOT', 'REVIEW_REQUIRED', 'HUMAN_CERTIFIED', 'REJECTED', 'QUARANTINED', 'RETIRED')),
  policy_hash text NOT NULL REFERENCES public.assessment_certification_policies(policy_hash) ON DELETE RESTRICT,
  -- rule id, reason code, what was seen: never a bare "failed"
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(reasons) = 'array'),
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence) = 'array'),
  human_certification_id uuid REFERENCES public.assessment_certifications(id) ON DELETE RESTRICT,
  decided_by text NOT NULL CHECK (length(btrim(decided_by)) > 0),
  decided_at timestamptz NOT NULL DEFAULT now(),
  -- HUMAN_CERTIFIED is a person's recorded approval, and nothing else is
  CONSTRAINT assessment_object_certifications_human_ck CHECK ((state = 'HUMAN_CERTIFIED') = (human_certification_id IS NOT NULL)),
  CONSTRAINT assessment_object_certifications_clean_ck CHECK (state <> 'AUTOMATED_CERTIFIED_PILOT' OR jsonb_array_length(reasons) = 0),
  CONSTRAINT assessment_object_certifications_reason_ck CHECK (state NOT IN ('REVIEW_REQUIRED', 'REJECTED', 'QUARANTINED') OR jsonb_array_length(reasons) > 0)
);
CREATE INDEX IF NOT EXISTS assessment_object_certifications_object_idx ON public.assessment_object_certifications (object_type, object_id, object_version, decided_at);
CREATE OR REPLACE FUNCTION public.assessment_object_certification_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'OBJECT_CERTIFICATION_IS_APPEND_ONLY' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.state = 'HUMAN_CERTIFIED' AND NOT EXISTS (SELECT 1 FROM public.assessment_certifications c
       WHERE c.id = NEW.human_certification_id AND c.decision = 'APPROVE' AND c.object_type = NEW.object_type AND c.object_id = NEW.object_id
         AND c.object_version = NEW.object_version AND c.evidence_hash = NEW.content_hash) THEN
    RAISE EXCEPTION 'HUMAN_CERTIFIED_NEEDS_AN_APPROVAL_OF_THIS_CONTENT: % %', NEW.object_type, NEW.object_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_assessment_object_certification_guard ON public.assessment_object_certifications;
CREATE TRIGGER trg_assessment_object_certification_guard BEFORE INSERT OR UPDATE OR DELETE ON public.assessment_object_certifications
  FOR EACH ROW EXECUTE FUNCTION public.assessment_object_certification_guard();
DROP TRIGGER IF EXISTS trg_assessment_certification_policy_immutable ON public.assessment_certification_policies;
CREATE OR REPLACE FUNCTION public.assessment_policy_immutable_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CERTIFICATION_POLICY_IS_IMMUTABLE: a changed policy is a new version' USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER trg_assessment_certification_policy_immutable BEFORE UPDATE OR DELETE ON public.assessment_certification_policies
  FOR EACH ROW EXECUTE FUNCTION public.assessment_policy_immutable_guard();

-- Is this object, at this content, certified for this system NOW? An APPROVE of exactly this content, with no
-- later decision on the same object and system that is not an approval. A NULL system asks "for any system".
CREATE OR REPLACE FUNCTION public.assessment_certified(p_type text, p_id text, p_version text, p_hash text, p_system text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT (
      -- a person approved exactly this content, and no later decision of a person on it is a non-approval
      EXISTS (
        SELECT 1 FROM public.assessment_certifications c
         WHERE c.object_type = p_type AND c.object_id = p_id AND c.object_version = p_version AND c.evidence_hash = p_hash
           AND c.decision = 'APPROVE' AND (p_system IS NULL OR c.system_id = p_system)
           AND NOT EXISTS (SELECT 1 FROM public.assessment_certifications later
                            WHERE later.object_type = c.object_type AND later.object_id = c.object_id AND later.object_version = c.object_version
                              AND later.system_id = c.system_id AND later.decided_at > c.decided_at AND later.decision <> 'APPROVE'))
      -- or the policy certified exactly this content
      OR EXISTS (
        SELECT 1 FROM public.assessment_object_certifications o
         WHERE o.object_type = p_type AND o.object_id = p_id AND o.object_version = p_version AND o.content_hash = p_hash
           AND o.state IN ('AUTOMATED_CERTIFIED_PILOT', 'HUMAN_CERTIFIED')))
    -- and the object's LATEST state is a deliverable one: a later REVIEW_REQUIRED, REJECTED, QUARANTINED or RETIRED withdraws it
    AND NOT EXISTS (
      SELECT 1 FROM public.assessment_object_certifications x
       WHERE x.object_type = p_type AND x.object_id = p_id AND x.object_version = p_version
         AND x.state NOT IN ('AUTOMATED_CERTIFIED_PILOT', 'HUMAN_CERTIFIED')
         AND NOT EXISTS (SELECT 1 FROM public.assessment_object_certifications y
                          WHERE y.object_type = x.object_type AND y.object_id = x.object_id AND y.object_version = x.object_version
                            AND y.decided_at > x.decided_at AND y.content_hash = p_hash AND y.state IN ('AUTOMATED_CERTIFIED_PILOT', 'HUMAN_CERTIFIED')))
$$;

-- A. Blueprint classification -----------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.assessment_blueprint_classifications (
  blueprint_id text NOT NULL CHECK (length(btrim(blueprint_id)) > 0),
  classification_version text NOT NULL CHECK (length(btrim(classification_version)) > 0),
  system_id text NOT NULL,
  system_version_id text NOT NULL,
  adapter_id text NOT NULL,
  -- the class is of the STRUCTURE; the content status of the items a configuration ships (fixture or not) is not an input
  blueprint_class text NOT NULL CHECK (blueprint_class IN ('FULL', 'ALIGNED', 'REDUCED', 'DEMO', 'NOT_APPLICABLE')),
  facts jsonb NOT NULL CHECK (jsonb_typeof(facts) = 'object'),
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blueprint_id, classification_version),
  FOREIGN KEY (system_id, system_version_id) REFERENCES public.assessment_system_versions(system_id, version_id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS public.assessment_blueprint_buckets (
  bucket_id text NOT NULL CHECK (length(btrim(bucket_id)) > 0),
  blueprint_id text NOT NULL,
  classification_version text NOT NULL,
  objective_code text NOT NULL,
  -- a bucket with no canonical concept places nothing
  primary_concept_stable_ids text[] NOT NULL CHECK (cardinality(primary_concept_stable_ids) > 0),
  PRIMARY KEY (bucket_id, classification_version),
  FOREIGN KEY (blueprint_id, classification_version) REFERENCES public.assessment_blueprint_classifications(blueprint_id, classification_version) ON DELETE RESTRICT
);
CREATE OR REPLACE FUNCTION public.assessment_immutable_row_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ROW_IS_IMMUTABLE: %', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END $$;
DROP TRIGGER IF EXISTS trg_assessment_blueprint_classification_immutable ON public.assessment_blueprint_classifications;
CREATE TRIGGER trg_assessment_blueprint_classification_immutable BEFORE UPDATE OR DELETE ON public.assessment_blueprint_classifications
  FOR EACH ROW EXECUTE FUNCTION public.assessment_immutable_row_guard();
DROP TRIGGER IF EXISTS trg_assessment_blueprint_bucket_immutable ON public.assessment_blueprint_buckets;
CREATE TRIGGER trg_assessment_blueprint_bucket_immutable BEFORE UPDATE OR DELETE ON public.assessment_blueprint_buckets
  FOR EACH ROW EXECUTE FUNCTION public.assessment_immutable_row_guard();

-- C. Renderer envelopes -----------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.assessment_renderer_envelopes (
  envelope_hash text PRIMARY KEY CHECK (envelope_hash ~ '^[a-f0-9]{64}$'),
  renderer_version text NOT NULL REFERENCES public.assessment_instance_renderers(renderer_version) ON DELETE RESTRICT,
  construct_family_id text NOT NULL,
  family_version text NOT NULL,
  -- the envelope a reviewer certifies: adapters, languages, formats, parameter ranges, and per band the item difficulty 1..5
  envelope jsonb NOT NULL CHECK (jsonb_typeof(envelope) = 'object' AND jsonb_typeof(envelope->'bands') = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assessment_renderer_envelopes_identity_ck CHECK (envelope->>'rendererVersion' = renderer_version AND envelope->>'constructFamilyId' = construct_family_id AND envelope->>'constructFamilyVersion' = family_version)
);
DROP TRIGGER IF EXISTS trg_assessment_renderer_envelope_immutable ON public.assessment_renderer_envelopes;
CREATE TRIGGER trg_assessment_renderer_envelope_immutable BEFORE UPDATE OR DELETE ON public.assessment_renderer_envelopes
  FOR EACH ROW EXECUTE FUNCTION public.assessment_immutable_row_guard();

-- A CONDITIONAL applicability is approved on its own content.
ALTER TABLE public.assessment_construct_core_applicability ADD COLUMN IF NOT EXISTS content_hash text;
ALTER TABLE public.assessment_construct_core_applicability DROP CONSTRAINT IF EXISTS assessment_construct_core_applicability_hash_ck;
ALTER TABLE public.assessment_construct_core_applicability ADD CONSTRAINT assessment_construct_core_applicability_hash_ck CHECK (content_hash IS NULL OR content_hash ~ '^[a-f0-9]{64}$');

-- B/C. CERTIFIED is a recorded decision, not a flag someone sets --------------------------------------------------
CREATE OR REPLACE FUNCTION public.assessment_certified_status_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'assessment_adapters' THEN
    IF NEW.status = 'CERTIFIED' AND NOT public.assessment_certified('ASSESSMENT_ADAPTER', NEW.adapter_id, NEW.adapter_version, NEW.content_hash, NEW.system_id) THEN
      RAISE EXCEPTION 'ADAPTER_CERTIFIED_NEEDS_A_CERTIFICATION: % @ %', NEW.adapter_id, NEW.adapter_version USING ERRCODE = 'check_violation';
    END IF;
  ELSIF TG_TABLE_NAME = 'assessment_construct_cores' THEN
    IF NEW.lifecycle = 'CERTIFIED' AND NOT public.assessment_certified('CONSTRUCT_CORE', NEW.construct_family_id, NEW.family_version, NEW.content_hash, NULL) THEN
      RAISE EXCEPTION 'CORE_CERTIFIED_NEEDS_A_CERTIFICATION: % @ %', NEW.construct_family_id, NEW.family_version USING ERRCODE = 'check_violation';
    END IF;
  ELSIF TG_TABLE_NAME = 'assessment_instance_renderers' THEN
    -- a renderer is certified for an envelope, never in general
    IF NEW.status = 'CERTIFIED' AND NOT EXISTS (SELECT 1 FROM public.assessment_renderer_envelopes e
         WHERE e.renderer_version = NEW.renderer_version AND public.assessment_certified('RENDERER_ENVELOPE', e.renderer_version, e.family_version, e.envelope_hash, NULL)) THEN
      RAISE EXCEPTION 'RENDERER_CERTIFIED_NEEDS_A_CERTIFIED_ENVELOPE: %', NEW.renderer_version USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_assessment_adapter_certification_guard ON public.assessment_adapters;
CREATE TRIGGER trg_assessment_adapter_certification_guard BEFORE INSERT OR UPDATE ON public.assessment_adapters
  FOR EACH ROW EXECUTE FUNCTION public.assessment_certified_status_guard();
DROP TRIGGER IF EXISTS trg_assessment_construct_core_certification_guard ON public.assessment_construct_cores;
CREATE TRIGGER trg_assessment_construct_core_certification_guard BEFORE UPDATE ON public.assessment_construct_cores
  FOR EACH ROW WHEN (NEW.lifecycle = 'CERTIFIED' AND OLD.lifecycle IS DISTINCT FROM 'CERTIFIED') EXECUTE FUNCTION public.assessment_certified_status_guard();
DROP TRIGGER IF EXISTS trg_assessment_instance_renderer_certification_guard ON public.assessment_instance_renderers;
CREATE TRIGGER trg_assessment_instance_renderer_certification_guard BEFORE INSERT OR UPDATE ON public.assessment_instance_renderers
  FOR EACH ROW EXECUTE FUNCTION public.assessment_certified_status_guard();

-- D/E. The instance: difficulty, envelope, digest, rights, certification mode ------------------------------------
ALTER TABLE public.assessment_item_instances
  ADD COLUMN IF NOT EXISTS item_difficulty smallint,
  ADD COLUMN IF NOT EXISTS envelope_hash text REFERENCES public.assessment_renderer_envelopes(envelope_hash) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS content_hash text,
  ADD COLUMN IF NOT EXISTS certification_digest text,
  ADD COLUMN IF NOT EXISTS certification_mode text,
  ADD COLUMN IF NOT EXISTS rights_status text,
  ADD COLUMN IF NOT EXISTS rights_basis text,
  -- V5.2: what the instance IS (state), where it may be delivered (scopes), under which policy, and its recognition class
  ADD COLUMN IF NOT EXISTS certification_state text,
  ADD COLUMN IF NOT EXISTS eligibility_scopes text[],
  ADD COLUMN IF NOT EXISTS rights_category text,
  ADD COLUMN IF NOT EXISTS policy_hash text REFERENCES public.assessment_certification_policies(policy_hash) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS recognition_id text,
  -- what the row IS: an item of the Exam Bank. A learning item or an internal-assessment item is never stored here.
  ADD COLUMN IF NOT EXISTS item_type text NOT NULL DEFAULT 'EXAM_BANK_ITEM';
ALTER TABLE public.assessment_item_instances DROP CONSTRAINT IF EXISTS assessment_item_instances_certification_ck;
ALTER TABLE public.assessment_item_instances ADD CONSTRAINT assessment_item_instances_certification_ck CHECK (
      (item_difficulty IS NULL OR item_difficulty BETWEEN 1 AND 5)
  AND (certification_mode IS NULL OR certification_mode IN ('INDIVIDUAL_ITEM_REVIEW', 'INHERITED_DETERMINISTIC_CERTIFICATION'))
  AND (content_hash IS NULL OR content_hash ~ '^[a-f0-9]{64}$')
  AND (certification_digest IS NULL OR certification_digest ~ '^[a-f0-9]{64}$')
  AND (rights_status IS NULL OR rights_status IN ('STUDYUS_OWNED', 'LICENSED_FOR_USE', 'OFFICIALLY_AUTHORIZED'))
  AND (certification_state IS NULL OR certification_state IN ('DRAFT', 'VALIDATING', 'AUTOMATED_CERTIFIED_PILOT', 'REVIEW_REQUIRED', 'HUMAN_CERTIFIED', 'REJECTED', 'QUARANTINED', 'RETIRED'))
  AND (eligibility_scopes IS NULL OR eligibility_scopes <@ ARRAY['PILOT_PREVIEW', 'PRODUCTION'])
  AND item_type = 'EXAM_BANK_ITEM'
  AND (rights_category IS NULL OR rights_category IN ('STUDYUS_ORIGINAL_DETERMINISTIC', 'STUDYUS_ORIGINAL_GENERATED', 'LICENSED', 'PUBLIC_DOMAIN', 'EXTERNAL_UNKNOWN', 'FIXTURE_ONLY', 'LEGACY_UNKNOWN')));
CREATE UNIQUE INDEX IF NOT EXISTS assessment_item_instances_digest_uq ON public.assessment_item_instances (certification_digest) WHERE certification_digest IS NOT NULL;

-- V5.2: an incident freezes an ENVELOPE; every instance of it is quarantined until the incident is resolved ---------
CREATE TABLE IF NOT EXISTS public.assessment_envelope_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  envelope_hash text NOT NULL REFERENCES public.assessment_renderer_envelopes(envelope_hash) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED')),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 10),
  opened_by text NOT NULL CHECK (length(btrim(opened_by)) > 0),
  opened_at timestamptz NOT NULL DEFAULT now(),
  resolved_by text,
  resolved_at timestamptz,
  CONSTRAINT assessment_envelope_incidents_resolution_ck CHECK ((status = 'RESOLVED') = (resolved_at IS NOT NULL AND resolved_by IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS assessment_envelope_incidents_open_idx ON public.assessment_envelope_incidents (envelope_hash) WHERE status = 'OPEN';

-- V5.2: PRODUCTION is never granted by a certification. It takes an explicit release of an envelope, on the record --
CREATE TABLE IF NOT EXISTS public.assessment_production_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  envelope_hash text NOT NULL REFERENCES public.assessment_renderer_envelopes(envelope_hash) ON DELETE RESTRICT,
  authorised_by text NOT NULL CHECK (length(btrim(authorised_by)) > 0),
  -- what the release rests on: out-of-sample evidence, the audit record, the governance decision
  evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence) = 'object' AND evidence ? 'outOfSampleEvidence'),
  released_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

-- Why an instance may NOT be delivered, as things stand NOW. NULL = deliverable. One definition, read by the
-- insert guard, by the Student supply view and by the bank guard: there is no second eligibility rule.
CREATE OR REPLACE FUNCTION public.assessment_item_instance_refusal(i public.assessment_item_instances) RETURNS text
LANGUAGE plpgsql STABLE AS $$
DECLARE
  core public.assessment_construct_cores%ROWTYPE;
  adapter public.assessment_adapters%ROWTYPE;
  applicability public.assessment_construct_core_applicability%ROWTYPE;
  renderer public.assessment_instance_renderers%ROWTYPE;
  env public.assessment_renderer_envelopes%ROWTYPE;
BEGIN
  IF i.item_difficulty IS NULL THEN RETURN 'DIFFICULTY_NOT_RECORDED'; END IF;
  IF i.rights_status IS NULL OR i.rights_basis IS NULL OR length(btrim(i.rights_basis)) < 10 THEN RETURN 'RIGHTS_NOT_VALID'; END IF;
  IF i.content_hash IS NULL OR i.certification_digest IS NULL THEN RETURN 'LINEAGE_INCOMPLETE'; END IF;
  IF i.certification_mode IS NULL THEN RETURN 'NO_CERTIFICATION_MODE'; END IF;
  -- V5.2: a deliverable state, at least one scope, a policy, a rights category the policy delivers in every scope asked
  IF i.certification_state IS NULL OR i.certification_state NOT IN ('AUTOMATED_CERTIFIED_PILOT', 'HUMAN_CERTIFIED') THEN RETURN 'NOT_CERTIFIED'; END IF;
  IF i.policy_hash IS NULL THEN RETURN 'NO_CERTIFICATION_POLICY'; END IF;
  IF i.eligibility_scopes IS NULL OR cardinality(i.eligibility_scopes) = 0 THEN RETURN 'NO_ELIGIBILITY_SCOPE'; END IF;
  IF i.rights_category IS NULL THEN RETURN 'RIGHTS_NOT_VALID'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(i.eligibility_scopes) sc, public.assessment_certification_policies pol
              WHERE pol.policy_hash = i.policy_hash AND NOT (pol.policy->'deliverableRights'->sc) ? i.rights_category) THEN RETURN 'RIGHTS_STATE_NOT_DELIVERABLE'; END IF;
  -- a scope the policy may not grant is granted only by an explicit, unrevoked release of the envelope
  IF EXISTS (SELECT 1 FROM unnest(i.eligibility_scopes) sc, public.assessment_certification_policies pol
              WHERE pol.policy_hash = i.policy_hash AND NOT (sc = ANY (pol.may_grant_scopes))
                AND NOT EXISTS (SELECT 1 FROM public.assessment_production_releases pr WHERE pr.envelope_hash = i.envelope_hash AND pr.revoked_at IS NULL AND sc = 'PRODUCTION')) THEN RETURN 'SCOPE_NOT_GRANTED'; END IF;
  IF i.envelope_hash IS NOT NULL AND EXISTS (SELECT 1 FROM public.assessment_envelope_incidents inc WHERE inc.envelope_hash = i.envelope_hash AND inc.status = 'OPEN') THEN RETURN 'QUARANTINED'; END IF;
  SELECT * INTO core FROM public.assessment_construct_cores WHERE id = i.core_id;
  IF core.lifecycle IS DISTINCT FROM 'CERTIFIED' OR NOT public.assessment_certified('CONSTRUCT_CORE', core.construct_family_id, core.family_version, core.content_hash, i.system_id) THEN RETURN 'CORE_NOT_CERTIFIED'; END IF;
  SELECT * INTO adapter FROM public.assessment_adapters WHERE adapter_id = i.adapter_id AND adapter_version = i.adapter_version;
  IF adapter.status IS DISTINCT FROM 'CERTIFIED' OR NOT public.assessment_certified('ASSESSMENT_ADAPTER', adapter.adapter_id, adapter.adapter_version, adapter.content_hash, i.system_id) THEN RETURN 'ADAPTER_NOT_CERTIFIED'; END IF;
  SELECT * INTO applicability FROM public.assessment_construct_core_applicability WHERE core_id = i.core_id AND adapter_id = i.adapter_id;
  IF applicability.status IS NULL OR applicability.status = 'NOT_APPLICABLE' THEN RETURN 'APPLICABILITY_NOT_SUPPORTED'; END IF;
  IF applicability.status = 'CONDITIONAL' AND (applicability.content_hash IS NULL
     OR NOT public.assessment_certified('CORE_APPLICABILITY', core.construct_family_id || ' x ' || i.adapter_id, core.family_version, applicability.content_hash, i.system_id)) THEN
    RETURN 'CONDITIONAL_APPLICABILITY_NOT_APPROVED';
  END IF;
  -- the bucket belongs to a classified blueprint of this adapter, links the concept, and the class admits Student use
  IF NOT EXISTS (SELECT 1 FROM public.assessment_blueprint_buckets b
                   JOIN public.assessment_blueprint_classifications c ON c.blueprint_id = b.blueprint_id AND c.classification_version = b.classification_version
                  WHERE b.bucket_id = i.blueprint_bucket_id AND c.adapter_id = i.adapter_id AND i.primary_concept_stable_id = ANY (b.primary_concept_stable_ids)
                    AND c.blueprint_class IN ('FULL', 'ALIGNED', 'REDUCED')
                    AND public.assessment_certified('BLUEPRINT_CLASSIFICATION', c.blueprint_id, c.classification_version, c.content_hash, i.system_id)) THEN
    RETURN 'BLUEPRINT_NOT_GOVERNED';
  END IF;
  SELECT * INTO renderer FROM public.assessment_instance_renderers WHERE renderer_version = i.renderer_version;
  IF i.certification_mode = 'INHERITED_DETERMINISTIC_CERTIFICATION' THEN
    IF renderer.status IS DISTINCT FROM 'CERTIFIED' THEN RETURN 'RENDERER_NOT_CERTIFIED'; END IF;
    -- composed or stimulus-bearing content does not inherit from a parametric envelope
    IF renderer.strategy IS DISTINCT FROM 'PARAMETRIC_DETERMINISTIC' OR (i.learner ? 'stimulus' AND jsonb_typeof(i.learner->'stimulus') <> 'null') THEN RETURN 'CONTENT_NEEDS_AN_INDIVIDUAL_REVIEW'; END IF;
    SELECT * INTO env FROM public.assessment_renderer_envelopes WHERE envelope_hash = i.envelope_hash;
    IF env.envelope_hash IS NULL OR env.renderer_version IS DISTINCT FROM i.renderer_version
       OR env.construct_family_id IS DISTINCT FROM core.construct_family_id OR env.family_version IS DISTINCT FROM core.family_version THEN RETURN 'ENVELOPE_IS_NOT_OF_THIS_RENDER'; END IF;
    IF NOT public.assessment_certified('RENDERER_ENVELOPE', env.renderer_version, env.family_version, env.envelope_hash, i.system_id) THEN RETURN 'RENDERER_ENVELOPE_NOT_CERTIFIED'; END IF;
    IF NOT (env.envelope->'adapterIds') ? i.adapter_id THEN RETURN 'OUTSIDE_THE_CERTIFIED_ENVELOPE'; END IF;
    -- the stored difficulty is one the certified envelope assigns; a number from anywhere else is refused
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(env.envelope->'bands') b WHERE (b->>'itemDifficulty')::int = i.item_difficulty) THEN RETURN 'DIFFICULTY_IS_NOT_THE_ENVELOPES'; END IF;
  ELSE
    -- an individual review is of exactly this instance: its digest is both the object and the evidence
    IF NOT public.assessment_certified('ITEM_INSTANCE', i.certification_digest, i.renderer_version, i.certification_digest, i.system_id) THEN RETURN 'NO_INDIVIDUAL_REVIEW'; END IF;
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.assessment_item_instance_certification_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  reason text;
BEGIN
  reason := public.assessment_item_instance_refusal(NEW);
  IF reason IS NOT NULL THEN
    RAISE EXCEPTION 'INSTANCE_NOT_CERTIFIED: %', reason USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_assessment_item_instance_certification_guard ON public.assessment_item_instances;
CREATE TRIGGER trg_assessment_item_instance_certification_guard BEFORE INSERT ON public.assessment_item_instances
  FOR EACH ROW EXECUTE FUNCTION public.assessment_item_instance_certification_guard();

-- THE Student supply authority. 88's joins are kept (active system and version, certified core at its current
-- certification version, certified adapter, applicability) and the refusal function adds everything above.
CREATE OR REPLACE VIEW public.student_eligible_item_instances AS
SELECT i.*
  FROM public.assessment_item_instances i
  JOIN public.assessment_construct_cores c ON c.id = i.core_id AND c.lifecycle = 'CERTIFIED' AND c.certification_version = i.certification_version
  JOIN public.assessment_systems s ON s.system_id = i.system_id AND s.lifecycle = 'ACTIVE'
  JOIN public.assessment_system_versions v ON v.system_id = i.system_id AND v.version_id = i.system_version_id AND v.lifecycle = 'ACTIVE'
  JOIN public.assessment_adapters a ON a.adapter_id = i.adapter_id AND a.adapter_version = i.adapter_version AND a.status = 'CERTIFIED'
  JOIN public.assessment_instance_renderers r ON r.renderer_version = i.renderer_version AND r.status = 'CERTIFIED'
  JOIN public.assessment_construct_core_applicability p ON p.core_id = i.core_id AND p.adapter_id = i.adapter_id AND p.status IN ('SUPPORTED', 'CONDITIONAL')
 WHERE public.assessment_item_instance_refusal(i) IS NULL;

-- The materialised bank item of a deliverable instance. The per-item review rule is unchanged for every other item.
CREATE OR REPLACE FUNCTION public.question_bank_item_inherits_certification(p_bank_item_id uuid, p_content jsonb) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.question_bank_items qi
      JOIN public.student_eligible_item_instances i ON i.id = qi.item_instance_id
     WHERE qi.id = p_bank_item_id AND qi.lineage_class = 'CORE_DERIVED'
       -- the materialised content is the instance's: same digest, same difficulty; an edited copy inherits nothing
       AND p_content->'lineage'->>'digest' = i.certification_digest
       AND p_content->>'difficulty' = i.item_difficulty::text)
$$;

CREATE OR REPLACE FUNCTION public.question_bank_quality_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  prov text;
BEGIN
  IF NEW.bank_item_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT provenance INTO prov FROM public.question_bank_items WHERE id = NEW.bank_item_id;
  IF NEW.exam_alignment = 'OFFICIAL' AND prov NOT IN ('OFFICIAL', 'LICENSED') THEN
    RAISE EXCEPTION 'QUESTION_BANK_OFFICIAL_NEEDS_OFFICIAL_PROVENANCE: version % (%)', NEW.id, prov USING ERRCODE = 'check_violation';
  END IF;
  IF prov IN ('STUDYUS_GENERATED', 'STUDYUS_AUTHORED') AND NEW.bank_lifecycle_status IN ('ACTIVE', 'CALIBRATED')
     AND (TG_OP = 'INSERT' OR OLD.bank_lifecycle_status IS DISTINCT FROM NEW.bank_lifecycle_status)
     AND NOT EXISTS (SELECT 1 FROM public.question_bank_reviews r WHERE r.approved_item_id = NEW.id AND r.decision = 'APPROVED')
     AND NOT public.question_bank_item_inherits_certification(NEW.bank_item_id, NEW.content) THEN
    RAISE EXCEPTION 'QUESTION_BANK_HUMAN_APPROVAL_REQUIRED: % version % needs an APPROVED review before %',
      CASE prov WHEN 'STUDYUS_AUTHORED' THEN 'authored' ELSE 'generated' END, NEW.id, NEW.bank_lifecycle_status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;


-- V5.2: the scope a consumer asks in. One authority (the view above), read in a scope; never a second rule ----------
CREATE OR REPLACE VIEW public.student_eligible_item_instances_pilot AS
SELECT * FROM public.student_eligible_item_instances WHERE 'PILOT_PREVIEW' = ANY (eligibility_scopes);
CREATE OR REPLACE VIEW public.student_eligible_item_instances_production AS
SELECT * FROM public.student_eligible_item_instances WHERE 'PRODUCTION' = ANY (eligibility_scopes);

-- POST-MIGRATION INVARIANT. Migration 88 defines student_eligible_item_instances in narrower terms; if it is ever
-- replayed after this file, that weaker view is left standing. This function says so: NULL = the strongest
-- definition is the one in force. Run it after every migration run; anything but NULL is a failed migration.
CREATE OR REPLACE FUNCTION public.assessment_supply_view_invariant() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN to_regclass('public.student_eligible_item_instances') IS NULL THEN 'STUDENT_ELIGIBILITY_VIEW_MISSING'
    WHEN position('assessment_item_instance_refusal' IN pg_get_viewdef('public.student_eligible_item_instances'::regclass)) = 0 THEN 'WEAKER_STUDENT_ELIGIBILITY_VIEW_IS_ACTIVE'
    WHEN position('QUARANTINED' IN pg_get_functiondef('public.assessment_item_instance_refusal(public.assessment_item_instances)'::regprocedure)) = 0 THEN 'ELIGIBILITY_FUNCTION_IS_NOT_THE_V52_ONE'
    ELSE NULL END
$$;

-- V5.2: coverage snapshots and the gaps they found ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.assessment_coverage_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_hash text NOT NULL REFERENCES public.assessment_certification_policies(policy_hash) ON DELETE RESTRICT,
  eligibility_scope text NOT NULL CHECK (eligibility_scope IN ('PILOT_PREVIEW', 'PRODUCTION')),
  -- raw variants, distinct wordings, recognition classes and capacity are four numbers; none stands in for another
  raw_variant_capacity integer NOT NULL CHECK (raw_variant_capacity >= 0),
  distinct_deliverable_variants integer NOT NULL CHECK (distinct_deliverable_variants >= 0),
  certified_delivery_capacity integer NOT NULL CHECK (certified_delivery_capacity >= 0),
  effective_repeatability_depth integer NOT NULL CHECK (effective_repeatability_depth >= 0),
  summary jsonb NOT NULL CHECK (jsonb_typeof(summary) = 'object'),
  taken_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assessment_coverage_snapshots_capacity_ck CHECK (certified_delivery_capacity <= distinct_deliverable_variants AND distinct_deliverable_variants <= raw_variant_capacity)
);
CREATE TABLE IF NOT EXISTS public.assessment_coverage_gaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES public.assessment_coverage_snapshots(id) ON DELETE CASCADE,
  -- exam demand only: a practice set or an internal assessment is not a demand on the Exam Bank
  demand_kind text NOT NULL CHECK (demand_kind IN ('EXAM_PRACTICE', 'REDUCED_MOCK', 'FULL_MOCK', 'CHALLENGE', 'EXAM_SIMULATION', 'BLUEPRINT_BUCKET')),
  system_id text REFERENCES public.assessment_systems(system_id) ON DELETE RESTRICT,
  blueprint_id text,
  bucket_id text,
  concept_id text,
  difficulty_band text NOT NULL CHECK (difficulty_band IN ('ANY', 'LOW', 'MEDIUM', 'HIGH')),
  required integer NOT NULL CHECK (required > 0),
  certified_capacity integer NOT NULL CHECK (certified_capacity >= 0),
  missing integer NOT NULL CHECK (missing > 0),
  blocking_reason text NOT NULL CHECK (length(btrim(blocking_reason)) > 0),
  -- how the gap is to be filled, in the permitted order; a provider only for what nothing else can supply
  fill text NOT NULL CHECK (fill IN ('RENDER_DETERMINISTIC_CAPACITY', 'RECOVER_EXISTING_INVENTORY', 'NEW_CORE_AND_RENDERER_NEEDED', 'PROVIDER_GENERATION_PROPOSAL')),
  CONSTRAINT assessment_coverage_gaps_missing_ck CHECK (missing = required - certified_capacity)
);
CREATE INDEX IF NOT EXISTS assessment_coverage_gaps_snapshot_idx ON public.assessment_coverage_gaps (snapshot_id, demand_kind);

-- V5.2: batch certification state, restartable from its checkpoints -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.assessment_certification_batches (
  batch_id text PRIMARY KEY CHECK (length(btrim(batch_id)) > 0),
  policy_hash text NOT NULL REFERENCES public.assessment_certification_policies(policy_hash) ON DELETE RESTRICT,
  -- the hash of everything a cell's result depends on: a checkpoint is reused only while it is unchanged
  inputs_hash text NOT NULL CHECK (inputs_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'COMPLETE', 'ABANDONED')),
  provider_calls integer NOT NULL DEFAULT 0 CHECK (provider_calls = 0),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.assessment_certification_batch_cells (
  batch_id text NOT NULL REFERENCES public.assessment_certification_batches(batch_id) ON DELETE CASCADE,
  cell_id text NOT NULL CHECK (length(btrim(cell_id)) > 0),
  status text NOT NULL CHECK (status IN ('PENDING', 'DONE')),
  attempted integer NOT NULL DEFAULT 0 CHECK (attempted >= 0),
  certified integer NOT NULL DEFAULT 0 CHECK (certified >= 0 AND certified <= attempted),
  checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(checkpoint) = 'object'),
  PRIMARY KEY (batch_id, cell_id)
);

-- V5.2: what a person found when auditing a sample. Recorded by people; the machine's decision is kept beside it -----
CREATE TABLE IF NOT EXISTS public.assessment_audit_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_instance_id uuid NOT NULL REFERENCES public.assessment_item_instances(id) ON DELETE RESTRICT,
  stream text NOT NULL CHECK (stream IN ('NEW_ENVELOPE_INITIAL_AUDIT', 'STABLE_ENVELOPE_RANDOM_SAMPLE', 'EXCEPTION_QUEUE', 'INCIDENT')),
  machine_decision text NOT NULL CHECK (machine_decision IN ('CERTIFIED', 'REVIEW_REQUIRED', 'REJECTED')),
  human_finding text NOT NULL CHECK (human_finding IN ('READY', 'DEFECT')),
  defect_severity text CHECK (defect_severity IN ('CRITICAL', 'MAJOR', 'MINOR')),
  reviewer_id text NOT NULL CHECK (length(btrim(reviewer_id)) > 0),
  notes text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assessment_audit_results_defect_ck CHECK ((human_finding = 'DEFECT') = (defect_severity IS NOT NULL))
);
