-- B2-B1 / migration 1 of 8 -- provenance class STUDYUS_AUTHORED, source access, content rights, content sources.
-- ADDITIVE. Forward-only. Never applied automatically -- governed runner only.
--
-- What this does:
--   1. question_bank_items.provenance also accepts 'STUDYUS_AUTHORED' (written by an identified person).
--      An authored item carries no generation lineage; a generated item keeps its lineage for ever:
--      provenance becomes immutable on the bank identity.
--   2. approved_items.content_origin also accepts 'AUTHORED'.
--   3. assessment_sources.source_access says how a source can be READ. It is not a right to reuse:
--      PUBLICLY_ACCESSIBLE grants nothing. Backfilled from license_status, which stays for history.
--   4. question_bank_content_rights: one normalised rights record per piece of content, keyed by
--      content_type (ITEM_VERSION / STIMULUS_VERSION / ASSET) + content_id. Typed polymorphic references
--      are an existing convention of this schema (target_type, resource_type); integrity is kept by a
--      trigger that checks the referenced row exists, and those rows cannot be deleted.
--      Records are append-only: a correction supersedes the previous record.
--   5. question_bank_content_sources: which assessment source a piece of content used, and how.
--
-- No rights record is created for any existing item: legacy content has no established rights.
--
-- Rollback (only while no STUDYUS_AUTHORED item and no rights record exists):
--   DROP TABLE public.question_bank_content_sources; DROP TABLE public.question_bank_content_rights;
--   DROP FUNCTION public.question_bank_content_rights_guard(); DROP FUNCTION public.question_bank_content_exists(text, uuid);
--   DROP TRIGGER trg_question_bank_item_provenance_guard ON public.question_bank_items; DROP FUNCTION public.question_bank_item_provenance_guard();
--   DROP TRIGGER trg_question_bank_authored_version_guard ON public.approved_items; DROP FUNCTION public.question_bank_authored_version_guard();
--   DROP TRIGGER trg_assessment_sources_source_access ON public.assessment_sources; DROP FUNCTION public.assessment_sources_source_access_default();
--   ALTER TABLE public.assessment_sources DROP COLUMN source_access;
--   ALTER TABLE public.question_bank_items DROP CONSTRAINT question_bank_items_authored_no_generation;
--   restore question_bank_items_provenance_check and approved_items_content_origin_check without the new value;
--   DELETE FROM schema_migrations WHERE version = '20261110_1000';

-- 1. Provenance ------------------------------------------------------------------------------------------
ALTER TABLE public.question_bank_items DROP CONSTRAINT IF EXISTS question_bank_items_provenance_check;
ALTER TABLE public.question_bank_items ADD CONSTRAINT question_bank_items_provenance_check
  CHECK (provenance IN ('OFFICIAL', 'LICENSED', 'STUDYUS_GENERATED', 'STUDYUS_AUTHORED', 'FIXTURE'));
ALTER TABLE public.question_bank_items ADD CONSTRAINT question_bank_items_authored_no_generation
  CHECK (provenance <> 'STUDYUS_AUTHORED' OR (generation_request_id IS NULL AND generation_metadata IS NULL));

CREATE FUNCTION public.question_bank_item_provenance_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.provenance IS DISTINCT FROM NEW.provenance THEN
    RAISE EXCEPTION 'QUESTION_BANK_PROVENANCE_IMMUTABLE: item % is % and stays so', OLD.id, OLD.provenance USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.generation_request_id IS NOT NULL AND NEW.generation_request_id IS DISTINCT FROM OLD.generation_request_id THEN
    RAISE EXCEPTION 'QUESTION_BANK_GENERATION_LINEAGE_IMMUTABLE: item %', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_question_bank_item_provenance_guard BEFORE UPDATE ON public.question_bank_items
  FOR EACH ROW EXECUTE FUNCTION public.question_bank_item_provenance_guard();

