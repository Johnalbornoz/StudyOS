-- Curriculum convergence -- reviewed canonical concept aliases (ADDITIVE).
--
-- A Student names a concept in their own words ("Exponenciación"). The catalogue resolves that label to a
-- canonical concept on exactly two grounds, and on nothing else:
--   A. the label IS the canonical concept's name (existing rule, unchanged);
--   B. a REVIEWED ALIAS states that this label, in this canonical subject, means this canonical concept.
-- This table is ground B: explicit, reviewed, provenanced, versioned. No similarity, no embedding, no "nearest"
-- concept and no cross-subject match exists anywhere; a label with neither ground stays unresolved.
--
--   canonical_concept_aliases
--     canonical_concept_id   the concept the label means
--     canonical_subject_id   its canonical subject (kept equal by the guard): an alias only ever applies to a
--                            Student subject of the same name, exactly as rule A does
--     language, label        the reviewed label; normalized_label = lower(btrim(label)) is the lookup key
--     stable_concept_id      the governed language-neutral id of the concept, where one is certified (audit)
--     rationale, review_reference, reviewed_by, reviewed_at   who decided and on what record
--     version, status        ACTIVE | RETIRED; a correction is a new row, never an edit
--
-- One ACTIVE alias per (canonical subject, normalized label): a label never means two concepts.
-- A row is immutable except for its retirement.
--
-- concept_catalog_mapping: mapping_method gains REVIEWED_ALIAS and the row records which alias resolved it
-- (resolved_alias_id). No existing row is changed.
--
-- Rollback (only while no mapping uses an alias): ALTER TABLE public.concept_catalog_mapping DROP COLUMN resolved_alias_id;
--   ALTER TABLE public.concept_catalog_mapping DROP CONSTRAINT concept_catalog_mapping_method_check;
--   ALTER TABLE public.concept_catalog_mapping ADD CONSTRAINT concept_catalog_mapping_method_check CHECK (mapping_method IS NULL OR mapping_method IN ('EXACT_LABEL_MATCH', 'MANUAL_REVIEW', 'SEED_FIXTURE', 'TEACHER_ASSIGNMENT', 'PLAN_ENROLLMENT'));
--   DROP TABLE public.canonical_concept_aliases; DROP FUNCTION public.canonical_concept_alias_guard();
--   DELETE FROM schema_migrations WHERE version = '20261122_1100';

CREATE TABLE public.canonical_concept_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_concept_id uuid NOT NULL REFERENCES public.canonical_concepts(id),
  canonical_subject_id uuid NOT NULL REFERENCES public.canonical_subjects(id),
  language text NOT NULL,
  label text NOT NULL CHECK (btrim(label) <> ''),
  normalized_label text GENERATED ALWAYS AS (lower(btrim(label))) STORED,
  stable_concept_id text,
  rationale text NOT NULL CHECK (btrim(rationale) <> ''),
  review_reference text NOT NULL CHECK (btrim(review_reference) <> ''),
  reviewed_by uuid REFERENCES public.users(id),
  reviewed_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RETIRED')),
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX canonical_concept_aliases_one_active_label ON public.canonical_concept_aliases (canonical_subject_id, normalized_label) WHERE status = 'ACTIVE';
CREATE INDEX canonical_concept_aliases_concept ON public.canonical_concept_aliases (canonical_concept_id);

CREATE FUNCTION public.canonical_concept_alias_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  concept_subject uuid;
  concept_status text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- the only change a row admits is its retirement
    IF OLD.status = 'ACTIVE' AND NEW.status = 'RETIRED'
       AND (to_jsonb(NEW) - 'status' - 'retired_at') = (to_jsonb(OLD) - 'status' - 'retired_at') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'CANONICAL_CONCEPT_ALIAS_IMMUTABLE: % (a correction is a new version, never an edit)', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  SELECT cc.canonical_subject_id, cc.status INTO concept_subject, concept_status FROM public.canonical_concepts cc WHERE cc.id = NEW.canonical_concept_id;
  IF concept_subject IS DISTINCT FROM NEW.canonical_subject_id THEN
    RAISE EXCEPTION 'CANONICAL_CONCEPT_ALIAS_SUBJECT_MISMATCH: concept % is not of canonical subject %', NEW.canonical_concept_id, NEW.canonical_subject_id USING ERRCODE = 'check_violation';
  END IF;
  IF concept_status IS DISTINCT FROM 'ACTIVE' THEN
    RAISE EXCEPTION 'CANONICAL_CONCEPT_ALIAS_CONCEPT_NOT_ACTIVE: %', NEW.canonical_concept_id USING ERRCODE = 'check_violation';
  END IF;
  -- an alias never shadows a canonical name of the same subject (rule A always decides first)
  IF EXISTS (SELECT 1 FROM public.canonical_concepts cc WHERE cc.canonical_subject_id = NEW.canonical_subject_id AND lower(btrim(cc.name)) = lower(btrim(NEW.label)) AND cc.id <> NEW.canonical_concept_id) THEN
    RAISE EXCEPTION 'CANONICAL_CONCEPT_ALIAS_SHADOWS_CANONICAL_NAME: "%" is the name of another concept of the subject', NEW.label USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER trg_canonical_concept_alias_guard BEFORE INSERT OR UPDATE ON public.canonical_concept_aliases
  FOR EACH ROW EXECUTE FUNCTION public.canonical_concept_alias_guard();

ALTER TABLE public.concept_catalog_mapping DROP CONSTRAINT IF EXISTS concept_catalog_mapping_method_check;
ALTER TABLE public.concept_catalog_mapping ADD CONSTRAINT concept_catalog_mapping_method_check CHECK (
  mapping_method IS NULL OR mapping_method IN ('EXACT_LABEL_MATCH', 'MANUAL_REVIEW', 'SEED_FIXTURE', 'TEACHER_ASSIGNMENT', 'PLAN_ENROLLMENT', 'REVIEWED_ALIAS')
);
ALTER TABLE public.concept_catalog_mapping ADD COLUMN resolved_alias_id uuid REFERENCES public.canonical_concept_aliases(id);
ALTER TABLE public.concept_catalog_mapping ADD CONSTRAINT concept_catalog_mapping_alias_method_check CHECK ((mapping_method = 'REVIEWED_ALIAS') = (resolved_alias_id IS NOT NULL));
