-- TRACK B -- PAA pilot: a narrowly scoped, AUTOMATED certification path for StudyUs-original GENERATED Exam Bank
-- content (selected response, with or without a stimulus).
-- ORDER. Follows 20261123_1000 (it replaces question_bank_quality_guard as 20261122_1200 left it, and reads
-- question_bank_items.lineage_class from 20261121_1100 and assessment_certification_policies from 20261122_1200).
-- ADDITIVE. Two tables, one view, three functions; one CHECK is widened; one function is replaced. No existing row
-- is changed. Every existing human certification, human review and core-derived certification is untouched.
--
-- Why. A generated item reaches a Student only after an APPROVED human review (20261110_1500). The pilot has no
-- reviewer for Reading / Writing / English, and a review must never be fabricated. This file adds ONE further,
-- narrower way: a version of a PILOT_CERTIFIED bank item may become ACTIVE when an AUTOMATED certification of
-- exactly that content exists under a policy that grants PILOT_PREVIEW. The decision is the policy's
-- (decided_by = 'policy:...'): no person is named and no row of question_bank_reviews is written.
--
-- Scope, enforced here and not only in code:
--   system         PAA only
--   rights         STUDYUS_ORIGINAL_GENERATED only
--   scopes         PILOT_PREVIEW only (never PRODUCTION)
--   state          AUTOMATED_CERTIFIED_PILOT only (REVIEW_REQUIRED / REJECTED content is never written here)
--   provenance     the bank item is STUDYUS_GENERATED and keeps its generation lineage
-- A certification is immutable; it can only be revoked, and a revoked one delivers nothing.
--
-- Delivery reads public.exam_bank_pilot_deliverable_versions, and only a deployment whose scope is PILOT_PREVIEW
-- reads it (src/lib/exam-bank/delivery-scope.ts). In any other scope a PILOT_CERTIFIED version is not deliverable.
--
-- Rollback: DROP VIEW exam_bank_pilot_deliverable_versions; re-create question_bank_quality_guard from 20261122_1200;
-- DROP TABLE exam_bank_pilot_item_certifications, exam_bank_pilot_stimuli; restore the lineage CHECK to
-- ('LEGACY', 'CORE_DERIVED') after retiring any PILOT_CERTIFIED item.

ALTER TABLE public.question_bank_items DROP CONSTRAINT IF EXISTS question_bank_items_lineage_ck;
ALTER TABLE public.question_bank_items
  ADD CONSTRAINT question_bank_items_lineage_ck CHECK (lineage_class IN ('LEGACY', 'CORE_DERIVED', 'PILOT_CERTIFIED') AND (lineage_class = 'CORE_DERIVED') = (item_instance_id IS NOT NULL));

-- A certified stimulus: identity + version + the digest of what the learner reads. Immutable --------------------
CREATE TABLE public.exam_bank_pilot_stimuli (
  stimulus_id text NOT NULL CHECK (stimulus_id ~ '^stim\.[a-z0-9]+([.-][a-z0-9]+)*$'),
  version integer NOT NULL CHECK (version > 0),
  content_digest text NOT NULL UNIQUE CHECK (content_digest ~ '^[a-f0-9]{64}$'),
  kind text NOT NULL CHECK (kind IN ('READING_PASSAGE', 'SHORT_SOURCE_TEXT', 'SCENARIO', 'DATA_TABLE')),
  language text NOT NULL CHECK (length(btrim(language)) >= 2),
  system_id text NOT NULL CHECK (system_id = 'PAA'),
  component_key text NOT NULL CHECK (length(btrim(component_key)) > 0),
  blueprint_bucket_ids text[] NOT NULL CHECK (cardinality(blueprint_bucket_ids) > 0),
  linked_item_keys text[] NOT NULL CHECK (cardinality(linked_item_keys) > 0),
  content jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  rights_category text NOT NULL CHECK (rights_category = 'STUDYUS_ORIGINAL_GENERATED'),
  rights_basis text NOT NULL CHECK (length(btrim(rights_basis)) >= 10),
  originality jsonb NOT NULL CHECK (originality->>'status' = 'CHECKED_ORIGINAL'),
  lineage jsonb NOT NULL CHECK (jsonb_typeof(lineage) = 'object' AND length(coalesce(lineage->>'generationService', '')) > 0),
  policy_hash text NOT NULL REFERENCES public.assessment_certification_policies(policy_hash),
  certification_state text NOT NULL CHECK (certification_state = 'AUTOMATED_CERTIFIED_PILOT'),
  eligibility_scopes text[] NOT NULL CHECK (eligibility_scopes = ARRAY['PILOT_PREVIEW']),
  evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence) = 'array' AND jsonb_array_length(evidence) > 0),
  -- an automated decision is the policy's: never a person's
  decided_by text NOT NULL CHECK (decided_by ~ '^policy:[A-Z0-9_]+$'),
  decided_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (stimulus_id, version)
);

