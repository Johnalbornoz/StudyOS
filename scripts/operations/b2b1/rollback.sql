-- B2-B1 -- rollback of migrations 20261110_1700 .. 20261110_1000, in reverse order.
-- Feasible ONLY while the new tables are empty and no STUDYUS_AUTHORED item / variant blueprint / frozen
-- form exists: it drops them. It refuses otherwise. Used by the ephemeral certification; on a shared
-- environment it is an operator decision, never automatic.
\set ON_ERROR_STOP 1
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.question_bank_items WHERE provenance = 'STUDYUS_AUTHORED')
     OR EXISTS (SELECT 1 FROM public.approved_items WHERE content_origin = 'AUTHORED')
     OR EXISTS (SELECT 1 FROM public.assessment_blueprints WHERE purpose IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.exam_instances WHERE frozen_form_id IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.question_bank_content_rights) OR EXISTS (SELECT 1 FROM public.question_bank_assets)
     OR EXISTS (SELECT 1 FROM public.question_bank_stimuli) OR EXISTS (SELECT 1 FROM public.question_bank_item_concepts)
     OR EXISTS (SELECT 1 FROM public.question_bank_item_context_tags) OR EXISTS (SELECT 1 FROM public.question_bank_pool_memberships)
     OR EXISTS (SELECT 1 FROM public.question_bank_reviewer_qualifications) OR EXISTS (SELECT 1 FROM public.question_bank_stimulus_reviews)
     OR EXISTS (SELECT 1 FROM public.question_bank_originality_checks) OR EXISTS (SELECT 1 FROM public.assessment_frozen_forms)
     OR EXISTS (SELECT 1 FROM public.question_bank_reviews WHERE reviewer_qualification_id IS NOT NULL OR checklist_key IS NOT NULL) THEN
    RAISE EXCEPTION 'B2B1_ROLLBACK_REFUSED: content exists in the new schema';
  END IF;
END $$;

-- 8
ALTER TABLE public.exam_instances DROP COLUMN frozen_form_id;
DROP TABLE public.assessment_frozen_form_positions;
DROP TABLE public.assessment_frozen_forms;
DROP FUNCTION public.assessment_frozen_form_guard();
DROP FUNCTION public.assessment_frozen_form_position_guard();
-- 7
DROP TABLE public.assessment_blueprint_requirement_sources;
DROP TABLE public.assessment_blueprint_requirements;
DROP TRIGGER trg_assessment_blueprint_publish_guard ON public.assessment_blueprints;
DROP TRIGGER trg_assessment_blueprint_identity_guard ON public.assessment_blueprints;
DROP FUNCTION public.assessment_blueprint_publish_guard();
DROP FUNCTION public.assessment_blueprint_official_source_check();
DROP FUNCTION public.assessment_blueprint_requirement_guard();
DROP FUNCTION public.assessment_blueprint_identity_guard();
DROP INDEX public.assessment_blueprints_exam_version;
DROP INDEX public.assessment_blueprints_one_published_revision;
DROP INDEX public.assessment_blueprints_variant_identity_key;
DROP INDEX public.assessment_blueprints_legacy_per_version;
ALTER TABLE public.assessment_blueprints ADD CONSTRAINT assessment_blueprints_exam_version_id_key UNIQUE (exam_version_id);
ALTER TABLE public.assessment_blueprints DROP COLUMN pool, DROP COLUMN revision, DROP COLUMN form_number, DROP COLUMN purpose;
-- 6
DROP TABLE public.question_bank_originality_checks;
DROP FUNCTION public.question_bank_originality_check_guard();
DROP TRIGGER trg_question_bank_stimulus_activation_guard ON public.question_bank_stimulus_versions;
DROP FUNCTION public.question_bank_stimulus_activation_guard();
DROP TABLE public.question_bank_stimulus_reviews;
DROP FUNCTION public.question_bank_stimulus_review_authority_guard();
DROP TRIGGER trg_question_bank_review_authority_guard ON public.question_bank_reviews;
DROP FUNCTION public.question_bank_review_authority_guard();
ALTER TABLE public.question_bank_reviews DROP COLUMN reviewer_qualification_id, DROP COLUMN checklist_version, DROP COLUMN checklist_key;
DROP FUNCTION public.question_bank_qualification_valid(uuid, uuid, timestamptz);
DROP TABLE public.question_bank_reviewer_qualifications;
DROP FUNCTION public.question_bank_reviewer_qualification_guard();
CREATE OR REPLACE FUNCTION public.question_bank_quality_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
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
  IF prov = 'STUDYUS_GENERATED' AND NEW.bank_lifecycle_status IN ('ACTIVE', 'CALIBRATED')
     AND (TG_OP = 'INSERT' OR OLD.bank_lifecycle_status IS DISTINCT FROM NEW.bank_lifecycle_status)
     AND NOT EXISTS (SELECT 1 FROM public.question_bank_reviews r WHERE r.approved_item_id = NEW.id AND r.decision = 'APPROVED') THEN
    RAISE EXCEPTION 'QUESTION_BANK_HUMAN_APPROVAL_REQUIRED: generated version % needs an APPROVED review before %', NEW.id, NEW.bank_lifecycle_status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $fn$;
