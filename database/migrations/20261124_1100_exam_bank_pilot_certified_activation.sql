-- TRACK B -- PAA pilot: a certified pilot version may be activated without the field-pilot stage.
-- ORDER. Follows 20261124_1000 (it reads public.exam_bank_pilot_version_certified).
-- ADDITIVE. One function is replaced (question_bank_version_guard, as 20261026_1000 left it); nothing else changes.
--
-- Why. "AI-generated content always pilots before it is active" (20261026_1000): a generated version goes
-- VALIDATED -> PILOT -> ACTIVE, the PILOT stage being where field evidence is collected before a Student-facing use.
-- A PILOT_CERTIFIED version is delivered ONLY in the PILOT_PREVIEW scope (20261124_1000): that deployment IS the
-- pilot. Its certification is recorded, of exactly its content, by policy. The rule is therefore stated here, in the
-- guard, instead of being walked around by passing through PILOT for an instant:
--   generated, NOT certified under the pilot policy  -> must pilot before ACTIVE, exactly as before
--   generated, certified under the pilot policy      -> VALIDATED -> ACTIVE is allowed
-- Everything else in the guard (immutability of a version, the transition table) is unchanged.
--
-- Rollback: re-create the function from 20261026_1000.
CREATE OR REPLACE FUNCTION public.question_bank_version_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  prov text;
BEGIN
  -- An item version is immutable: a correction is a NEW version, never a rewrite of what an attempt saw.
  IF OLD.content IS DISTINCT FROM NEW.content OR OLD.learning_objective_id IS DISTINCT FROM NEW.learning_objective_id
     OR OLD.question_type IS DISTINCT FROM NEW.question_type OR OLD.bank_item_id IS DISTINCT FROM NEW.bank_item_id
     OR OLD.version_number IS DISTINCT FROM NEW.version_number OR OLD.content_hash IS DISTINCT FROM NEW.content_hash THEN
    RAISE EXCEPTION 'QUESTION_BANK_VERSION_IMMUTABLE: approved item % is a bank version; create a new version instead', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF NOT public.question_bank_transition_allowed(OLD.bank_lifecycle_status, NEW.bank_lifecycle_status) THEN
    RAISE EXCEPTION 'QUESTION_BANK_INVALID_TRANSITION: % -> %', OLD.bank_lifecycle_status, NEW.bank_lifecycle_status USING ERRCODE = 'check_violation';
  END IF;
  -- AI-generated content always pilots before it is active -- unless it is certified under the pilot policy, whose
  -- only delivery scope is the pilot itself.
  IF OLD.bank_lifecycle_status = 'VALIDATED' AND NEW.bank_lifecycle_status = 'ACTIVE' THEN
    SELECT provenance INTO prov FROM public.question_bank_items WHERE id = OLD.bank_item_id;
    IF prov = 'STUDYUS_GENERATED' AND NOT public.exam_bank_pilot_version_certified(OLD.bank_item_id, OLD.id, OLD.content_hash) THEN
      RAISE EXCEPTION 'QUESTION_BANK_PILOT_REQUIRED: generated item % must pilot before ACTIVE', OLD.id USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF OLD.bank_lifecycle_status IS DISTINCT FROM NEW.bank_lifecycle_status THEN
    NEW.lifecycle_updated_at := now();
  END IF;
  RETURN NEW;
END $$;
