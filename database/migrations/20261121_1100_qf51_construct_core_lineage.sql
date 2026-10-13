-- QF V5.1 -- assessment system registry, construct cores, explicit applicability, adapters, renderers and
-- item-instance lineage.
-- ORDER. Intended as migration 88. It follows 20261121_1000_student_scheduled_assessments (migration 87, AD_HOC
-- concept exams), with which it shares no object: neither reads, alters nor drops anything of the other.
-- ADDITIVE. Eight new tables, one view, two columns on question_bank_items. No row is rewritten or deleted.
--
-- What it persists:
--   assessment_systems                      one row per REGISTERED assessment / curriculum system: an examination,
--                                           a curriculum, a qualification, a national standard, an institution's
--                                           model. There is no list of systems in the schema: a system is a row.
--   assessment_system_versions              the versions of a system, each with its own effective dates. A rule,
--                                           an adapter and an instance always belong to ONE version.
--   assessment_system_nodes                 the contexts inside a version: programme / qualification -> subject ->
--                                           level -> component. A COMPONENT node is what an adapter is the adapter of.
--   assessment_construct_cores              one row per AssessmentTaskFamily VERSION: the reusable asset. The family
--                                           contract is stored verbatim (jsonb) with its content hash; lifecycle
--                                           DRAFT -> UNDER_REVIEW -> CERTIFIED -> RETIRED.
--   assessment_adapters                     one row per assessment system/component adapter version (the EA-1
--                                           system + component profile, resolved), PROVISIONAL or CERTIFIED.
--   assessment_construct_core_applicability core x adapter: SUPPORTED / CONDITIONAL / NOT_APPLICABLE with its reason
--                                           and constraints. Never inferred: no row = not plannable.
--   assessment_instance_renderers           the certified rendering strategies, by renderer version.
--   assessment_item_instances               materialised instances with the full lineage: core, concept, adaptation
--                                           specification, adapter, blueprint bucket, seed, parameter set, renderer,
--                                           certification version.
--
-- Guards (database, not only application):
--   - an adapter is the adapter of a registered COMPONENT node of a registered system version; an applicability
--     names a registered system; an instance carries the system and version of its adapter.
--   - a CERTIFIED core carries a certification; a certified core's content never changes (a change is a new version);
--     lifecycle moves only along DRAFT -> UNDER_REVIEW -> CERTIFIED -> RETIRED (UNDER_REVIEW may return to DRAFT).
--   - an item instance is accepted only from a CERTIFIED core at its current certification version, a CERTIFIED
--     adapter, a CERTIFIED renderer and an applicability that is SUPPORTED or CONDITIONAL.
--
-- Existing content: every question_bank_items row becomes lineage_class = 'LEGACY' (the column default). Nothing
-- here marks a legacy item certified, core-derived or Student-eligible; `student_eligible_item_instances` reads
-- assessment_item_instances only. A legacy item becomes CORE_DERIVED only by an explicit, reviewed link to an
-- instance (item_instance_id), never by this migration.
--
-- Rollback:
--   DROP VIEW IF EXISTS public.student_eligible_item_instances;
--   ALTER TABLE public.question_bank_items DROP CONSTRAINT IF EXISTS question_bank_items_lineage_ck, DROP COLUMN IF EXISTS item_instance_id, DROP COLUMN IF EXISTS lineage_class;
--   DROP TABLE IF EXISTS public.assessment_item_instances, public.assessment_instance_renderers, public.assessment_construct_core_applicability, public.assessment_adapters, public.assessment_construct_cores,
--     public.assessment_system_nodes, public.assessment_system_versions, public.assessment_systems;
--   DROP FUNCTION IF EXISTS public.assessment_construct_core_guard(), public.assessment_item_instance_guard();
--   DELETE FROM schema_migrations WHERE version = '20261121_1100';

