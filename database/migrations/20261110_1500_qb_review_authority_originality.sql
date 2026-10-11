-- B2-B1 / migration 6 of 8 -- reviewer qualifications, checklist identity, stimulus reviews, originality checks,
-- and the safeguards on an approving review. ADDITIVE in structure; it also TIGHTENS who may approve.
--
--   question_bank_reviewer_qualifications  who may approve content of which canonical subject for which
--                                          exam family, granted by whom, from when, until when / revoked.
--   question_bank_reviews                  + checklist_key, checklist_version, reviewer_qualification_id.
--   question_bank_stimulus_reviews         reviews of a stimulus version. A table of its own, so the item
--                                          review's NOT NULL columns and its existing guard stay as they are.
--   question_bank_originality_checks       the recorded result of an originality check. It records a
--                                          result; it is not a similarity engine.
--
-- BEHAVIOUR CHANGE (deliberate): from this migration on, an APPROVED review is refused unless
--   - the reviewer is not the author of the version, and
--   - the reviewer holds a qualification, valid at the time of the review, for the exam family of the item
--     and for the canonical subject of the item (its PRIMARY concept, or, for an item with no attribution,
--     a concept its objective is mapped to).
-- The matching qualification is stamped on the review. Non-approving decisions are not restricted.
-- Consequence for operators: approving anything in an environment now requires qualification rows there.
-- No qualification is created by this migration and none is invented for past reviews.
--
-- An authored item (STUDYUS_AUTHORED) needs an APPROVED review before it is ACTIVE or CALIBRATED, exactly
-- as a generated one already does. A stimulus version needs an approving stimulus review before ACTIVE.
--
-- Rollback (only while the new tables are empty): DROP the four triggers and their functions; restore
--   question_bank_quality_guard() from 20261026_1000 / its latest definition; DROP TABLE
--   public.question_bank_originality_checks, public.question_bank_stimulus_reviews;
--   ALTER TABLE public.question_bank_reviews DROP COLUMN reviewer_qualification_id, DROP COLUMN checklist_version, DROP COLUMN checklist_key;
--   DROP TABLE public.question_bank_reviewer_qualifications; DELETE FROM schema_migrations WHERE version = '20261110_1500';

CREATE TABLE public.question_bank_reviewer_qualifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id),
  canonical_subject_id uuid NOT NULL REFERENCES public.canonical_subjects(id),
  exam_family text NOT NULL CHECK (length(btrim(exam_family)) > 0),
  granted_by uuid NOT NULL REFERENCES public.users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES public.users(id),
  revoke_reason text,
  notes text,
  CONSTRAINT question_bank_reviewer_qualifications_not_self_granted CHECK (granted_by <> user_id),
  CONSTRAINT question_bank_reviewer_qualifications_validity CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT question_bank_reviewer_qualifications_revocation CHECK (
    (revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL)
    OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND length(btrim(coalesce(revoke_reason, ''))) > 0))
);
CREATE INDEX question_bank_reviewer_qualifications_lookup ON public.question_bank_reviewer_qualifications (user_id, exam_family, canonical_subject_id);
CREATE UNIQUE INDEX question_bank_reviewer_qualifications_open ON public.question_bank_reviewer_qualifications (user_id, canonical_subject_id, exam_family)
  WHERE revoked_at IS NULL AND valid_to IS NULL;

-- A qualification is granted to a person, and afterwards can only be ended.
CREATE FUNCTION public.question_bank_reviewer_qualification_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'QUESTION_BANK_QUALIFICATION_NO_DELETE: revoke qualification % instead', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF EXISTS (SELECT 1 FROM public.users u WHERE u.id = NEW.user_id AND u.is_system) THEN
      RAISE EXCEPTION 'QUESTION_BANK_QUALIFICATION_NEEDS_PERSON: a system account cannot be a qualified reviewer' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - 'valid_to' - 'revoked_at' - 'revoked_by' - 'revoke_reason' - 'notes')
       IS DISTINCT FROM (to_jsonb(OLD) - 'valid_to' - 'revoked_at' - 'revoked_by' - 'revoke_reason' - 'notes')
     OR OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'QUESTION_BANK_QUALIFICATION_IMMUTABLE: qualification % can only be ended or revoked', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_question_bank_reviewer_qualification_guard BEFORE INSERT OR UPDATE OR DELETE ON public.question_bank_reviewer_qualifications
  FOR EACH ROW EXECUTE FUNCTION public.question_bank_reviewer_qualification_guard();

CREATE FUNCTION public.question_bank_qualification_valid(p_qualification uuid, p_user uuid, p_at timestamptz) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.question_bank_reviewer_qualifications q
                  WHERE q.id = p_qualification AND q.user_id = p_user AND q.valid_from <= p_at
                    AND (q.valid_to IS NULL OR q.valid_to > p_at) AND (q.revoked_at IS NULL OR q.revoked_at > p_at));
$$;

