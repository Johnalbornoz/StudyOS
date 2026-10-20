-- Question Bank V2 refinement: human certification, difficulty, usage eligibility,
-- exam alignment, Student exposure memory, demand-driven inventory (DEV -> Preview, never Production).
--
-- Strictly additive on top of 20261026_1000 (bank core) and 20261027_1000 (runtime settings):
-- nullable columns, one new table, one trigger, two relaxed / extended CHECKs. No content
-- rewritten, no historical attempt touched. NULL usage / alignment = a legacy row = every use
-- (exactly the behaviour before this migration), so versions created by paths that predate it
-- keep working unchanged.
--
--   approved_items.usage_eligibility    -- where a version may be used (PRACTICE, DIAGNOSTIC, QUIZ,
--                                           REDUCED_MOCK, FULL_MOCK, FORMAL_ASSESSMENT)
--   approved_items.exam_alignment       -- PRACTICE < EXAM_STYLE < MOCK_READY < OFFICIAL (separate from difficulty)
--   approved_items.validated_difficulty -- 1..5 set by the human reviewer (declared = content.difficulty,
--                                           observed = calibrated_difficulty from Student responses)
--   question_bank_reviews               -- the human certification record (Approve / Request correction / Reject)
--   exam_item_usage.delivery_use        -- what the exposure was for (PRACTICE / MOCK / ...)
--
-- Rollback (DEV / Preview only, manual, in this order):
--   DROP TRIGGER IF EXISTS trg_question_bank_quality_guard ON public.approved_items;
--   DROP FUNCTION IF EXISTS public.question_bank_quality_guard();
--   ALTER TABLE public.approved_items DROP CONSTRAINT IF EXISTS approved_items_usage_check,
--     DROP CONSTRAINT IF EXISTS approved_items_alignment_check, DROP CONSTRAINT IF EXISTS approved_items_mock_needs_alignment,
--     DROP CONSTRAINT IF EXISTS approved_items_validated_difficulty_check;
--   ALTER TABLE public.approved_items DROP COLUMN IF EXISTS usage_eligibility, DROP COLUMN IF EXISTS exam_alignment, DROP COLUMN IF EXISTS validated_difficulty;
--   ALTER TABLE public.exam_item_usage DROP COLUMN IF EXISTS delivery_use;
--   DROP TABLE IF EXISTS public.question_bank_reviews;
--   (the generation-request CHECKs may stay widened)
--   DELETE FROM public.schema_migrations WHERE version = '20261028_1000';
-- ---------------------------------------------------------------------

