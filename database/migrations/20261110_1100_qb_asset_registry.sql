-- B2-B1 / migration 2 of 8 -- authored asset registry (ADDITIVE).
--
-- Figures, graphs and images that belong to authored content. Provider-agnostic: the row says where the
-- bytes are (provider + storage key) and what they are (hash, media type, size, dimensions). The bytes are
-- not stored here. exam_media_objects is NOT reused: it holds a Student's uploads, is owned by a Student
-- and is purged with one; authored assets have no Student owner.
--
-- An asset is never deleted, and its bytes are fixed once it leaves DRAFT: a changed figure is a new asset.
-- No asset is created by this migration.
--
-- Rollback (only while empty): DROP TABLE public.question_bank_item_assets; DROP TABLE public.question_bank_assets;
--   DROP FUNCTION public.question_bank_asset_guard(); DROP FUNCTION public.question_bank_item_asset_guard();
--   DELETE FROM schema_migrations WHERE version = '20261110_1100';

CREATE TABLE public.question_bank_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_key text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('DIAGRAM', 'GRAPH', 'CHART', 'IMAGE', 'DATA_VISUALISATION')),
  provenance text NOT NULL CHECK (provenance IN ('OFFICIAL', 'LICENSED', 'STUDYUS_GENERATED', 'STUDYUS_AUTHORED', 'FIXTURE')),
  storage_provider text NOT NULL CHECK (length(btrim(storage_provider)) > 0),
  storage_key text NOT NULL CHECK (length(btrim(storage_key)) > 0),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  media_type text NOT NULL CHECK (media_type ~ '^[a-z]+/[a-z0-9.+-]+$'),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  width integer CHECK (width IS NULL OR width > 0),
  height integer CHECK (height IS NULL OR height > 0),
  -- { "<language>": "<text alternative>" }
  alt_text jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(alt_text) = 'object'),
  lifecycle_status text NOT NULL DEFAULT 'DRAFT' CHECK (lifecycle_status IN ('DRAFT', 'ACTIVE', 'RETIRED')),
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (storage_provider, storage_key),
  -- An asset in use has a text alternative.
  CONSTRAINT question_bank_assets_active_alt_text CHECK (lifecycle_status <> 'ACTIVE' OR alt_text <> '{}'::jsonb)
);

CREATE FUNCTION public.question_bank_asset_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'QUESTION_BANK_ASSET_NO_DELETE: asset % is retired, never deleted', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.asset_key IS DISTINCT FROM NEW.asset_key OR OLD.provenance IS DISTINCT FROM NEW.provenance OR OLD.created_by IS DISTINCT FROM NEW.created_by THEN
    RAISE EXCEPTION 'QUESTION_BANK_ASSET_IDENTITY_IMMUTABLE: asset %', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.lifecycle_status <> 'DRAFT' THEN
    IF OLD.storage_provider IS DISTINCT FROM NEW.storage_provider OR OLD.storage_key IS DISTINCT FROM NEW.storage_key
       OR OLD.sha256 IS DISTINCT FROM NEW.sha256 OR OLD.media_type IS DISTINCT FROM NEW.media_type OR OLD.size_bytes IS DISTINCT FROM NEW.size_bytes
       OR OLD.width IS DISTINCT FROM NEW.width OR OLD.height IS DISTINCT FROM NEW.height OR OLD.kind IS DISTINCT FROM NEW.kind THEN
      RAISE EXCEPTION 'QUESTION_BANK_ASSET_IMMUTABLE: asset % left DRAFT; register a new asset instead', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.lifecycle_status = 'DRAFT' OR (OLD.lifecycle_status = 'RETIRED' AND NEW.lifecycle_status <> 'RETIRED') THEN
      RAISE EXCEPTION 'QUESTION_BANK_ASSET_INVALID_TRANSITION: % -> %', OLD.lifecycle_status, NEW.lifecycle_status USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER trg_question_bank_asset_guard BEFORE UPDATE OR DELETE ON public.question_bank_assets
  FOR EACH ROW EXECUTE FUNCTION public.question_bank_asset_guard();

-- An asset used directly by one item version (a figure in the stem or in an option).
CREATE TABLE public.question_bank_item_assets (
  approved_item_id uuid NOT NULL REFERENCES public.approved_items(id),
  asset_id uuid NOT NULL REFERENCES public.question_bank_assets(id),
  role text NOT NULL CHECK (role IN ('STEM', 'OPTION', 'EXPLANATION')),
  position integer NOT NULL CHECK (position >= 1),
  PRIMARY KEY (approved_item_id, asset_id, role),
  UNIQUE (approved_item_id, role, position)
);
CREATE INDEX question_bank_item_assets_asset ON public.question_bank_item_assets (asset_id);

-- The assets of a version are part of the version: fixed once it is beyond review.
CREATE FUNCTION public.question_bank_item_asset_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.approved_item_id ELSE NEW.approved_item_id END;
  st text;
  is_bank boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'QUESTION_BANK_ITEM_ASSET_NO_UPDATE: remove and re-attach instead' USING ERRCODE = 'check_violation';
  END IF;
  SELECT bank_lifecycle_status, bank_item_id IS NOT NULL INTO st, is_bank FROM public.approved_items WHERE id = target;
  IF NOT coalesce(is_bank, false) THEN
    RAISE EXCEPTION 'QUESTION_BANK_ITEM_ASSET_NEEDS_BANK_VERSION: %', target USING ERRCODE = 'check_violation';
  END IF;
  IF st IN ('ACTIVE', 'CALIBRATED', 'SUSPENDED', 'RETIRED', 'SUPERSEDED', 'REJECTED') THEN
    RAISE EXCEPTION 'QUESTION_BANK_ITEM_ASSET_FROZEN: version % is %', target, st USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER trg_question_bank_item_asset_guard BEFORE INSERT OR UPDATE OR DELETE ON public.question_bank_item_assets
  FOR EACH ROW EXECUTE FUNCTION public.question_bank_item_asset_guard();
