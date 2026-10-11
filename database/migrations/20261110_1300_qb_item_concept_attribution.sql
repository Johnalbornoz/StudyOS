-- B2-B1 / migration 4 of 8 -- item version -> canonical concept attribution (ADDITIVE).
--
-- What a question is evidence OF, decided by a reviewer and stored on the item VERSION:
--   PRIMARY     the one concept a correct answer is direct evidence of. At most one per version.
--   SUPPORTING  a concept the question also draws on. It never satisfies a direct-evidence requirement.
-- There is no weight. A version with no PRIMARY row is unattributed (legacy): the contract keeps deriving
-- its concepts from the objective mapping and never reports them as direct.
--
-- Context tags are a separate table on purpose: they describe the setting of a question (a text about
-- ecology in a reading item) and are read by no eligibility, selection or evidence code.
--
-- No attribution is created for any existing item.
--
-- Rollback (only while empty): DROP TABLE public.question_bank_item_context_tags, public.question_bank_item_concepts;
--   DROP FUNCTION public.question_bank_item_concept_guard(); DELETE FROM schema_migrations WHERE version = '20261110_1300';

CREATE TABLE public.question_bank_item_concepts (
  approved_item_id uuid NOT NULL REFERENCES public.approved_items(id),
  canonical_concept_id uuid NOT NULL REFERENCES public.canonical_concepts(id),
  role text NOT NULL CHECK (role IN ('PRIMARY', 'SUPPORTING')),
  attributed_by uuid NOT NULL REFERENCES public.users(id),
  attributed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (approved_item_id, canonical_concept_id)
);
CREATE UNIQUE INDEX question_bank_item_concepts_one_primary ON public.question_bank_item_concepts (approved_item_id) WHERE role = 'PRIMARY';
CREATE INDEX question_bank_item_concepts_concept ON public.question_bank_item_concepts (canonical_concept_id, role);

CREATE TABLE public.question_bank_item_context_tags (
  approved_item_id uuid NOT NULL REFERENCES public.approved_items(id),
  canonical_concept_id uuid NOT NULL REFERENCES public.canonical_concepts(id),
  tagged_by uuid NOT NULL REFERENCES public.users(id),
  tagged_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (approved_item_id, canonical_concept_id)
);

-- Attribution is reviewed content: it can be settled while the version is under review (PILOT included)
-- and is fixed once the version is in use or closed.
CREATE FUNCTION public.question_bank_item_concept_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.approved_item_id ELSE NEW.approved_item_id END;
  st text;
  is_bank boolean;
BEGIN
  SELECT bank_lifecycle_status, bank_item_id IS NOT NULL INTO st, is_bank FROM public.approved_items WHERE id = target;
  IF NOT coalesce(is_bank, false) THEN
    RAISE EXCEPTION 'QUESTION_BANK_ATTRIBUTION_NEEDS_BANK_VERSION: %', target USING ERRCODE = 'check_violation';
  END IF;
  IF st IN ('ACTIVE', 'CALIBRATED', 'SUSPENDED', 'RETIRED', 'SUPERSEDED', 'REJECTED') THEN
    RAISE EXCEPTION 'QUESTION_BANK_ATTRIBUTION_FROZEN: version % is %; attribute a new version instead', target, st USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (OLD.approved_item_id IS DISTINCT FROM NEW.approved_item_id OR OLD.canonical_concept_id IS DISTINCT FROM NEW.canonical_concept_id) THEN
    RAISE EXCEPTION 'QUESTION_BANK_ATTRIBUTION_KEY_IMMUTABLE' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP <> 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.canonical_concepts c WHERE c.id = NEW.canonical_concept_id AND c.status = 'ACTIVE') THEN
    RAISE EXCEPTION 'QUESTION_BANK_ATTRIBUTION_CONCEPT_NOT_ACTIVE: %', NEW.canonical_concept_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER trg_question_bank_item_concept_guard BEFORE INSERT OR UPDATE OR DELETE ON public.question_bank_item_concepts
  FOR EACH ROW EXECUTE FUNCTION public.question_bank_item_concept_guard();
