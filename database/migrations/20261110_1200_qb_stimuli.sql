-- B2-B1 / migration 3 of 8 -- stimuli, stimulus versions, ordered parts, item version -> stimulus version (ADDITIVE).
--
-- A stimulus is shared content several questions are asked about: a passage, a pair of passages, a poem,
-- a numbered text, a draft paragraph, a table, a graph, a figure, a data set, or a composite of those.
-- Same identity / version split as items:
--   question_bank_stimuli            the identity (key, kind, language, provenance)
--   question_bank_stimulus_versions  one immutable version of its content
--   question_bank_stimulus_parts     the ordered parts of a version (passage A, passage B; text, graph, note)
--   question_bank_item_stimulus      which stimulus version an item version is asked about (none or one)
-- Two questions share a stimulus when their rows point at versions of the same stimulus: derivable
-- without reading item content.
--
-- A version is editable only while DRAFT. From then on its content and its parts are fixed; a correction
-- is a new version. Stimuli and versions are never deleted.
--
-- Nothing is migrated: the inline `content.stimulus.key` of existing items stays where it is, and those
-- items stay standalone. No stimulus is created by this migration.
--
-- Rollback (only while empty): DROP TABLE public.question_bank_item_stimulus, public.question_bank_stimulus_parts,
--   public.question_bank_stimulus_versions, public.question_bank_stimuli CASCADE;
--   DROP FUNCTION public.question_bank_stimulus_guard(), public.question_bank_stimulus_version_guard(),
--   public.question_bank_stimulus_part_guard(), public.question_bank_item_stimulus_guard();
--   DELETE FROM schema_migrations WHERE version = '20261110_1200';

CREATE TABLE public.question_bank_stimuli (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stimulus_key text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('PASSAGE', 'PAIRED_PASSAGE', 'POEM', 'NUMBERED_TEXT', 'DRAFT_PARAGRAPH', 'TABLE', 'GRAPH', 'FIGURE', 'DATA_SET', 'COMPOSITE')),
  language text NOT NULL,
  provenance text NOT NULL CHECK (provenance IN ('OFFICIAL', 'LICENSED', 'STUDYUS_GENERATED', 'STUDYUS_AUTHORED', 'FIXTURE')),
  current_version_id uuid,
  retired_at timestamptz,
  retire_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT question_bank_stimuli_retired_reason CHECK (retired_at IS NULL OR retire_reason IS NOT NULL)
);

CREATE TABLE public.question_bank_stimulus_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stimulus_id uuid NOT NULL REFERENCES public.question_bank_stimuli(id),
  version_number integer NOT NULL CHECK (version_number >= 1),
  lifecycle_status text NOT NULL DEFAULT 'DRAFT'
    CHECK (lifecycle_status IN ('DRAFT', 'REVIEW_REQUIRED', 'ACTIVE', 'SUSPENDED', 'REJECTED', 'RETIRED', 'SUPERSEDED')),
  content_hash text,
  topic_line text,
  -- How many of its questions a form may take. Both NULL = the group is taken whole.
  selection_min_items integer,
  selection_max_items integer,
  supersedes_version_id uuid REFERENCES public.question_bank_stimulus_versions(id),
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  frozen_at timestamptz,
  lifecycle_updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (stimulus_id, version_number),
  CONSTRAINT question_bank_stimulus_versions_selection CHECK (
    (selection_min_items IS NULL AND selection_max_items IS NULL)
    OR (selection_min_items IS NOT NULL AND selection_max_items IS NOT NULL AND selection_min_items >= 1 AND selection_max_items >= selection_min_items)),
  -- Beyond DRAFT a version is frozen and carries the hash of what was frozen.
  CONSTRAINT question_bank_stimulus_versions_frozen CHECK (
    (lifecycle_status = 'DRAFT' AND frozen_at IS NULL)
    OR (lifecycle_status <> 'DRAFT' AND frozen_at IS NOT NULL AND content_hash IS NOT NULL))
);
CREATE INDEX question_bank_stimulus_versions_stimulus ON public.question_bank_stimulus_versions (stimulus_id);
ALTER TABLE public.question_bank_stimuli ADD CONSTRAINT question_bank_stimuli_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES public.question_bank_stimulus_versions(id);

