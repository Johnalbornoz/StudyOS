-- B2-B1 / migration 5 of 8 -- pool membership (ADDITIVE).
--
-- A pool is what a piece of reviewed content is RESERVED for: PRACTICE, DIAGNOSTIC, VERIFICATION,
-- REDUCED_MOCK, FULL_MOCK_1, FULL_MOCK_2. Membership is on the identity (an item, or a stimulus), not on
-- a version. The Question Bank writes it; B2 reads it.
--
-- Pilot policy ZERO_INTENTIONAL_OVERLAP: a subject has at most one active membership. A stimulus-bound
-- item has no membership of its own -- it is in the pool of its stimulus, so a group is in one pool as a
-- whole and can never be split across pools.
--
-- No membership is created for any existing item: an item without one is in no pool and cannot be used
-- by a protected form.
--
-- Rollback (only while empty): DROP TABLE public.question_bank_pool_memberships;
--   DROP FUNCTION public.question_bank_pool_membership_guard(), public.question_bank_item_stimulus_pool_guard();
--   DELETE FROM schema_migrations WHERE version = '20261110_1400';

CREATE TABLE public.question_bank_pool_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_item_id uuid REFERENCES public.question_bank_items(id),
  stimulus_id uuid REFERENCES public.question_bank_stimuli(id),
  pool text NOT NULL CHECK (pool IN ('PRACTICE', 'DIAGNOSTIC', 'VERIFICATION', 'REDUCED_MOCK', 'FULL_MOCK_1', 'FULL_MOCK_2')),
  policy_id text NOT NULL CHECK (length(btrim(policy_id)) > 0),
  policy_version text NOT NULL CHECK (length(btrim(policy_version)) > 0),
  assigned_by uuid NOT NULL REFERENCES public.users(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  retire_reason text,
  CONSTRAINT question_bank_pool_memberships_one_subject CHECK ((bank_item_id IS NULL) <> (stimulus_id IS NULL)),
  CONSTRAINT question_bank_pool_memberships_retired_reason CHECK (retired_at IS NULL OR retire_reason IS NOT NULL)
);
-- ZERO_INTENTIONAL_OVERLAP. A later multi-pool policy widens these two indexes to include `pool`.
CREATE UNIQUE INDEX question_bank_pool_memberships_item_active ON public.question_bank_pool_memberships (bank_item_id) WHERE bank_item_id IS NOT NULL AND retired_at IS NULL;
CREATE UNIQUE INDEX question_bank_pool_memberships_stimulus_active ON public.question_bank_pool_memberships (stimulus_id) WHERE stimulus_id IS NOT NULL AND retired_at IS NULL;
CREATE INDEX question_bank_pool_memberships_pool ON public.question_bank_pool_memberships (pool) WHERE retired_at IS NULL;

CREATE FUNCTION public.question_bank_pool_membership_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'QUESTION_BANK_POOL_MEMBERSHIP_NO_DELETE: retire membership % instead', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    -- A membership is retired, never rewritten: moving content to another pool is a new row.
    IF OLD.retired_at IS NOT NULL OR NEW.retired_at IS NULL
       OR (to_jsonb(NEW) - 'retired_at' - 'retire_reason') IS DISTINCT FROM (to_jsonb(OLD) - 'retired_at' - 'retire_reason') THEN
      RAISE EXCEPTION 'QUESTION_BANK_POOL_MEMBERSHIP_APPEND_ONLY: membership % can only be retired', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  -- An item bound to a stimulus is in its stimulus's pool and has none of its own.
  IF NEW.bank_item_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.question_bank_item_stimulus s JOIN public.approved_items ai ON ai.id = s.approved_item_id
        WHERE ai.bank_item_id = NEW.bank_item_id AND ai.bank_lifecycle_status NOT IN ('SUPERSEDED', 'REJECTED', 'RETIRED')) THEN
    RAISE EXCEPTION 'QUESTION_BANK_POOL_ITEM_INHERITS_STIMULUS_POOL: item % belongs to a stimulus', NEW.bank_item_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_question_bank_pool_membership_guard BEFORE INSERT OR UPDATE OR DELETE ON public.question_bank_pool_memberships
  FOR EACH ROW EXECUTE FUNCTION public.question_bank_pool_membership_guard();

-- The other direction: an item that already has its own pool cannot be bound to a stimulus.
CREATE FUNCTION public.question_bank_item_stimulus_pool_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.question_bank_pool_memberships m JOIN public.approved_items ai ON ai.bank_item_id = m.bank_item_id
              WHERE ai.id = NEW.approved_item_id AND m.retired_at IS NULL) THEN
    RAISE EXCEPTION 'QUESTION_BANK_POOL_CONFLICT: the item of version % has its own pool; retire it before binding the item to a stimulus', NEW.approved_item_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_question_bank_item_stimulus_pool_guard BEFORE INSERT ON public.question_bank_item_stimulus
  FOR EACH ROW EXECUTE FUNCTION public.question_bank_item_stimulus_pool_guard();