-- The registry. Deliberately NO check on which systems exist: PAA, IB or a system registered next year are rows.
CREATE TABLE IF NOT EXISTS public.assessment_systems (
  system_id text PRIMARY KEY CHECK (system_id ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  organization text NOT NULL CHECK (length(btrim(organization)) > 0),
  region text,
  -- what KIND of thing the system is; a vocabulary of kinds, not a list of systems
  system_type text NOT NULL CHECK (system_type IN ('EXAM', 'CURRICULUM', 'QUALIFICATION', 'NATIONAL_STANDARD', 'INSTITUTIONAL', 'HYBRID')),
  lifecycle text NOT NULL DEFAULT 'DRAFT' CHECK (lifecycle IN ('DRAFT', 'ACTIVE', 'RETIRED')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  provenance jsonb NOT NULL CHECK (jsonb_typeof(provenance) = 'object' AND provenance ? 'basis'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.assessment_system_versions (
  system_id text NOT NULL REFERENCES public.assessment_systems(system_id) ON DELETE RESTRICT,
  version_id text NOT NULL CHECK (version_id ~ '^[a-z0-9]+([.-][a-z0-9]+)*$' AND length(version_id) <= 80),
  label text NOT NULL CHECK (length(btrim(label)) > 0),
  lifecycle text NOT NULL DEFAULT 'DRAFT' CHECK (lifecycle IN ('DRAFT', 'ACTIVE', 'RETIRED')),
  effective_from date,
  effective_to date,
  provenance jsonb NOT NULL CHECK (jsonb_typeof(provenance) = 'object' AND provenance ? 'basis'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (system_id, version_id),
  CONSTRAINT assessment_system_versions_dates_ck CHECK (effective_from IS NULL OR effective_to IS NULL OR effective_to >= effective_from)
);

CREATE TABLE IF NOT EXISTS public.assessment_system_nodes (
  node_id text NOT NULL CHECK (node_id ~ '^[A-Z][A-Z0-9_]{1,39}(\.[A-Z0-9_]{1,40}){1,4}$'),
  system_id text NOT NULL,
  version_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('PROGRAMME', 'QUALIFICATION', 'SUBJECT', 'LEVEL', 'COMPONENT')),
  parent_node_id text,
  code text NOT NULL,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (node_id, version_id),
  FOREIGN KEY (system_id, version_id) REFERENCES public.assessment_system_versions(system_id, version_id) ON DELETE RESTRICT,
  -- a parent is a node of the SAME version
  FOREIGN KEY (parent_node_id, version_id) REFERENCES public.assessment_system_nodes(node_id, version_id) ON DELETE RESTRICT,
  CONSTRAINT assessment_system_nodes_under_system_ck CHECK (left(node_id, length(system_id) + 1) = system_id || '.')
);
CREATE INDEX IF NOT EXISTS assessment_system_nodes_version_idx ON public.assessment_system_nodes (system_id, version_id, kind);

CREATE TABLE IF NOT EXISTS public.assessment_construct_cores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  construct_family_id text NOT NULL CHECK (construct_family_id ~ '^tf\.[a-z0-9]+([.-][a-z0-9]+)*$'),
  family_version text NOT NULL CHECK (length(family_version) BETWEEN 1 AND 200),
  family_type text NOT NULL,
  canonical_subject text NOT NULL,
  primary_concept_stable_id text NOT NULL,
  lifecycle text NOT NULL DEFAULT 'DRAFT' CHECK (lifecycle IN ('DRAFT', 'UNDER_REVIEW', 'CERTIFIED', 'RETIRED')),
  certification_version text,
  certified_by text,
  certified_at timestamptz,
  shortcut_constraints jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(shortcut_constraints) = 'array'),
  family jsonb NOT NULL CHECK (jsonb_typeof(family) = 'object'),
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assessment_construct_cores_version_uq UNIQUE (construct_family_id, family_version),
  -- the stored contract is the family the row is keyed by
  CONSTRAINT assessment_construct_cores_family_ck CHECK (family->>'familyId' = construct_family_id AND family->>'version' = family_version),
  -- only a certified (or later retired) core carries a certification, and a certified one always does
  CONSTRAINT assessment_construct_cores_certification_ck CHECK (
    (lifecycle IN ('DRAFT', 'UNDER_REVIEW') AND certification_version IS NULL AND certified_by IS NULL AND certified_at IS NULL)
    OR (lifecycle = 'CERTIFIED' AND certification_version IS NOT NULL AND certified_by IS NOT NULL AND certified_at IS NOT NULL)
    OR lifecycle = 'RETIRED')
);
CREATE INDEX IF NOT EXISTS assessment_construct_cores_concept_idx ON public.assessment_construct_cores (primary_concept_stable_id) WHERE lifecycle = 'CERTIFIED';

CREATE OR REPLACE FUNCTION public.assessment_construct_core_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.lifecycle NOT IN ('DRAFT', 'UNDER_REVIEW') THEN
      RAISE EXCEPTION 'CORE_IS_CREATED_AS_A_DRAFT: % @ %', NEW.construct_family_id, NEW.family_version USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.construct_family_id IS DISTINCT FROM OLD.construct_family_id OR NEW.family_version IS DISTINCT FROM OLD.family_version THEN
    RAISE EXCEPTION 'CORE_IDENTITY_IS_IMMUTABLE' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.lifecycle IS DISTINCT FROM OLD.lifecycle AND NOT (
       (OLD.lifecycle = 'DRAFT' AND NEW.lifecycle IN ('UNDER_REVIEW', 'RETIRED'))
    OR (OLD.lifecycle = 'UNDER_REVIEW' AND NEW.lifecycle IN ('DRAFT', 'CERTIFIED', 'RETIRED'))
    OR (OLD.lifecycle = 'CERTIFIED' AND NEW.lifecycle = 'RETIRED')) THEN
    RAISE EXCEPTION 'CORE_LIFECYCLE_TRANSITION_REFUSED: % -> %', OLD.lifecycle, NEW.lifecycle USING ERRCODE = 'check_violation';
  END IF;
  -- once certified, the construct is frozen: content, concept and certification never change (retiring is allowed)
  IF OLD.lifecycle IN ('CERTIFIED', 'RETIRED') AND (
       NEW.family IS DISTINCT FROM OLD.family OR NEW.shortcut_constraints IS DISTINCT FROM OLD.shortcut_constraints OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
    OR NEW.primary_concept_stable_id IS DISTINCT FROM OLD.primary_concept_stable_id
    OR (OLD.lifecycle = 'CERTIFIED' AND (NEW.certification_version IS DISTINCT FROM OLD.certification_version OR NEW.certified_by IS DISTINCT FROM OLD.certified_by OR NEW.certified_at IS DISTINCT FROM OLD.certified_at))) THEN
    RAISE EXCEPTION 'CERTIFIED_CORE_IS_IMMUTABLE: % @ %', OLD.construct_family_id, OLD.family_version USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_assessment_construct_core_guard ON public.assessment_construct_cores;
CREATE TRIGGER trg_assessment_construct_core_guard BEFORE INSERT OR UPDATE ON public.assessment_construct_cores
  FOR EACH ROW EXECUTE FUNCTION public.assessment_construct_core_guard();

CREATE TABLE IF NOT EXISTS public.assessment_adapters (
  adapter_id text NOT NULL CHECK (adapter_id ~ '^[A-Z][A-Z0-9_]{1,39}(\.[A-Z0-9_]{1,40}){1,4}$'),
  adapter_version text NOT NULL,
  status text NOT NULL DEFAULT 'PROVISIONAL' CHECK (status IN ('PROVISIONAL', 'CERTIFIED')),
  source text NOT NULL CHECK (source IN ('EA1_COMPONENT_PROFILE', 'V5_GENERATION_PROFILE')),
  -- the registered system version this adapter is the adapter of
  system_id text NOT NULL,
  system_version_id text NOT NULL,
  -- the system's code in the legacy exam-family taxonomy, when it has one: a label, nothing resolves through it
  exam_family text,
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (adapter_id, adapter_version),
  FOREIGN KEY (system_id, system_version_id) REFERENCES public.assessment_system_versions(system_id, version_id) ON DELETE RESTRICT,
  -- the adapter id IS a registered COMPONENT node of that version
  FOREIGN KEY (adapter_id, system_version_id) REFERENCES public.assessment_system_nodes(node_id, version_id) ON DELETE RESTRICT,
  CONSTRAINT assessment_adapters_under_system_ck CHECK (left(adapter_id, length(system_id) + 1) = system_id || '.'),
  -- an adapter derived from a generation profile is never the certified one
  CONSTRAINT assessment_adapters_certified_source_ck CHECK (status = 'PROVISIONAL' OR source = 'EA1_COMPONENT_PROFILE')
);

CREATE TABLE IF NOT EXISTS public.assessment_construct_core_applicability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  core_id uuid NOT NULL REFERENCES public.assessment_construct_cores(id) ON DELETE RESTRICT,
  -- the registered system the component belongs to
  system_profile_id text NOT NULL REFERENCES public.assessment_systems(system_id) ON DELETE RESTRICT,
  adapter_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('SUPPORTED', 'CONDITIONAL', 'NOT_APPLICABLE')),
  reason text,
  constraints jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(constraints) = 'array'),
  basis jsonb NOT NULL CHECK (jsonb_typeof(basis) = 'object'),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assessment_construct_core_applicability_uq UNIQUE (core_id, adapter_id),
  -- a conditional or negative answer always says why; a conditional one always says under which constraints
  CONSTRAINT assessment_construct_core_applicability_reason_ck CHECK (status = 'SUPPORTED' OR (reason IS NOT NULL AND length(reason) >= 10)),
  CONSTRAINT assessment_construct_core_applicability_constraints_ck CHECK ((status = 'CONDITIONAL') = (jsonb_array_length(constraints) > 0))
);

