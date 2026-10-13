-- TRACK B -- Exam Bank publication: who is the author of a CORE_DERIVED bank version.
-- ORDER. Follows 20261122_1200_qf52_exam_bank_certification_coverage (it reads question_bank_items.lineage_class,
-- added by 20261121_1100, and public.question_bank_item_inherits_certification, added by 20261122_1200).
-- ADDITIVE. One function is replaced; no table, column, row or constraint is added, changed or removed.
--
-- Why. `question_bank_authored_version_guard` requires a HUMAN author for every version of a STUDYUS_AUTHORED item:
-- a technical identity never authors content. A CORE_DERIVED item is STUDYUS_AUTHORED too (StudyUs wrote the
-- construct core it is rendered from), but no person wrote the rendered row: the certified item instance is the
-- authority and the bank version only copies it. Recording a person as its author would attribute a machine's
-- rendering to that person.
--
-- The rule after this file:
--   LEGACY (not core-derived) STUDYUS_AUTHORED item   -> a human author, exactly as before.
--   CORE_DERIVED STUDYUS_AUTHORED item                -> the author is the technical identity, and the version must
--                                                        be the copy of its item instance, eligible NOW: the lineage
--                                                        digest and the difficulty in the content are the instance's
--                                                        (public.question_bank_item_inherits_certification).
-- A core-derived version written by a person, or one that is not its instance, is refused.
--
-- Rollback: re-create the function from 20261028_1000 (the human-author rule alone). No data to restore.
CREATE OR REPLACE FUNCTION public.question_bank_authored_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  prov text;
  lineage text;
  sys boolean;
BEGIN
  SELECT provenance, lineage_class INTO prov, lineage FROM public.question_bank_items WHERE id = NEW.bank_item_id;
  IF prov = 'STUDYUS_AUTHORED' THEN
    SELECT is_system INTO sys FROM public.users WHERE id = NEW.created_by;
    IF lineage = 'CORE_DERIVED' THEN
      IF sys IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'QUESTION_BANK_CORE_DERIVED_IS_NOT_AUTHORED_BY_A_PERSON: version of item %', NEW.bank_item_id USING ERRCODE = 'check_violation';
      END IF;
      IF NOT public.question_bank_item_inherits_certification(NEW.bank_item_id, NEW.content) THEN
        RAISE EXCEPTION 'QUESTION_BANK_CORE_DERIVED_IS_NOT_ITS_CERTIFIED_INSTANCE: version of item %', NEW.bank_item_id USING ERRCODE = 'check_violation';
      END IF;
    ELSIF sys IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'QUESTION_BANK_AUTHORED_NEEDS_HUMAN_AUTHOR: version of item %', NEW.bank_item_id USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
