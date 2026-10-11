-- B2-B1 / migration 7 of 8 -- blueprint variants and authority-tagged requirements.
-- Additive, with ONE constraint relaxed: UNIQUE (exam_version_id) on assessment_blueprints is replaced by
-- three narrower rules. No row is changed.
--
-- An exam version can now carry several blueprints: a variant is identified by
-- (exam version, purpose, form number, revision), never by a name.
--   purpose      FULL / REDUCED / DIAGNOSTIC. NULL = a legacy blueprint whose purpose was never declared.
--   form_number  Full form 1, Full form 2, ...
--   revision     a corrected edition of the same form
--   pool         the logical pool the variant draws from
-- Existing rows keep purpose NULL (and form_number, revision, pool NULL): nothing is classified after the
-- fact. Their fidelity keeps being decided at runtime, as today.
--
-- Uniqueness:
--   legacy            one per exam version                                  (as before)
--   variant           one per (exam version, purpose, form number, revision)
--   published variant one PUBLISHED revision per (exam version, purpose, form number)
--
-- READERS: every existing query reads a version's blueprint by exam_version_id and expects one row. That
-- stays true while no variant row exists. This migration inserts none; before the first variant is
-- inserted, legacy readers must filter `purpose IS NULL` (the wiring phase, not this one).
--
-- Requirements: everything about a variant that is not a slot, each tagged with who says so.
--   OFFICIAL        the exam's specification; cites at least one assessment source.
--   STUDYUS_POLICY  a StudyUs decision; names its policy and version.
-- Reduced size, diagnostic depth, pool policy and exposure policy exist only as StudyUs constructs and
-- can never be tagged OFFICIAL. Requirements are written while the variant is a DRAFT and fixed after.
--
-- Rollback (only while no variant row exists): DROP TABLE public.assessment_blueprint_requirement_sources,
--   public.assessment_blueprint_requirements; DROP the triggers/functions below; DROP the three indexes;
--   ALTER TABLE public.assessment_blueprints ADD CONSTRAINT assessment_blueprints_exam_version_id_key UNIQUE (exam_version_id);
--   ALTER TABLE public.assessment_blueprints DROP COLUMN pool, DROP COLUMN revision, DROP COLUMN form_number, DROP COLUMN purpose;
--   DELETE FROM schema_migrations WHERE version = '20261110_1600';

ALTER TABLE public.assessment_blueprints ADD COLUMN purpose text;
ALTER TABLE public.assessment_blueprints ADD COLUMN form_number integer;
ALTER TABLE public.assessment_blueprints ADD COLUMN revision integer;
ALTER TABLE public.assessment_blueprints ADD COLUMN pool text;
ALTER TABLE public.assessment_blueprints ADD CONSTRAINT assessment_blueprints_purpose_check
  CHECK (purpose IS NULL OR purpose IN ('FULL', 'REDUCED', 'DIAGNOSTIC'));
ALTER TABLE public.assessment_blueprints ADD CONSTRAINT assessment_blueprints_pool_check
  CHECK (pool IS NULL OR pool IN ('PRACTICE', 'DIAGNOSTIC', 'VERIFICATION', 'REDUCED_MOCK', 'FULL_MOCK_1', 'FULL_MOCK_2'));
ALTER TABLE public.assessment_blueprints ADD CONSTRAINT assessment_blueprints_variant_identity
  CHECK ((purpose IS NULL AND form_number IS NULL AND revision IS NULL AND pool IS NULL)
      OR (purpose IS NOT NULL AND form_number IS NOT NULL AND revision IS NOT NULL AND form_number >= 1 AND revision >= 1));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.assessment_blueprints WHERE purpose IS NOT NULL) THEN
    RAISE EXCEPTION 'B2B1_BLUEPRINT_VARIANTS: a legacy blueprint was classified';
  END IF;
END $$;

