-- B2-B1 / migration 8 of 8 -- frozen forms (ADDITIVE).
--
-- A frozen form is one fixed, ordered list of item VERSIONS assembled for a published blueprint variant:
-- the same form for every Student who sits it.
--   assessment_frozen_forms            the form: blueprint, fidelity, attempt type, pool, hash, status
--   assessment_frozen_form_positions   slot -> item version (and the stimulus version it is asked about)
--   exam_instances.frozen_form_id      the form an instance was started from. Nullable: every existing
--                                      instance keeps its own `form` JSON and stays valid without it.
-- No item content is stored in a form: it references immutable item versions.
-- A form is assembled as a DRAFT and is immutable, with its positions, once PUBLISHED.
-- No form is created by this migration and no instance is changed.
--
-- Rollback (only while no form exists): ALTER TABLE public.exam_instances DROP COLUMN frozen_form_id;
--   DROP TABLE public.assessment_frozen_form_positions, public.assessment_frozen_forms;
--   DROP FUNCTION public.assessment_frozen_form_guard(), public.assessment_frozen_form_position_guard();
--   DELETE FROM schema_migrations WHERE version = '20261110_1700';

CREATE TABLE public.assessment_frozen_forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blueprint_id uuid NOT NULL REFERENCES public.assessment_blueprints(id),
  fidelity text NOT NULL CHECK (fidelity IN ('FULL', 'REDUCED')),
  attempt_type text NOT NULL CHECK (attempt_type IN ('FULL_MOCK', 'REDUCED_MOCK')),
  pool text NOT NULL CHECK (pool IN ('REDUCED_MOCK', 'FULL_MOCK_1', 'FULL_MOCK_2')),
  form_hash text CHECK (form_hash IS NULL OR form_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
  frozen_at timestamptz,
  frozen_by uuid REFERENCES public.users(id),
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  retire_reason text,
  UNIQUE (form_hash),
  CONSTRAINT assessment_frozen_forms_fidelity_attempt CHECK ((fidelity = 'FULL' AND attempt_type = 'FULL_MOCK') OR (fidelity = 'REDUCED' AND attempt_type = 'REDUCED_MOCK')),
  CONSTRAINT assessment_frozen_forms_frozen CHECK (status = 'DRAFT' OR (frozen_at IS NOT NULL AND frozen_by IS NOT NULL AND form_hash IS NOT NULL)),
  CONSTRAINT assessment_frozen_forms_retired_reason CHECK (status <> 'RETIRED' OR (retired_at IS NOT NULL AND retire_reason IS NOT NULL))
);
CREATE UNIQUE INDEX assessment_frozen_forms_one_published ON public.assessment_frozen_forms (blueprint_id) WHERE status = 'PUBLISHED';
CREATE INDEX assessment_frozen_forms_blueprint ON public.assessment_frozen_forms (blueprint_id);

CREATE TABLE public.assessment_frozen_form_positions (
  form_id uuid NOT NULL REFERENCES public.assessment_frozen_forms(id),
  slot_index integer NOT NULL CHECK (slot_index >= 0),
  approved_item_id uuid NOT NULL REFERENCES public.approved_items(id),
  stimulus_version_id uuid REFERENCES public.question_bank_stimulus_versions(id),
  -- Order of the question inside its stimulus group.
  unit_position integer,
  PRIMARY KEY (form_id, slot_index),
  UNIQUE (form_id, approved_item_id),
  CONSTRAINT assessment_frozen_form_positions_unit CHECK ((stimulus_version_id IS NULL) = (unit_position IS NULL) AND (unit_position IS NULL OR unit_position >= 1))
);
CREATE INDEX assessment_frozen_form_positions_item ON public.assessment_frozen_form_positions (approved_item_id);