CREATE TABLE public.question_bank_stimulus_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stimulus_version_id uuid NOT NULL REFERENCES public.question_bank_stimulus_versions(id),
  position integer NOT NULL CHECK (position >= 1),
  label text,
  part_kind text NOT NULL CHECK (part_kind IN ('TEXT', 'NUMBERED_TEXT', 'VERSE', 'TABLE', 'GRAPH', 'FIGURE', 'DATA_SET', 'SOURCE_NOTE')),
  -- Structured content: paragraphs, numbered statements, table cells. Never a rendered image of text.
  body jsonb CHECK (body IS NULL OR jsonb_typeof(body) = 'object'),
  asset_id uuid REFERENCES public.question_bank_assets(id),
  UNIQUE (stimulus_version_id, position),
  CONSTRAINT question_bank_stimulus_parts_has_content CHECK (body IS NOT NULL OR asset_id IS NOT NULL)
);
CREATE UNIQUE INDEX question_bank_stimulus_parts_label ON public.question_bank_stimulus_parts (stimulus_version_id, label) WHERE label IS NOT NULL;
CREATE INDEX question_bank_stimulus_parts_asset ON public.question_bank_stimulus_parts (asset_id) WHERE asset_id IS NOT NULL;

CREATE TABLE public.question_bank_item_stimulus (
  approved_item_id uuid PRIMARY KEY REFERENCES public.approved_items(id),
  stimulus_version_id uuid NOT NULL REFERENCES public.question_bank_stimulus_versions(id),
  -- Order of the question inside its group.
  position integer NOT NULL CHECK (position >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (stimulus_version_id, position)
);

-- Identity ------------------------------------------------------------------------------------------------
CREATE FUNCTION public.question_bank_stimulus_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'QUESTION_BANK_STIMULUS_NO_DELETE: stimulus % is retired, never deleted', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.stimulus_key IS DISTINCT FROM NEW.stimulus_key OR OLD.kind IS DISTINCT FROM NEW.kind
     OR OLD.language IS DISTINCT FROM NEW.language OR OLD.provenance IS DISTINCT FROM NEW.provenance THEN
    RAISE EXCEPTION 'QUESTION_BANK_STIMULUS_IDENTITY_IMMUTABLE: stimulus %', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.current_version_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.question_bank_stimulus_versions v WHERE v.id = NEW.current_version_id AND v.stimulus_id = NEW.id) THEN
    RAISE EXCEPTION 'QUESTION_BANK_STIMULUS_CURRENT_VERSION_FOREIGN: stimulus %', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER trg_question_bank_stimulus_guard BEFORE UPDATE OR DELETE ON public.question_bank_stimuli
  FOR EACH ROW EXECUTE FUNCTION public.question_bank_stimulus_guard();

-- Version -------------------------------------------------------------------------------------------------
CREATE FUNCTION public.question_bank_stimulus_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'QUESTION_BANK_STIMULUS_VERSION_NO_DELETE: version %', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.stimulus_id IS DISTINCT FROM NEW.stimulus_id OR OLD.version_number IS DISTINCT FROM NEW.version_number OR OLD.created_by IS DISTINCT FROM NEW.created_by THEN
    RAISE EXCEPTION 'QUESTION_BANK_STIMULUS_VERSION_IMMUTABLE: version %', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.lifecycle_status <> 'DRAFT' THEN
    IF OLD.content_hash IS DISTINCT FROM NEW.content_hash OR OLD.topic_line IS DISTINCT FROM NEW.topic_line
       OR OLD.selection_min_items IS DISTINCT FROM NEW.selection_min_items OR OLD.selection_max_items IS DISTINCT FROM NEW.selection_max_items
       OR OLD.frozen_at IS DISTINCT FROM NEW.frozen_at OR OLD.supersedes_version_id IS DISTINCT FROM NEW.supersedes_version_id THEN
      RAISE EXCEPTION 'QUESTION_BANK_STIMULUS_VERSION_IMMUTABLE: version % left DRAFT; create a new version instead', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.lifecycle_status = 'DRAFT' OR OLD.lifecycle_status IN ('REJECTED', 'RETIRED', 'SUPERSEDED') AND NEW.lifecycle_status <> OLD.lifecycle_status THEN
      RAISE EXCEPTION 'QUESTION_BANK_STIMULUS_INVALID_TRANSITION: % -> %', OLD.lifecycle_status, NEW.lifecycle_status USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.lifecycle_status <> 'DRAFT' THEN
    -- Leaving DRAFT freezes the version. It must have something to freeze.
    IF NOT EXISTS (SELECT 1 FROM public.question_bank_stimulus_parts p WHERE p.stimulus_version_id = OLD.id) THEN
      RAISE EXCEPTION 'QUESTION_BANK_STIMULUS_VERSION_EMPTY: version % has no part', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    NEW.frozen_at := now();
  END IF;
  IF OLD.lifecycle_status IS DISTINCT FROM NEW.lifecycle_status THEN
    NEW.lifecycle_updated_at := now();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_question_bank_stimulus_version_guard BEFORE UPDATE OR DELETE ON public.question_bank_stimulus_versions
  FOR EACH ROW EXECUTE FUNCTION public.question_bank_stimulus_version_guard();