-- An authored version is written by a person: never by a system account.
CREATE FUNCTION public.question_bank_authored_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  prov text;
  sys boolean;
BEGIN
  SELECT provenance INTO prov FROM public.question_bank_items WHERE id = NEW.bank_item_id;
  IF prov = 'STUDYUS_AUTHORED' THEN
    SELECT is_system INTO sys FROM public.users WHERE id = NEW.created_by;
    IF sys IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'QUESTION_BANK_AUTHORED_NEEDS_HUMAN_AUTHOR: version of item %', NEW.bank_item_id USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_question_bank_authored_version_guard BEFORE INSERT ON public.approved_items
  FOR EACH ROW WHEN (NEW.bank_item_id IS NOT NULL) EXECUTE FUNCTION public.question_bank_authored_version_guard();

ALTER TABLE public.approved_items DROP CONSTRAINT IF EXISTS approved_items_content_origin_check;
ALTER TABLE public.approved_items ADD CONSTRAINT approved_items_content_origin_check
  CHECK (content_origin IS NULL OR content_origin IN ('OFFICIAL', 'LICENSED', 'GENERATED', 'AUTHORED', 'FIXTURE'));

-- 2. Source access ---------------------------------------------------------------------------------------
ALTER TABLE public.assessment_sources ADD COLUMN source_access text;
ALTER TABLE public.assessment_sources ADD CONSTRAINT assessment_sources_source_access_check
  CHECK (source_access IN ('PUBLICLY_ACCESSIBLE', 'PRIVATE', 'LICENSED_SOURCE', 'NOT_APPLICABLE'));

DO $$
DECLARE
  total bigint;
  touched bigint;
BEGIN
  SELECT count(*) INTO total FROM public.assessment_sources;
  UPDATE public.assessment_sources SET source_access = CASE license_status
    WHEN 'PUBLIC' THEN 'PUBLICLY_ACCESSIBLE' WHEN 'LICENSED' THEN 'LICENSED_SOURCE'
    WHEN 'GENERATED' THEN 'NOT_APPLICABLE' WHEN 'INTERNAL' THEN 'PRIVATE' END;
  GET DIAGNOSTICS touched = ROW_COUNT;
  IF touched <> total OR EXISTS (SELECT 1 FROM public.assessment_sources WHERE source_access IS NULL) THEN
    RAISE EXCEPTION 'B2B1_SOURCE_ACCESS_BACKFILL: % rows expected, % updated, or a row left without access', total, touched;
  END IF;
END $$;
ALTER TABLE public.assessment_sources ALTER COLUMN source_access SET NOT NULL;

-- Existing writers do not know the column: derive it from the licence status they do write.
CREATE FUNCTION public.assessment_sources_source_access_default() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source_access IS NULL THEN
    NEW.source_access := CASE NEW.license_status
      WHEN 'PUBLIC' THEN 'PUBLICLY_ACCESSIBLE' WHEN 'LICENSED' THEN 'LICENSED_SOURCE'
      WHEN 'GENERATED' THEN 'NOT_APPLICABLE' WHEN 'INTERNAL' THEN 'PRIVATE' END;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_assessment_sources_source_access BEFORE INSERT ON public.assessment_sources
  FOR EACH ROW EXECUTE FUNCTION public.assessment_sources_source_access_default();

-- 3. Content rights --------------------------------------------------------------------------------------
-- Does the referenced content exist? Stimulus versions and assets arrive in later migrations, so the
-- lookup is by name and a type whose table is not there yet has no content.
CREATE FUNCTION public.question_bank_content_exists(p_type text, p_id uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE
  tbl text;
  found boolean;
BEGIN
  IF p_type = 'ITEM_VERSION' THEN
    RETURN EXISTS (SELECT 1 FROM public.approved_items WHERE id = p_id AND bank_item_id IS NOT NULL);
  END IF;
  tbl := CASE p_type WHEN 'STIMULUS_VERSION' THEN 'public.question_bank_stimulus_versions' WHEN 'ASSET' THEN 'public.question_bank_assets' END;
  IF tbl IS NULL OR to_regclass(tbl) IS NULL THEN
    RETURN false;
  END IF;
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE id = $1)', tbl) INTO found USING p_id;
  RETURN found;