CREATE TABLE IF NOT EXISTS public.assessment_instance_renderers (
  renderer_version text PRIMARY KEY,
  construct text NOT NULL,
  strategy text NOT NULL CHECK (strategy IN ('PARAMETRIC_DETERMINISTIC', 'CERTIFIED_TEMPLATE_COMPOSITION')),
  status text NOT NULL DEFAULT 'PROVISIONAL' CHECK (status IN ('PROVISIONAL', 'CERTIFIED')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.assessment_item_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  core_id uuid NOT NULL REFERENCES public.assessment_construct_cores(id) ON DELETE RESTRICT,
  primary_concept_stable_id text NOT NULL,
  adaptation_specification_id text NOT NULL CHECK (adaptation_specification_id ~ '^[a-f0-9]{64}$'),
  system_id text NOT NULL,
  system_version_id text NOT NULL,
  adapter_id text NOT NULL,
  adapter_version text NOT NULL,
  blueprint_bucket_id text NOT NULL,
  seed text NOT NULL,
  parameter_set_id text NOT NULL CHECK (parameter_set_id ~ '^[a-f0-9]{64}$'),
  renderer_version text NOT NULL REFERENCES public.assessment_instance_renderers(renderer_version) ON DELETE RESTRICT,
  certification_version text NOT NULL,
  learner jsonb NOT NULL CHECK (jsonb_typeof(learner) = 'object'),
  answer_key jsonb NOT NULL CHECK (jsonb_typeof(answer_key) = 'object'),
  rubric jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(rubric) = 'array'),
  -- how a response to THIS instance is judged (forms, separators, units, rounding, tolerance, partial credit): the instance's, never the core's
  response_policy jsonb NOT NULL CHECK (jsonb_typeof(response_policy) = 'object' AND response_policy ? 'kind'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (adapter_id, adapter_version) REFERENCES public.assessment_adapters(adapter_id, adapter_version) ON DELETE RESTRICT,
  FOREIGN KEY (system_id, system_version_id) REFERENCES public.assessment_system_versions(system_id, version_id) ON DELETE RESTRICT,
  -- one instance per controlled input: the same render is never stored twice
  CONSTRAINT assessment_item_instances_uq UNIQUE (core_id, adapter_id, adapter_version, blueprint_bucket_id, parameter_set_id, renderer_version)
);
CREATE INDEX IF NOT EXISTS assessment_item_instances_bucket_idx ON public.assessment_item_instances (blueprint_bucket_id, adapter_id);

CREATE OR REPLACE FUNCTION public.assessment_item_instance_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  core public.assessment_construct_cores%ROWTYPE;
  applicability_status text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'ITEM_INSTANCE_IS_IMMUTABLE' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO core FROM public.assessment_construct_cores WHERE id = NEW.core_id;
  IF core.lifecycle IS DISTINCT FROM 'CERTIFIED' THEN
    RAISE EXCEPTION 'INSTANCE_NEEDS_A_CERTIFIED_CORE: core is %', COALESCE(core.lifecycle, 'missing') USING ERRCODE = 'check_violation';
  END IF;
  IF core.certification_version IS DISTINCT FROM NEW.certification_version THEN
    RAISE EXCEPTION 'INSTANCE_CERTIFICATION_VERSION_MISMATCH' USING ERRCODE = 'check_violation';
  END IF;
  IF core.primary_concept_stable_id IS DISTINCT FROM NEW.primary_concept_stable_id THEN
    RAISE EXCEPTION 'INSTANCE_CONCEPT_IS_NOT_THE_CORE_CONCEPT' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.assessment_adapters a WHERE a.adapter_id = NEW.adapter_id AND a.adapter_version = NEW.adapter_version AND a.status = 'CERTIFIED') THEN
    RAISE EXCEPTION 'INSTANCE_NEEDS_A_CERTIFIED_ADAPTER' USING ERRCODE = 'check_violation';
  END IF;
  -- the lineage names the system version the adapter really belongs to, and that version is in force
  IF NOT EXISTS (SELECT 1 FROM public.assessment_adapters a WHERE a.adapter_id = NEW.adapter_id AND a.adapter_version = NEW.adapter_version AND a.system_id = NEW.system_id AND a.system_version_id = NEW.system_version_id) THEN
    RAISE EXCEPTION 'INSTANCE_SYSTEM_IS_NOT_THE_ADAPTER_SYSTEM' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.assessment_systems s JOIN public.assessment_system_versions v ON v.system_id = s.system_id
                  WHERE s.system_id = NEW.system_id AND v.version_id = NEW.system_version_id AND s.lifecycle = 'ACTIVE' AND v.lifecycle = 'ACTIVE') THEN
    RAISE EXCEPTION 'INSTANCE_NEEDS_AN_ACTIVE_SYSTEM_VERSION' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.assessment_instance_renderers r WHERE r.renderer_version = NEW.renderer_version AND r.status = 'CERTIFIED') THEN
    RAISE EXCEPTION 'INSTANCE_NEEDS_A_CERTIFIED_RENDERER' USING ERRCODE = 'check_violation';
  END IF;
  SELECT status INTO applicability_status FROM public.assessment_construct_core_applicability WHERE core_id = NEW.core_id AND adapter_id = NEW.adapter_id;
  IF applicability_status IS NULL THEN
    RAISE EXCEPTION 'INSTANCE_HAS_NO_EXPLICIT_APPLICABILITY' USING ERRCODE = 'check_violation';
  END IF;
  IF applicability_status = 'NOT_APPLICABLE' THEN
    RAISE EXCEPTION 'INSTANCE_OF_A_NOT_APPLICABLE_COMBINATION' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_assessment_item_instance_guard ON public.assessment_item_instances;
