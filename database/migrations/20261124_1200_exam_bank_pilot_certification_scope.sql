-- TRACK B -- PAA pilot: the automated pilot certification is tightened to its exact governed context (fail closed).
-- ORDER. Follows 20261124_1100. ADDITIVE: one single-row table, two functions replaced, one view replaced. No
-- certification, review or bank row is changed.
--
-- Audit of 20261124_1000 / _1100 (2026-10-13). The path already required, by constraint: system PAA, rights
-- STUDYUS_ORIGINAL_GENERATED, scope PILOT_PREVIEW only, state AUTOMATED_CERTIFIED_PILOT only, a policy decider, a
-- PILOT_CERTIFIED + STUDYUS_GENERATED bank item, the exact content hash, no revocation. Four things were BROADER
-- than intended, and are closed here:
--   1. POLICY. Any policy granting PILOT_PREVIEW was accepted (HUMAN50_POLICY_V1 grants it too). Now the policy must
--      be PAA_PILOT_CERT_POLICY, and the decider must be that policy at that version.
--   2. VALIDATORS. "Evidence" only had to be a non-empty array. Now every rule the policy states must appear in the
--      evidence as PASSED, and no evidence entry may be a failure.
--   3. LINEAGE. Only the generation service and the candidate digest were required. Now provider, model, prompt id
--      and version, execution id and generation time are required too.
--   4. ENVIRONMENT. Nothing in the database said "this database is a pilot". A database must now DECLARE itself a
--      pilot environment (one row of exam_bank_pilot_environment). Without that declaration no pilot certification
--      can be inserted, none counts, no PILOT_CERTIFIED version can be activated and the delivery view is empty. A
--      Production database carries no such row; the publication tooling refuses to declare one outside its
--      authorised pilot databases.
-- The activation rule of 20261124_1100 calls exam_bank_pilot_version_certified, so it inherits all four.
--
-- Rollback: re-create the two functions and the view from 20261124_1000; DROP TABLE exam_bank_pilot_environment.

CREATE TABLE public.exam_bank_pilot_environment (
  -- one row at most
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  scope text NOT NULL CHECK (scope = 'PILOT_PREVIEW'),
  database_fingerprint text NOT NULL CHECK (database_fingerprint ~ '^[a-f0-9]{16}$'),
  declared_by text NOT NULL CHECK (length(btrim(declared_by)) > 0),
  basis text NOT NULL CHECK (length(btrim(basis)) >= 10),
  declared_at timestamptz NOT NULL DEFAULT now()
);

-- Does this certification row state EVERYTHING the pilot policy requires? One place, used by the insert guard, by
-- the activation rule and by the delivery view.
CREATE FUNCTION public.exam_bank_pilot_certification_in_scope(c public.exam_bank_pilot_item_certifications) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT
    -- this database declared itself a pilot environment
    EXISTS (SELECT 1 FROM public.exam_bank_pilot_environment e WHERE e.scope = 'PILOT_PREVIEW')
    AND c.system_id = 'PAA' AND c.certification_state = 'AUTOMATED_CERTIFIED_PILOT' AND c.eligibility_scopes = ARRAY['PILOT_PREVIEW']
    AND c.rights_category = 'STUDYUS_ORIGINAL_GENERATED' AND c.revoked_at IS NULL
    -- the policy is THE PAA pilot policy, it grants the pilot scope and only that, and it is the decider
    AND EXISTS (SELECT 1 FROM public.assessment_certification_policies p
                 WHERE p.policy_hash = c.policy_hash AND p.policy_id = 'PAA_PILOT_CERT_POLICY' AND p.may_grant_scopes = ARRAY['PILOT_PREVIEW']
                   AND c.decided_by = 'policy:' || p.policy_id || '_' || p.version
                   -- every rule the policy states is in the evidence, passed
                   AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p.policy->'rules') r
                                    WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(c.evidence) g WHERE g->>'code' = r->>'code' AND g->>'passed' = 'true')))
    -- and nothing in the evidence is a failure
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(c.evidence) g WHERE g->>'passed' IS DISTINCT FROM 'true')
    -- complete generation lineage
    AND length(coalesce(c.lineage->>'generationService', '')) > 0 AND length(coalesce(c.lineage->>'provider', '')) > 0 AND length(coalesce(c.lineage->>'model', '')) > 0
    AND length(coalesce(c.lineage->>'promptId', '')) > 0 AND length(coalesce(c.lineage->>'promptVersion', '')) > 0 AND length(coalesce(c.lineage->>'executionId', '')) > 0
    AND length(coalesce(c.lineage->>'generatedAt', '')) > 0 AND length(coalesce(c.lineage->>'candidateDigest', '')) > 0