-- The automated certification of ONE bank version, at exactly its content ---------------------------------------
CREATE TABLE public.exam_bank_pilot_item_certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approved_item_id uuid NOT NULL UNIQUE REFERENCES public.approved_items(id),
  bank_item_id uuid NOT NULL REFERENCES public.question_bank_items(id),
  content_hash text NOT NULL CHECK (length(content_hash) > 0),
  item_digest text NOT NULL CHECK (item_digest ~ '^[a-f0-9]{64}$'),
  system_id text NOT NULL CHECK (system_id = 'PAA'),
  component_key text NOT NULL CHECK (length(btrim(component_key)) > 0),
  blueprint_bucket text NOT NULL CHECK (length(btrim(blueprint_bucket)) > 0),
  stimulus_id text,
  stimulus_version integer,
  policy_hash text NOT NULL REFERENCES public.assessment_certification_policies(policy_hash),
  certification_state text NOT NULL CHECK (certification_state = 'AUTOMATED_CERTIFIED_PILOT'),
  eligibility_scopes text[] NOT NULL CHECK (eligibility_scopes = ARRAY['PILOT_PREVIEW']),
  rights_category text NOT NULL CHECK (rights_category = 'STUDYUS_ORIGINAL_GENERATED'),
  evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence) = 'array' AND jsonb_array_length(evidence) > 0),
  lineage jsonb NOT NULL CHECK (jsonb_typeof(lineage) = 'object' AND length(coalesce(lineage->>'generationService', '')) > 0 AND length(coalesce(lineage->>'candidateDigest', '')) > 0),
  decided_by text NOT NULL CHECK (decided_by ~ '^policy:[A-Z0-9_]+$'),
  decided_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoke_reason text,
  CONSTRAINT exam_bank_pilot_item_certifications_revocation CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL)),
  CONSTRAINT exam_bank_pilot_item_certifications_stimulus CHECK ((stimulus_id IS NULL) = (stimulus_version IS NULL)),
  FOREIGN KEY (stimulus_id, stimulus_version) REFERENCES public.exam_bank_pilot_stimuli(stimulus_id, version)
);
CREATE INDEX exam_bank_pilot_item_certifications_bank_item ON public.exam_bank_pilot_item_certifications (bank_item_id);

CREATE FUNCTION public.exam_bank_pilot_stimulus_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM public.assessment_certification_policies p WHERE p.policy_hash = NEW.policy_hash AND 'PILOT_PREVIEW' = ANY(p.may_grant_scopes)) THEN
      RAISE EXCEPTION 'EXAM_BANK_PILOT_POLICY_DOES_NOT_GRANT_PILOT_PREVIEW: stimulus %', NEW.stimulus_id USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'EXAM_BANK_PILOT_STIMULUS_IMMUTABLE: % v%; certify a new version instead', OLD.stimulus_id, OLD.version USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER trg_exam_bank_pilot_stimulus_guard BEFORE INSERT OR UPDATE OR DELETE ON public.exam_bank_pilot_stimuli
  FOR EACH ROW EXECUTE FUNCTION public.exam_bank_pilot_stimulus_guard();