ALTER TABLE public.assessment_blueprints DROP CONSTRAINT assessment_blueprints_exam_version_id_key;
CREATE UNIQUE INDEX assessment_blueprints_legacy_per_version ON public.assessment_blueprints (exam_version_id) WHERE purpose IS NULL;
CREATE UNIQUE INDEX assessment_blueprints_variant_identity_key ON public.assessment_blueprints (exam_version_id, purpose, form_number, revision) WHERE purpose IS NOT NULL;
CREATE UNIQUE INDEX assessment_blueprints_one_published_revision ON public.assessment_blueprints (exam_version_id, purpose, form_number) WHERE purpose IS NOT NULL AND status = 'PUBLISHED';
CREATE INDEX assessment_blueprints_exam_version ON public.assessment_blueprints (exam_version_id);

-- Identity never changes: a legacy blueprint stays legacy, a variant stays the variant it was created as.
CREATE FUNCTION public.assessment_blueprint_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.exam_version_id IS DISTINCT FROM NEW.exam_version_id OR OLD.purpose IS DISTINCT FROM NEW.purpose
     OR OLD.form_number IS DISTINCT FROM NEW.form_number OR OLD.revision IS DISTINCT FROM NEW.revision THEN
    RAISE EXCEPTION 'ASSESSMENT_BLUEPRINT_IDENTITY_IMMUTABLE: blueprint %', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.purpose IS NOT NULL AND OLD.status <> 'DRAFT' AND OLD.pool IS DISTINCT FROM NEW.pool THEN
    RAISE EXCEPTION 'ASSESSMENT_BLUEPRINT_POOL_FIXED: blueprint % is %', OLD.id, OLD.status USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.purpose IS NOT NULL AND (OLD.status = 'RETIRED' AND NEW.status <> 'RETIRED' OR OLD.status = 'PUBLISHED' AND NEW.status = 'DRAFT') THEN
    RAISE EXCEPTION 'ASSESSMENT_BLUEPRINT_INVALID_TRANSITION: % -> %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_assessment_blueprint_identity_guard BEFORE UPDATE ON public.assessment_blueprints
  FOR EACH ROW EXECUTE FUNCTION public.assessment_blueprint_identity_guard();

CREATE TABLE public.assessment_blueprint_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blueprint_id uuid NOT NULL REFERENCES public.assessment_blueprints(id),
  requirement_key text NOT NULL CHECK (length(btrim(requirement_key)) > 0),
  kind text NOT NULL CHECK (kind IN ('TOTAL_ITEM_COUNT', 'SECTION_ITEM_COUNT', 'SECTION_ORDER', 'SECTION_SCORED_MINUTES', 'RESPONSE_FORMAT', 'TOOL_POLICY',
    'DOMAIN_ALLOCATION', 'DIFFICULTY_DISTRIBUTION', 'REDUCED_SIZE', 'DIAGNOSTIC_EVIDENCE_DEPTH', 'POOL_POLICY', 'EXPOSURE_POLICY', 'STIMULUS_SET')),
  assessment_component_id uuid REFERENCES public.assessment_components(id),
  value jsonb NOT NULL,
  authority text NOT NULL CHECK (authority IN ('OFFICIAL', 'STUDYUS_POLICY')),
  policy_id text,
  policy_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assessment_blueprint_requirements_key UNIQUE (blueprint_id, requirement_key),
  CONSTRAINT assessment_blueprint_requirements_policy_ref CHECK (
    (authority = 'STUDYUS_POLICY' AND length(btrim(coalesce(policy_id, ''))) > 0 AND length(btrim(coalesce(policy_version, ''))) > 0)
    OR (authority = 'OFFICIAL' AND policy_id IS NULL AND policy_version IS NULL)),
  CONSTRAINT assessment_blueprint_requirements_policy_only_kinds CHECK (
    authority = 'STUDYUS_POLICY' OR kind NOT IN ('REDUCED_SIZE', 'DIAGNOSTIC_EVIDENCE_DEPTH', 'POOL_POLICY', 'EXPOSURE_POLICY'))
);

CREATE TABLE public.assessment_blueprint_requirement_sources (
  requirement_id uuid NOT NULL REFERENCES public.assessment_blueprint_requirements(id) ON DELETE CASCADE,
  assessment_source_id uuid NOT NULL REFERENCES public.assessment_sources(id),
  locator text,
  PRIMARY KEY (requirement_id, assessment_source_id)
);

-- Requirements belong to a variant and are written while it is a draft.
CREATE FUNCTION public.assessment_blueprint_requirement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  req uuid;
  bp uuid;
  bp_purpose text;
  bp_status text;