-- Item reviews ----------------------------------------------------------------------------------------------
ALTER TABLE public.question_bank_reviews ADD COLUMN checklist_key text;
ALTER TABLE public.question_bank_reviews ADD COLUMN checklist_version text;
ALTER TABLE public.question_bank_reviews ADD COLUMN reviewer_qualification_id uuid REFERENCES public.question_bank_reviewer_qualifications(id);
ALTER TABLE public.question_bank_reviews ADD CONSTRAINT question_bank_reviews_checklist_identity
  CHECK ((checklist_key IS NULL) = (checklist_version IS NULL));

CREATE FUNCTION public.question_bank_review_authority_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  author uuid;
  objective uuid;
  family text;
  subjects uuid[];
  qualification uuid;
BEGIN
  IF NEW.decision <> 'APPROVED' THEN
    RETURN NEW;
  END IF;
  SELECT ai.created_by, ai.learning_objective_id INTO author, objective FROM public.approved_items ai WHERE ai.id = NEW.approved_item_id;
  IF author = NEW.reviewed_by THEN
    RAISE EXCEPTION 'QUESTION_BANK_REVIEW_AUTHOR_CANNOT_APPROVE: version %', NEW.approved_item_id USING ERRCODE = 'check_violation';
  END IF;
  SELECT ed.exam_family INTO family
    FROM public.question_bank_items qi JOIN public.exam_versions ev ON ev.id = qi.exam_version_id JOIN public.exam_definitions ed ON ed.id = ev.exam_definition_id
   WHERE qi.id = NEW.bank_item_id;
  SELECT array_agg(DISTINCT cc.canonical_subject_id) INTO subjects
    FROM public.question_bank_item_concepts ic JOIN public.canonical_concepts cc ON cc.id = ic.canonical_concept_id
   WHERE ic.approved_item_id = NEW.approved_item_id AND ic.role = 'PRIMARY';
  IF subjects IS NULL THEN
    SELECT array_agg(DISTINCT cc.canonical_subject_id) INTO subjects
      FROM public.objective_concept_mappings m JOIN public.canonical_concepts cc ON cc.id = m.canonical_concept_id
     WHERE m.learning_objective_id = objective AND m.status = 'PUBLISHED';
  END IF;
  IF family IS NULL OR subjects IS NULL THEN
    RAISE EXCEPTION 'QUESTION_BANK_REVIEW_SCOPE_UNDETERMINED: version % has no exam family or no canonical subject; it cannot be approved', NEW.approved_item_id USING ERRCODE = 'check_violation';
  END IF;
  SELECT q.id INTO qualification FROM public.question_bank_reviewer_qualifications q
   WHERE q.user_id = NEW.reviewed_by AND q.exam_family = family AND q.canonical_subject_id = ANY (subjects)
     AND (NEW.reviewer_qualification_id IS NULL OR q.id = NEW.reviewer_qualification_id)
     AND public.question_bank_qualification_valid(q.id, NEW.reviewed_by, NEW.reviewed_at)
   ORDER BY q.valid_from, q.id LIMIT 1;
  IF qualification IS NULL THEN
    RAISE EXCEPTION 'QUESTION_BANK_REVIEWER_NOT_QUALIFIED: reviewer % holds no valid qualification for exam family % and the subject of version %', NEW.reviewed_by, family, NEW.approved_item_id USING ERRCODE = 'check_violation';
  END IF;
  NEW.reviewer_qualification_id := qualification;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_question_bank_review_authority_guard BEFORE INSERT OR UPDATE ON public.question_bank_reviews
  FOR EACH ROW EXECUTE FUNCTION public.question_bank_review_authority_guard();

-- Stimulus reviews ------------------------------------------------------------------------------------------
CREATE TABLE public.question_bank_stimulus_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stimulus_version_id uuid NOT NULL REFERENCES public.question_bank_stimulus_versions(id),
  decision text NOT NULL CHECK (decision IN ('APPROVED', 'CORRECTION_REQUESTED', 'REJECTED')),
  reviewed_by uuid NOT NULL REFERENCES public.users(id),
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  review_notes text,
  checklist_key text,
  checklist_version text,
  review_checklist jsonb CHECK (review_checklist IS NULL OR jsonb_typeof(review_checklist) = 'object'),
  reviewer_qualification_id uuid REFERENCES public.question_bank_reviewer_qualifications(id),
  CONSTRAINT question_bank_stimulus_reviews_checklist_identity CHECK ((checklist_key IS NULL) = (checklist_version IS NULL)),
  CONSTRAINT question_bank_stimulus_reviews_notes_for_non_approval CHECK (decision = 'APPROVED' OR (review_notes IS NOT NULL AND length(btrim(review_notes)) >= 5))
);
CREATE INDEX question_bank_stimulus_reviews_version ON public.question_bank_stimulus_reviews (stimulus_version_id);