-- 5
DROP TRIGGER trg_question_bank_item_stimulus_pool_guard ON public.question_bank_item_stimulus;
DROP FUNCTION public.question_bank_item_stimulus_pool_guard();
DROP TABLE public.question_bank_pool_memberships;
DROP FUNCTION public.question_bank_pool_membership_guard();
-- 4
DROP TABLE public.question_bank_item_context_tags;
DROP TABLE public.question_bank_item_concepts;
DROP FUNCTION public.question_bank_item_concept_guard();
-- 3
DROP TABLE public.question_bank_item_stimulus;
DROP TABLE public.question_bank_stimulus_parts;
ALTER TABLE public.question_bank_stimuli DROP CONSTRAINT question_bank_stimuli_current_version_fk;
DROP TABLE public.question_bank_stimulus_versions;
DROP TABLE public.question_bank_stimuli;
DROP FUNCTION public.question_bank_item_stimulus_guard();
DROP FUNCTION public.question_bank_stimulus_part_guard();
DROP FUNCTION public.question_bank_stimulus_version_insert_guard();
DROP FUNCTION public.question_bank_stimulus_version_guard();
DROP FUNCTION public.question_bank_stimulus_guard();
-- 2
DROP TABLE public.question_bank_item_assets;
DROP TABLE public.question_bank_assets;
DROP FUNCTION public.question_bank_item_asset_guard();
DROP FUNCTION public.question_bank_asset_guard();
-- 1
DROP TABLE public.question_bank_content_sources;
DROP TABLE public.question_bank_content_rights;
DROP FUNCTION public.question_bank_content_rights_guard();
DROP FUNCTION public.question_bank_content_exists(text, uuid);
DROP TRIGGER trg_assessment_sources_source_access ON public.assessment_sources;
DROP FUNCTION public.assessment_sources_source_access_default();
ALTER TABLE public.assessment_sources DROP COLUMN source_access;
DROP TRIGGER trg_question_bank_authored_version_guard ON public.approved_items;
DROP FUNCTION public.question_bank_authored_version_guard();
DROP TRIGGER trg_question_bank_item_provenance_guard ON public.question_bank_items;
DROP FUNCTION public.question_bank_item_provenance_guard();
ALTER TABLE public.question_bank_items DROP CONSTRAINT question_bank_items_authored_no_generation;
ALTER TABLE public.question_bank_items DROP CONSTRAINT question_bank_items_provenance_check;
ALTER TABLE public.question_bank_items ADD CONSTRAINT question_bank_items_provenance_check CHECK (provenance IN ('OFFICIAL', 'LICENSED', 'STUDYUS_GENERATED', 'FIXTURE'));
ALTER TABLE public.approved_items DROP CONSTRAINT approved_items_content_origin_check;
ALTER TABLE public.approved_items ADD CONSTRAINT approved_items_content_origin_check CHECK (content_origin IS NULL OR content_origin IN ('OFFICIAL', 'LICENSED', 'GENERATED', 'FIXTURE'));
DELETE FROM public.schema_migrations WHERE version LIKE '20261110\_%';
COMMIT;