BEGIN
  IF TG_TABLE_NAME = 'assessment_blueprint_requirements' THEN
    bp := CASE WHEN TG_OP = 'DELETE' THEN OLD.blueprint_id ELSE NEW.blueprint_id END;
    IF TG_OP = 'UPDATE' AND OLD.blueprint_id IS DISTINCT FROM NEW.blueprint_id THEN
      RAISE EXCEPTION 'ASSESSMENT_BLUEPRINT_REQUIREMENT_OWNER_IMMUTABLE' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    req := CASE WHEN TG_OP = 'DELETE' THEN OLD.requirement_id ELSE NEW.requirement_id END;
    SELECT blueprint_id INTO bp FROM public.assessment_blueprint_requirements WHERE id = req;
    IF bp IS NULL THEN
      -- The requirement itself is being removed (cascade); its own guard already decided.
      RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;
  END IF;
  SELECT purpose, status INTO bp_purpose, bp_status FROM public.assessment_blueprints WHERE id = bp;
  IF bp_purpose IS NULL THEN
    RAISE EXCEPTION 'ASSESSMENT_BLUEPRINT_REQUIREMENT_NEEDS_VARIANT: blueprint % is a legacy blueprint', bp USING ERRCODE = 'check_violation';
  END IF;
  IF bp_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'ASSESSMENT_BLUEPRINT_REQUIREMENTS_FIXED: blueprint % is %; publish a new revision instead', bp, bp_status USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER trg_assessment_blueprint_requirement_guard BEFORE INSERT OR UPDATE OR DELETE ON public.assessment_blueprint_requirements
  FOR EACH ROW EXECUTE FUNCTION public.assessment_blueprint_requirement_guard();
CREATE TRIGGER trg_assessment_blueprint_requirement_source_guard BEFORE INSERT OR UPDATE OR DELETE ON public.assessment_blueprint_requirement_sources
  FOR EACH ROW EXECUTE FUNCTION public.assessment_blueprint_requirement_guard();

-- An official requirement cites a source. Checked at commit, so the requirement and its sources can be
-- written in one transaction in either order.
CREATE FUNCTION public.assessment_blueprint_official_source_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  req uuid;
BEGIN
  IF TG_TABLE_NAME = 'assessment_blueprint_requirements' THEN
    req := NEW.id;
  ELSE
    req := OLD.requirement_id;
  END IF;
  IF EXISTS (SELECT 1 FROM public.assessment_blueprint_requirements r WHERE r.id = req AND r.authority = 'OFFICIAL')
     AND NOT EXISTS (SELECT 1 FROM public.assessment_blueprint_requirement_sources s WHERE s.requirement_id = req) THEN
    RAISE EXCEPTION 'ASSESSMENT_BLUEPRINT_OFFICIAL_WITHOUT_SOURCE: requirement %', req USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trg_assessment_blueprint_official_source AFTER INSERT OR UPDATE ON public.assessment_blueprint_requirements
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assessment_blueprint_official_source_check();
CREATE CONSTRAINT TRIGGER trg_assessment_blueprint_official_source_removed AFTER DELETE ON public.assessment_blueprint_requirement_sources
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assessment_blueprint_official_source_check();

-- A published variant is complete: it names its pool. Its requirements were fixed when it left DRAFT.
CREATE FUNCTION public.assessment_blueprint_publish_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.pool IS NULL THEN
    RAISE EXCEPTION 'ASSESSMENT_BLUEPRINT_PUBLISH_NEEDS_POOL: blueprint %', NEW.id USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.assessment_blueprint_requirements r WHERE r.blueprint_id = NEW.id) THEN
    RAISE EXCEPTION 'ASSESSMENT_BLUEPRINT_PUBLISH_NEEDS_REQUIREMENTS: blueprint %', NEW.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_assessment_blueprint_publish_guard BEFORE INSERT OR UPDATE ON public.assessment_blueprints
  FOR EACH ROW WHEN (NEW.purpose IS NOT NULL AND NEW.status = 'PUBLISHED') EXECUTE FUNCTION public.assessment_blueprint_publish_guard();
