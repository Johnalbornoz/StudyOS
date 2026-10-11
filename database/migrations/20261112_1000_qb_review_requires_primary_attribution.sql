-- QB-R1C -- an approving review requires the item version's explicit PRIMARY attribution.
-- Replaces ONE function (the approval trigger of 20261110_1500). No table, column, index or row changes.
--
-- Before: when an item version had no PRIMARY concept, the trigger took the canonical subject from the
-- published concept mappings of the item's OBJECTIVE and let a reviewer qualified in that subject approve.
-- The application already refuses that approval (PRIMARY_ATTRIBUTION_REQUIRED); this aligns the database.
--
-- Now an approving review is accepted only when, in this order:
--   1. the reviewer is not a system account;
--   2. the reviewer is not the author of the version;
--   3. the item version has exactly one explicit PRIMARY attribution (question_bank_item_concepts), which
--      points at a canonical concept and so at one canonical subject;
--   4. the item has an exam family;
--   5. the reviewer holds a qualification, valid at the time of the review, for that subject and that family.
-- The subject is never taken from the objective's concept mappings, from the objective's curriculum subject,
-- from derived coverage or from a competency mapping. Attribution is decided before qualification is looked at.
--
-- Non-approving decisions are not restricted, as before. No attribution, review or qualification is created;
-- an item without a PRIMARY concept stays readable, editable where it already was, and unapproved.
--
-- Rollback: re-create public.question_bank_review_authority_guard() exactly as in
--   20261110_1500_qb_review_authority_originality.sql; DELETE FROM schema_migrations WHERE version = '20261112_1000';

CREATE OR REPLACE FUNCTION public.question_bank_review_authority_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  author uuid;
  reviewer_is_system boolean;
  family text;
  primaries integer;
  subject uuid;
  qualification uuid;
BEGIN
  IF NEW.decision <> 'APPROVED' THEN
    RETURN NEW;
  END IF;
  SELECT u.is_system INTO reviewer_is_system FROM public.users u WHERE u.id = NEW.reviewed_by;
  IF reviewer_is_system IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'QUESTION_BANK_REVIEWER_IS_SYSTEM_ACCOUNT: a system account never approves (version %)', NEW.approved_item_id USING ERRCODE = 'check_violation';
  END IF;
  SELECT ai.created_by INTO author FROM public.approved_items ai WHERE ai.id = NEW.approved_item_id;
  IF author = NEW.reviewed_by THEN
    RAISE EXCEPTION 'QUESTION_BANK_REVIEW_AUTHOR_CANNOT_APPROVE: version %', NEW.approved_item_id USING ERRCODE = 'check_violation';
  END IF;
  -- What the item is about is the reviewed PRIMARY concept of THIS version, and nothing else.
  SELECT count(*), min(cc.canonical_subject_id::text)::uuid INTO primaries, subject
    FROM public.question_bank_item_concepts ic JOIN public.canonical_concepts cc ON cc.id = ic.canonical_concept_id
   WHERE ic.approved_item_id = NEW.approved_item_id AND ic.role = 'PRIMARY';
  IF primaries <> 1 OR subject IS NULL THEN
    RAISE EXCEPTION 'QUESTION_BANK_PRIMARY_ATTRIBUTION_REQUIRED: version % has no explicit PRIMARY concept; attribution comes before approval', NEW.approved_item_id USING ERRCODE = 'check_violation';
  END IF;
  SELECT ed.exam_family INTO family
    FROM public.question_bank_items qi JOIN public.exam_versions ev ON ev.id = qi.exam_version_id JOIN public.exam_definitions ed ON ed.id = ev.exam_definition_id
   WHERE qi.id = NEW.bank_item_id;
  IF family IS NULL THEN
    RAISE EXCEPTION 'QUESTION_BANK_REVIEW_SCOPE_UNDETERMINED: version % has no exam family; it cannot be approved', NEW.approved_item_id USING ERRCODE = 'check_violation';
  END IF;
  SELECT q.id INTO qualification FROM public.question_bank_reviewer_qualifications q
   WHERE q.user_id = NEW.reviewed_by AND q.exam_family = family AND q.canonical_subject_id = subject
     AND (NEW.reviewer_qualification_id IS NULL OR q.id = NEW.reviewer_qualification_id)
     AND public.question_bank_qualification_valid(q.id, NEW.reviewed_by, NEW.reviewed_at)
   ORDER BY q.valid_from, q.id LIMIT 1;
  IF qualification IS NULL THEN
    RAISE EXCEPTION 'QUESTION_BANK_REVIEWER_NOT_QUALIFIED: reviewer % holds no valid qualification for exam family % and the subject of version %', NEW.reviewed_by, family, NEW.approved_item_id USING ERRCODE = 'check_violation';
  END IF;
  NEW.reviewer_qualification_id := qualification;
  RETURN NEW;
END $$;