CREATE TRIGGER trg_assessment_item_instance_guard BEFORE INSERT OR UPDATE ON public.assessment_item_instances
  FOR EACH ROW EXECUTE FUNCTION public.assessment_item_instance_guard();

-- Existing bank content: LEGACY until explicitly linked to an instance. The default classifies every current row.
ALTER TABLE public.question_bank_items
  ADD COLUMN IF NOT EXISTS lineage_class text NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN IF NOT EXISTS item_instance_id uuid REFERENCES public.assessment_item_instances(id) ON DELETE RESTRICT;
ALTER TABLE public.question_bank_items DROP CONSTRAINT IF EXISTS question_bank_items_lineage_ck;
ALTER TABLE public.question_bank_items
  ADD CONSTRAINT question_bank_items_lineage_ck CHECK (lineage_class IN ('LEGACY', 'CORE_DERIVED') AND (lineage_class = 'CORE_DERIVED') = (item_instance_id IS NOT NULL));

-- The ONLY inventory a Student may be supplied from: instances whose core, adapter, renderer and applicability are
-- certified / supported NOW and whose assessment system and version are ACTIVE. A core, a system or a version
-- retired after an instance was stored takes its instances out of supply.
CREATE OR REPLACE VIEW public.student_eligible_item_instances AS
SELECT i.*
  FROM public.assessment_item_instances i
  JOIN public.assessment_construct_cores c ON c.id = i.core_id AND c.lifecycle = 'CERTIFIED' AND c.certification_version = i.certification_version
  JOIN public.assessment_systems s ON s.system_id = i.system_id AND s.lifecycle = 'ACTIVE'
  JOIN public.assessment_system_versions v ON v.system_id = i.system_id AND v.version_id = i.system_version_id AND v.lifecycle = 'ACTIVE'
  JOIN public.assessment_adapters a ON a.adapter_id = i.adapter_id AND a.adapter_version = i.adapter_version AND a.status = 'CERTIFIED'
  JOIN public.assessment_instance_renderers r ON r.renderer_version = i.renderer_version AND r.status = 'CERTIFIED'
  JOIN public.assessment_construct_core_applicability p ON p.core_id = i.core_id AND p.adapter_id = i.adapter_id AND p.status IN ('SUPPORTED', 'CONDITIONAL');