$$;

CREATE OR REPLACE FUNCTION public.exam_bank_pilot_version_certified(p_bank_item_id uuid, p_version_id uuid, p_content_hash text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.exam_bank_pilot_item_certifications c
      JOIN public.question_bank_items qi ON qi.id = c.bank_item_id
      JOIN public.exam_versions v ON v.id = qi.exam_version_id
      JOIN public.exam_definitions d ON d.id = v.exam_definition_id
     WHERE c.approved_item_id = p_version_id AND c.bank_item_id = p_bank_item_id AND c.content_hash = p_content_hash
       AND qi.lineage_class = 'PILOT_CERTIFIED' AND qi.provenance = 'STUDYUS_GENERATED'
       -- the bank item belongs to a PAA exam: a certification row cannot lend its system to another exam's item
       AND d.exam_family = 'PAA'
       AND public.exam_bank_pilot_certification_in_scope(c))
$$;

CREATE OR REPLACE FUNCTION public.exam_bank_pilot_item_certification_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  prov text;
  lineage text;
  held_hash text;
  held_item uuid;
  family text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'EXAM_BANK_PILOT_CERTIFICATION_NO_DELETE: revoke certification % instead', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL
       OR (to_jsonb(NEW) - 'revoked_at' - 'revoke_reason') IS DISTINCT FROM (to_jsonb(OLD) - 'revoked_at' - 'revoke_reason') THEN
      RAISE EXCEPTION 'EXAM_BANK_PILOT_CERTIFICATION_IMMUTABLE: certification % can only be revoked', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.exam_bank_pilot_environment e WHERE e.scope = 'PILOT_PREVIEW') THEN
    RAISE EXCEPTION 'EXAM_BANK_PILOT_ENVIRONMENT_NOT_DECLARED: this database is not a declared pilot environment; no pilot certification is accepted' USING ERRCODE = 'check_violation';
  END IF;
  SELECT qi.provenance, qi.lineage_class, d.exam_family INTO prov, lineage, family
    FROM public.question_bank_items qi LEFT JOIN public.exam_versions v ON v.id = qi.exam_version_id LEFT JOIN public.exam_definitions d ON d.id = v.exam_definition_id
   WHERE qi.id = NEW.bank_item_id;
  IF lineage IS DISTINCT FROM 'PILOT_CERTIFIED' OR prov IS DISTINCT FROM 'STUDYUS_GENERATED' OR family IS DISTINCT FROM 'PAA' THEN
    RAISE EXCEPTION 'EXAM_BANK_PILOT_CERTIFICATION_SCOPE: bank item % is %/% of family % -- only a PILOT_CERTIFIED, STUDYUS_GENERATED item of a PAA exam is certified here', NEW.bank_item_id, lineage, prov, family USING ERRCODE = 'check_violation';
  END IF;
  SELECT ai.content_hash, ai.bank_item_id INTO held_hash, held_item FROM public.approved_items ai WHERE ai.id = NEW.approved_item_id;
  IF held_item IS DISTINCT FROM NEW.bank_item_id OR held_hash IS DISTINCT FROM NEW.content_hash THEN
    RAISE EXCEPTION 'EXAM_BANK_PILOT_CERTIFICATION_IS_NOT_OF_THIS_CONTENT: version %', NEW.approved_item_id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'EXAM_BANK_PILOT_CERTIFICATION_STARTS_VALID' USING ERRCODE = 'check_violation';
  END IF;
  -- the policy, its decider, every rule passed, complete lineage: all or nothing
  IF NOT public.exam_bank_pilot_certification_in_scope(NEW) THEN
    RAISE EXCEPTION 'EXAM_BANK_PILOT_CERTIFICATION_OUT_OF_SCOPE: version % -- the policy must be PAA_PILOT_CERT_POLICY and be the decider, every policy rule must be in the evidence as passed, and the generation lineage must be complete', NEW.approved_item_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE VIEW public.exam_bank_pilot_deliverable_versions AS
  SELECT ai.id AS approved_item_id, qi.id AS bank_item_id, c.id AS certification_id, c.component_key, c.blueprint_bucket, c.stimulus_id, c.stimulus_version
    FROM public.question_bank_items qi
    JOIN public.approved_items ai ON ai.id = qi.current_version_id
    JOIN public.exam_bank_pilot_item_certifications c ON c.approved_item_id = ai.id AND c.bank_item_id = qi.id AND c.content_hash = ai.content_hash
   WHERE qi.retired_at IS NULL AND ai.status = 'PUBLISHED' AND ai.bank_lifecycle_status = 'ACTIVE'
     AND public.exam_bank_pilot_version_certified(qi.id, ai.id, ai.content_hash);