CREATE FUNCTION public.assessment_frozen_form_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  bp record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'ASSESSMENT_FROZEN_FORM_IMMUTABLE: form % is %; retire it instead', OLD.id, OLD.status USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  SELECT purpose, status, pool INTO bp FROM public.assessment_blueprints WHERE id = NEW.blueprint_id;
  IF bp.purpose IS NULL OR bp.purpose NOT IN ('FULL', 'REDUCED') OR bp.purpose <> NEW.fidelity THEN
    RAISE EXCEPTION 'ASSESSMENT_FROZEN_FORM_BLUEPRINT_MISMATCH: a % form needs a % blueprint variant', NEW.fidelity, NEW.fidelity USING ERRCODE = 'check_violation';
  END IF;
  IF bp.pool IS DISTINCT FROM NEW.pool THEN
    RAISE EXCEPTION 'ASSESSMENT_FROZEN_FORM_POOL_MISMATCH: form pool % is not the blueprint pool %', NEW.pool, bp.pool USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'ASSESSMENT_FROZEN_FORM_STARTS_DRAFT' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'RETIRED' THEN
    RAISE EXCEPTION 'ASSESSMENT_FROZEN_FORM_IMMUTABLE: form % is RETIRED', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'PUBLISHED' THEN
    -- The only thing a published form can do is retire.
    IF NEW.status <> 'RETIRED'
       OR (to_jsonb(NEW) - 'status' - 'retired_at' - 'retire_reason') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'retired_at' - 'retire_reason') THEN
      RAISE EXCEPTION 'ASSESSMENT_FROZEN_FORM_IMMUTABLE: form % is PUBLISHED', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.blueprint_id IS DISTINCT FROM NEW.blueprint_id THEN
    RAISE EXCEPTION 'ASSESSMENT_FROZEN_FORM_BLUEPRINT_IMMUTABLE: form %', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'PUBLISHED' THEN
    IF bp.status <> 'PUBLISHED' THEN
      RAISE EXCEPTION 'ASSESSMENT_FROZEN_FORM_NEEDS_PUBLISHED_BLUEPRINT: form %', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.assessment_frozen_form_positions p WHERE p.form_id = OLD.id) THEN
      RAISE EXCEPTION 'ASSESSMENT_FROZEN_FORM_EMPTY: form % has no position', OLD.id USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_assessment_frozen_form_guard BEFORE INSERT OR UPDATE OR DELETE ON public.assessment_frozen_forms
  FOR EACH ROW EXECUTE FUNCTION public.assessment_frozen_form_guard();

CREATE FUNCTION public.assessment_frozen_form_position_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  form uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.form_id ELSE NEW.form_id END;
  st text;
  linked uuid;
BEGIN
  SELECT status INTO st FROM public.assessment_frozen_forms WHERE id = form;
  IF st <> 'DRAFT' THEN
    RAISE EXCEPTION 'ASSESSMENT_FROZEN_FORM_IMMUTABLE: form % is %; its positions are fixed', form, st USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.form_id IS DISTINCT FROM NEW.form_id THEN
    RAISE EXCEPTION 'ASSESSMENT_FROZEN_FORM_POSITION_OWNER_IMMUTABLE' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.approved_items ai WHERE ai.id = NEW.approved_item_id AND ai.bank_item_id IS NOT NULL) THEN
    RAISE EXCEPTION 'ASSESSMENT_FROZEN_FORM_NEEDS_BANK_VERSION: % is not a Question Bank item version', NEW.approved_item_id USING ERRCODE = 'check_violation';
  END IF;
  SELECT stimulus_version_id INTO linked FROM public.question_bank_item_stimulus WHERE approved_item_id = NEW.approved_item_id;
  IF linked IS DISTINCT FROM NEW.stimulus_version_id THEN
    RAISE EXCEPTION 'ASSESSMENT_FROZEN_FORM_STIMULUS_MISMATCH: slot % does not carry the stimulus version its item version is asked about', NEW.slot_index USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_assessment_frozen_form_position_guard BEFORE INSERT OR UPDATE OR DELETE ON public.assessment_frozen_form_positions
  FOR EACH ROW EXECUTE FUNCTION public.assessment_frozen_form_position_guard();

ALTER TABLE public.exam_instances ADD COLUMN frozen_form_id uuid REFERENCES public.assessment_frozen_forms(id);
CREATE INDEX exam_instances_frozen_form ON public.exam_instances (frozen_form_id) WHERE frozen_form_id IS NOT NULL;