-- A version is born a draft.
CREATE FUNCTION public.question_bank_stimulus_version_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.lifecycle_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'QUESTION_BANK_STIMULUS_VERSION_STARTS_DRAFT' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_question_bank_stimulus_version_insert_guard BEFORE INSERT ON public.question_bank_stimulus_versions
  FOR EACH ROW EXECUTE FUNCTION public.question_bank_stimulus_version_insert_guard();

-- Parts ---------------------------------------------------------------------------------------------------
CREATE FUNCTION public.question_bank_stimulus_part_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  st text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    SELECT lifecycle_status INTO st FROM public.question_bank_stimulus_versions WHERE id = OLD.stimulus_version_id;
    IF st <> 'DRAFT' THEN
      RAISE EXCEPTION 'QUESTION_BANK_STIMULUS_VERSION_IMMUTABLE: version % is %; its parts are fixed', OLD.stimulus_version_id, st USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    SELECT lifecycle_status INTO st FROM public.question_bank_stimulus_versions WHERE id = NEW.stimulus_version_id;
    IF st <> 'DRAFT' THEN
      RAISE EXCEPTION 'QUESTION_BANK_STIMULUS_VERSION_IMMUTABLE: version % is %; its parts are fixed', NEW.stimulus_version_id, st USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER trg_question_bank_stimulus_part_guard BEFORE INSERT OR UPDATE OR DELETE ON public.question_bank_stimulus_parts
  FOR EACH ROW EXECUTE FUNCTION public.question_bank_stimulus_part_guard();

-- Item version -> stimulus version --------------------------------------------------------------------------
-- The link is part of the item version: fixed once the version is beyond review.
CREATE FUNCTION public.question_bank_item_stimulus_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.approved_item_id ELSE NEW.approved_item_id END;
  st text;
  is_bank boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'QUESTION_BANK_ITEM_STIMULUS_NO_UPDATE: remove and re-link instead' USING ERRCODE = 'check_violation';
  END IF;
  SELECT bank_lifecycle_status, bank_item_id IS NOT NULL INTO st, is_bank FROM public.approved_items WHERE id = target;
  IF NOT coalesce(is_bank, false) THEN
    RAISE EXCEPTION 'QUESTION_BANK_ITEM_STIMULUS_NEEDS_BANK_VERSION: %', target USING ERRCODE = 'check_violation';
  END IF;
  IF st IN ('ACTIVE', 'CALIBRATED', 'SUSPENDED', 'RETIRED', 'SUPERSEDED', 'REJECTED') THEN
    RAISE EXCEPTION 'QUESTION_BANK_ITEM_STIMULUS_FROZEN: version % is %', target, st USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER trg_question_bank_item_stimulus_guard BEFORE INSERT OR UPDATE OR DELETE ON public.question_bank_item_stimulus
  FOR EACH ROW EXECUTE FUNCTION public.question_bank_item_stimulus_guard();