CREATE FUNCTION public.exam_bank_pilot_item_certification_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  prov text;
  lineage text;
  held_hash text;
  held_item uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'EXAM_BANK_PILOT_CERTIFICATION_NO_DELETE: revoke certification % instead', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    -- the only change a certification admits: being revoked, once
    IF OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL
       OR (to_jsonb(NEW) - 'revoked_at' - 'revoke_reason') IS DISTINCT FROM (to_jsonb(OLD) - 'revoked_at' - 'revoke_reason') THEN
      RAISE EXCEPTION 'EXAM_BANK_PILOT_CERTIFICATION_IMMUTABLE: certification % can only be revoked', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  SELECT qi.provenance, qi.lineage_class INTO prov, lineage FROM public.question_bank_items qi WHERE qi.id = NEW.bank_item_id;
  IF lineage IS DISTINCT FROM 'PILOT_CERTIFIED' OR prov IS DISTINCT FROM 'STUDYUS_GENERATED' THEN
    RAISE EXCEPTION 'EXAM_BANK_PILOT_CERTIFICATION_SCOPE: bank item % is %/% -- only a PILOT_CERTIFIED, STUDYUS_GENERATED item is certified here', NEW.bank_item_id, lineage, prov USING ERRCODE = 'check_violation';
  END IF;
  SELECT ai.content_hash, ai.bank_item_id INTO held_hash, held_item FROM public.approved_items ai WHERE ai.id = NEW.approved_item_id;
  IF held_item IS DISTINCT FROM NEW.bank_item_id OR held_hash IS DISTINCT FROM NEW.content_hash THEN
    RAISE EXCEPTION 'EXAM_BANK_PILOT_CERTIFICATION_IS_NOT_OF_THIS_CONTENT: version %', NEW.approved_item_id USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.assessment_certification_policies p WHERE p.policy_hash = NEW.policy_hash AND 'PILOT_PREVIEW' = ANY(p.may_grant_scopes)) THEN
    RAISE EXCEPTION 'EXAM_BANK_PILOT_POLICY_DOES_NOT_GRANT_PILOT_PREVIEW: version %', NEW.approved_item_id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'EXAM_BANK_PILOT_CERTIFICATION_STARTS_VALID' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_exam_bank_pilot_item_certification_guard BEFORE INSERT OR UPDATE OR DELETE ON public.exam_bank_pilot_item_certifications
  FOR EACH ROW EXECUTE FUNCTION public.exam_bank_pilot_item_certification_guard();

-- Is this version, at this content, certified NOW under the pilot policy? An edited copy inherits nothing.
CREATE FUNCTION public.exam_bank_pilot_version_certified(p_bank_item_id uuid, p_version_id uuid, p_content_hash text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.exam_bank_pilot_item_certifications c
      JOIN public.question_bank_items qi ON qi.id = c.bank_item_id
     WHERE c.approved_item_id = p_version_id AND c.bank_item_id = p_bank_item_id AND c.content_hash = p_content_hash AND c.revoked_at IS NULL
       AND qi.lineage_class = 'PILOT_CERTIFIED' AND qi.provenance = 'STUDYUS_GENERATED')
$$;

-- What a PILOT_PREVIEW deployment may deliver of this supply: current, not retired, certified at its content.
CREATE VIEW public.exam_bank_pilot_deliverable_versions AS
  SELECT ai.id AS approved_item_id, qi.id AS bank_item_id, c.id AS certification_id, c.component_key, c.blueprint_bucket, c.stimulus_id, c.stimulus_version
    FROM public.question_bank_items qi
    JOIN public.approved_items ai ON ai.id = qi.current_version_id
    JOIN public.exam_bank_pilot_item_certifications c ON c.approved_item_id = ai.id AND c.bank_item_id = qi.id AND c.content_hash = ai.content_hash AND c.revoked_at IS NULL
   WHERE qi.lineage_class = 'PILOT_CERTIFIED' AND qi.provenance = 'STUDYUS_GENERATED' AND qi.retired_at IS NULL;

-- The per-item review rule is KEPT for every other item; one further, narrower way is added beside the
-- core-derived one: a PILOT_CERTIFIED version certified at exactly its content.
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
     AND NOT public.question_bank_item_inherits_certification(NEW.bank_item_id, NEW.content)
     AND NOT public.exam_bank_pilot_version_certified(NEW.bank_item_id, NEW.id, NEW.content_hash) THEN
    RAISE EXCEPTION 'QUESTION_BANK_HUMAN_APPROVAL_REQUIRED: % version % needs an APPROVED review before %',
      CASE prov WHEN 'STUDYUS_AUTHORED' THEN 'authored' ELSE 'generated' END, NEW.id, NEW.bank_lifecycle_status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