ALTER TABLE public.approved_items ADD COLUMN IF NOT EXISTS usage_eligibility text[];
ALTER TABLE public.approved_items ADD COLUMN IF NOT EXISTS exam_alignment text;
ALTER TABLE public.approved_items ADD COLUMN IF NOT EXISTS validated_difficulty integer;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approved_items_usage_check') THEN
    ALTER TABLE public.approved_items ADD CONSTRAINT approved_items_usage_check CHECK (usage_eligibility IS NULL OR (
      cardinality(usage_eligibility) >= 1 AND usage_eligibility <@ ARRAY['PRACTICE', 'DIAGNOSTIC', 'QUIZ', 'REDUCED_MOCK', 'FULL_MOCK', 'FORMAL_ASSESSMENT']::text[]));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approved_items_alignment_check') THEN
    ALTER TABLE public.approved_items ADD CONSTRAINT approved_items_alignment_check CHECK (exam_alignment IS NULL OR exam_alignment IN ('PRACTICE', 'EXAM_STYLE', 'MOCK_READY', 'OFFICIAL'));
  END IF;
  -- A mock (or formal assessment) never draws an item that is not at least mock-ready.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approved_items_mock_needs_alignment') THEN
    ALTER TABLE public.approved_items ADD CONSTRAINT approved_items_mock_needs_alignment CHECK (
      usage_eligibility IS NULL OR NOT (usage_eligibility && ARRAY['REDUCED_MOCK', 'FULL_MOCK', 'FORMAL_ASSESSMENT']::text[])
      OR exam_alignment IN ('MOCK_READY', 'OFFICIAL'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approved_items_validated_difficulty_check') THEN
    ALTER TABLE public.approved_items ADD CONSTRAINT approved_items_validated_difficulty_check CHECK (validated_difficulty IS NULL OR validated_difficulty BETWEEN 1 AND 5);
  END IF;
END $$;

-- --- Human certification record (append-only) ---
CREATE TABLE IF NOT EXISTS public.question_bank_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approved_item_id uuid NOT NULL REFERENCES public.approved_items(id),
  bank_item_id uuid NOT NULL REFERENCES public.question_bank_items(id),
  decision text NOT NULL,
  reviewed_by uuid NOT NULL REFERENCES public.users(id),
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  review_notes text,
  validated_difficulty integer,
  usage_eligibility text[],
  exam_alignment text,
  automated_validation jsonb,
  CONSTRAINT question_bank_reviews_decision_check CHECK (decision IN ('APPROVED', 'CORRECTION_REQUESTED', 'REJECTED')),
  CONSTRAINT question_bank_reviews_notes_for_non_approval CHECK (decision = 'APPROVED' OR (review_notes IS NOT NULL AND length(btrim(review_notes)) >= 5)),
  CONSTRAINT question_bank_reviews_difficulty_check CHECK (validated_difficulty IS NULL OR validated_difficulty BETWEEN 1 AND 5),
  CONSTRAINT question_bank_reviews_alignment_check CHECK (exam_alignment IS NULL OR exam_alignment IN ('PRACTICE', 'EXAM_STYLE', 'MOCK_READY', 'OFFICIAL'))
);
CREATE INDEX IF NOT EXISTS idx_question_bank_reviews_version ON public.question_bank_reviews (approved_item_id, reviewed_at DESC);

-- --- Quality guard: OFFICIAL needs official provenance; generated content needs a human approval to be ACTIVE ---
CREATE OR REPLACE FUNCTION public.question_bank_quality_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
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
END $$;
DROP TRIGGER IF EXISTS trg_question_bank_quality_guard ON public.approved_items;
CREATE TRIGGER trg_question_bank_quality_guard BEFORE INSERT OR UPDATE ON public.approved_items
  FOR EACH ROW EXECUTE FUNCTION public.question_bank_quality_guard();

-- --- Exposure memory: what each exposure was for ---
ALTER TABLE public.exam_item_usage ADD COLUMN IF NOT EXISTS delivery_use text;
CREATE INDEX IF NOT EXISTS idx_exam_item_usage_item_time ON public.exam_item_usage (approved_item_id, used_at DESC);
CREATE INDEX IF NOT EXISTS idx_exam_item_usage_student_item ON public.exam_item_usage (student_id, approved_item_id);

-- --- Demand-driven generation: a new reason, larger (chunked) batches ---
ALTER TABLE public.question_bank_generation_requests DROP CONSTRAINT IF EXISTS question_bank_generation_requests_reason_check;
ALTER TABLE public.question_bank_generation_requests ADD CONSTRAINT question_bank_generation_requests_reason_check
  CHECK (reason IN ('EMPTY', 'FORM_BLOCKER', 'LOW_VARIETY', 'LOW_CALIBRATION', 'MISCONCEPTION_COVERAGE', 'MANUAL_SMALL_BATCH', 'DEMAND_SHORTAGE'));
ALTER TABLE public.question_bank_generation_requests DROP CONSTRAINT IF EXISTS question_bank_generation_requests_count_check;
ALTER TABLE public.question_bank_generation_requests ADD CONSTRAINT question_bank_generation_requests_count_check CHECK (requested_count BETWEEN 1 AND 25);

-- --- Backfill (idempotent; only rows without a value) ---
-- Official / licensed / certification-fixture versions in service keep every use they have today.
UPDATE public.approved_items ai
   SET usage_eligibility = ARRAY['PRACTICE', 'DIAGNOSTIC', 'QUIZ', 'REDUCED_MOCK', 'FULL_MOCK']::text[],
       exam_alignment = CASE WHEN qi.provenance IN ('OFFICIAL', 'LICENSED') THEN 'OFFICIAL' ELSE 'MOCK_READY' END
  FROM public.question_bank_items qi
 WHERE qi.id = ai.bank_item_id AND ai.usage_eligibility IS NULL AND ai.exam_alignment IS NULL
   AND qi.provenance IN ('OFFICIAL', 'LICENSED', 'FIXTURE');
-- Generated versions: practice-side uses only until a human certifies them for mocks.
UPDATE public.approved_items ai
   SET usage_eligibility = ARRAY['PRACTICE', 'DIAGNOSTIC', 'QUIZ']::text[],
       exam_alignment = CASE WHEN ai.bank_lifecycle_status IN ('VALIDATED', 'PILOT', 'CALIBRATED', 'ACTIVE') THEN 'EXAM_STYLE' ELSE 'PRACTICE' END
  FROM public.question_bank_items qi
 WHERE qi.id = ai.bank_item_id AND ai.usage_eligibility IS NULL AND ai.exam_alignment IS NULL
   AND qi.provenance = 'STUDYUS_GENERATED';
UPDATE public.exam_item_usage u SET delivery_use = CASE ei.mode WHEN 'PRACTICE' THEN 'PRACTICE' ELSE 'REDUCED_MOCK' END
  FROM public.exam_instances ei WHERE ei.id = u.exam_instance_id AND u.delivery_use IS NULL;