END $$;

CREATE TABLE public.question_bank_content_rights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_type text NOT NULL CHECK (content_type IN ('ITEM_VERSION', 'STIMULUS_VERSION', 'ASSET')),
  content_id uuid NOT NULL,
  source_access text NOT NULL CHECK (source_access IN ('PUBLICLY_ACCESSIBLE', 'PRIVATE', 'LICENSED_SOURCE', 'NOT_APPLICABLE')),
  reuse_rights text NOT NULL CHECK (reuse_rights IN ('STUDYUS_OWNED', 'LICENSED_FOR_USE', 'OFFICIALLY_AUTHORIZED', 'UNKNOWN', 'PROHIBITED')),
  rights_holder text,
  permitted_use text,
  attribution_text text,
  licence_reference text,
  valid_from date,
  valid_to date,
  recorded_by uuid NOT NULL REFERENCES public.users(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  CONSTRAINT question_bank_content_rights_validity CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_to >= valid_from),
  -- Established rights name who holds them and what they allow.
  CONSTRAINT question_bank_content_rights_established CHECK (
    reuse_rights IN ('UNKNOWN', 'PROHIBITED')
    OR (length(btrim(coalesce(rights_holder, ''))) > 0 AND length(btrim(coalesce(permitted_use, ''))) > 0)),
  -- A licence or an authorisation is a document that can be cited.
  CONSTRAINT question_bank_content_rights_licence CHECK (
    reuse_rights NOT IN ('LICENSED_FOR_USE', 'OFFICIALLY_AUTHORIZED') OR length(btrim(coalesce(licence_reference, ''))) > 0)
);
CREATE UNIQUE INDEX question_bank_content_rights_current ON public.question_bank_content_rights (content_type, content_id) WHERE superseded_at IS NULL;
CREATE INDEX question_bank_content_rights_content ON public.question_bank_content_rights (content_type, content_id);

CREATE FUNCTION public.question_bank_content_rights_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'QUESTION_BANK_RIGHTS_APPEND_ONLY: record % cannot be deleted', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT public.question_bank_content_exists(NEW.content_type, NEW.content_id) THEN
      RAISE EXCEPTION 'QUESTION_BANK_RIGHTS_CONTENT_NOT_FOUND: % %', NEW.content_type, NEW.content_id USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE: the only change allowed is superseding a current record, once.
  IF OLD.superseded_at IS NOT NULL OR NEW.superseded_at IS NULL
     OR (to_jsonb(NEW) - 'superseded_at') IS DISTINCT FROM (to_jsonb(OLD) - 'superseded_at') THEN
    RAISE EXCEPTION 'QUESTION_BANK_RIGHTS_APPEND_ONLY: record % can only be superseded', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_question_bank_content_rights_guard BEFORE INSERT OR UPDATE OR DELETE ON public.question_bank_content_rights
  FOR EACH ROW EXECUTE FUNCTION public.question_bank_content_rights_guard();

-- 4. Content sources -------------------------------------------------------------------------------------
-- REFERENCE_ONLY = the source informed the content (a specification, a syllabus). ADAPTED / REPRODUCED =
-- the content carries material from the source, which is what reuse rights are about.
CREATE TABLE public.question_bank_content_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rights_id uuid NOT NULL REFERENCES public.question_bank_content_rights(id),
  assessment_source_id uuid NOT NULL REFERENCES public.assessment_sources(id),
  usage text NOT NULL CHECK (usage IN ('REFERENCE_ONLY', 'ADAPTED', 'REPRODUCED')),
  locator text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rights_id, assessment_source_id, usage)
);