-- A stimulus is not tied to one exam, so the review names the qualification it is made under; that
-- qualification must be the reviewer's and valid at the time.
CREATE FUNCTION public.question_bank_stimulus_review_authority_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  author uuid;
  st text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'QUESTION_BANK_STIMULUS_REVIEW_NO_DELETE' USING ERRCODE = 'check_violation';
  END IF;
  SELECT created_by, lifecycle_status INTO author, st FROM public.question_bank_stimulus_versions WHERE id = NEW.stimulus_version_id;
  IF st = 'DRAFT' THEN
    RAISE EXCEPTION 'QUESTION_BANK_STIMULUS_REVIEW_NEEDS_FROZEN_VERSION: version % is still a draft', NEW.stimulus_version_id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.decision <> 'APPROVED' THEN
    RETURN NEW;
  END IF;
  IF author = NEW.reviewed_by THEN
    RAISE EXCEPTION 'QUESTION_BANK_REVIEW_AUTHOR_CANNOT_APPROVE: stimulus version %', NEW.stimulus_version_id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.reviewer_qualification_id IS NULL OR NOT public.question_bank_qualification_valid(NEW.reviewer_qualification_id, NEW.reviewed_by, NEW.reviewed_at) THEN
    RAISE EXCEPTION 'QUESTION_BANK_REVIEWER_NOT_QUALIFIED: reviewer % named no valid qualification for stimulus version %', NEW.reviewed_by, NEW.stimulus_version_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_question_bank_stimulus_review_authority_guard BEFORE INSERT OR UPDATE OR DELETE ON public.question_bank_stimulus_reviews
  FOR EACH ROW EXECUTE FUNCTION public.question_bank_stimulus_review_authority_guard();

CREATE FUNCTION public.question_bank_stimulus_activation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.question_bank_stimulus_reviews r WHERE r.stimulus_version_id = NEW.id AND r.decision = 'APPROVED') THEN
    RAISE EXCEPTION 'QUESTION_BANK_HUMAN_APPROVAL_REQUIRED: stimulus version % needs an APPROVED review before ACTIVE', NEW.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_question_bank_stimulus_activation_guard BEFORE UPDATE ON public.question_bank_stimulus_versions
  FOR EACH ROW WHEN (NEW.lifecycle_status = 'ACTIVE' AND OLD.lifecycle_status IS DISTINCT FROM NEW.lifecycle_status)
  EXECUTE FUNCTION public.question_bank_stimulus_activation_guard();

-- Authored items are reviewed before use, like generated ones ------------------------------------------------
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
     AND NOT EXISTS (SELECT 1 FROM public.question_bank_reviews r WHERE r.approved_item_id = NEW.id AND r.decision = 'APPROVED') THEN
    RAISE EXCEPTION 'QUESTION_BANK_HUMAN_APPROVAL_REQUIRED: % version % needs an APPROVED review before %',
      CASE prov WHEN 'STUDYUS_AUTHORED' THEN 'authored' ELSE 'generated' END, NEW.id, NEW.bank_lifecycle_status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- Originality checks ------------------------------------------------------------------------------------------
CREATE TABLE public.question_bank_originality_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_type text NOT NULL CHECK (content_type IN ('ITEM_VERSION', 'STIMULUS_VERSION')),
  content_id uuid NOT NULL,
  method text NOT NULL CHECK (length(btrim(method)) > 0),
  method_version text NOT NULL CHECK (length(btrim(method_version)) > 0),
  -- Source keys and corpora the content was compared against.
  compared_against text[] NOT NULL DEFAULT '{}',
  result text NOT NULL CHECK (result IN ('CLEAR', 'SIMILAR', 'MATCH', 'INCONCLUSIVE')),
  max_similarity numeric CHECK (max_similarity IS NULL OR (max_similarity >= 0 AND max_similarity <= 1)),
  performed_by_kind text NOT NULL CHECK (performed_by_kind IN ('SYSTEM', 'HUMAN')),
  performed_by uuid NOT NULL REFERENCES public.users(id),
  performed_at timestamptz NOT NULL DEFAULT now(),
  disposition text NOT NULL CHECK (disposition IN ('ACCEPTED', 'REWRITE_REQUIRED', 'REJECTED')),
  notes text,
  -- Content that matches a source is never accepted as original.
  CONSTRAINT question_bank_originality_checks_match_not_accepted CHECK (result <> 'MATCH' OR disposition <> 'ACCEPTED')
);
CREATE INDEX question_bank_originality_checks_content ON public.question_bank_originality_checks (content_type, content_id, performed_at);

CREATE FUNCTION public.question_bank_originality_check_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'QUESTION_BANK_ORIGINALITY_APPEND_ONLY: record a new check instead' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT public.question_bank_content_exists(NEW.content_type, NEW.content_id) THEN
    RAISE EXCEPTION 'QUESTION_BANK_ORIGINALITY_CONTENT_NOT_FOUND: % %', NEW.content_type, NEW.content_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_question_bank_originality_check_guard BEFORE INSERT OR UPDATE OR DELETE ON public.question_bank_originality_checks
  FOR EACH ROW EXECUTE FUNCTION public.question_bank_originality_check_guard();
