-- QB pilot -- structured HUMAN review assessment + complete checklist on every decision (additive).
--
-- 20261101_1000 made the DB refuse an APPROVED review carrying a FAILED (false) checklist point. It did not
-- refuse an UNCONFIRMED point (a declared key absent from the checklist), and it let a correction / rejection
-- record no failed point at all. For a governed pilot item (its generation request declares
-- generation_params.pilot.reviewChecklist) this migration makes the database re-check, on EVERY decision:
--   * every declared checklist point is answered explicitly (true / false);
--   * the reviewer's structured assessment is present (competence, content category, StudyUs difficulty and
--     correct option as THEY determine them; correction notes on CORRECTION_REQUESTED);
-- and, for any review with a checklist, that a non-approval names at least one failed point.
-- The application enforces the same rules first (quality.ts / pilots/human-review.ts).
-- Existing reviews keep review_assessment = NULL; no existing row has a pilot checklist on DEV / Preview.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS question_bank_review_pilot_guard ON public.question_bank_reviews;
--   DROP FUNCTION IF EXISTS public.question_bank_review_pilot_guard();
--   ALTER TABLE public.question_bank_reviews DROP CONSTRAINT IF EXISTS question_bank_reviews_assessment_check;
--   ALTER TABLE public.question_bank_reviews DROP CONSTRAINT IF EXISTS question_bank_reviews_nonapproval_failure_check;
--   ALTER TABLE public.question_bank_reviews DROP COLUMN IF EXISTS review_assessment;

ALTER TABLE public.question_bank_reviews ADD COLUMN IF NOT EXISTS review_assessment jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'question_bank_reviews_assessment_check') THEN
    ALTER TABLE public.question_bank_reviews ADD CONSTRAINT question_bank_reviews_assessment_check CHECK (
      review_assessment IS NULL OR jsonb_typeof(review_assessment) = 'object'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'question_bank_reviews_nonapproval_failure_check') THEN
    ALTER TABLE public.question_bank_reviews ADD CONSTRAINT question_bank_reviews_nonapproval_failure_check CHECK (
      review_checklist IS NULL OR decision = 'APPROVED' OR jsonb_path_exists(review_checklist, '$.* ? (@ == false)')
    );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.question_bank_review_pilot_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  required jsonb;
  k text;
BEGIN
  SELECT gr.generation_params->'pilot'->'reviewChecklist' INTO required
    FROM public.question_bank_items qi JOIN public.question_bank_generation_requests gr ON gr.id = qi.generation_request_id
   WHERE qi.id = NEW.bank_item_id;
  IF required IS NULL OR jsonb_typeof(required) <> 'array' OR jsonb_array_length(required) = 0 THEN
    RETURN NEW;
  END IF;
  IF NEW.review_checklist IS NULL THEN
    RAISE EXCEPTION 'PILOT_CHECKLIST_REQUIRED' USING ERRCODE = '23514';
  END IF;
  FOR k IN SELECT jsonb_array_elements_text(required) LOOP
    IF jsonb_typeof(NEW.review_checklist->k) IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'PILOT_CHECKLIST_POINT_UNANSWERED: %', k USING ERRCODE = '23514';
    END IF;
  END LOOP;
  IF NEW.review_assessment IS NULL
     OR NOT (NEW.review_assessment ?& ARRAY['contract', 'reviewedCompetency', 'reviewedContentCategory', 'reviewedDifficulty', 'reviewedAnswer']) THEN
    RAISE EXCEPTION 'PILOT_ASSESSMENT_REQUIRED' USING ERRCODE = '23514';
  END IF;
  IF NEW.decision = 'CORRECTION_REQUESTED' AND length(btrim(coalesce(NEW.review_assessment->>'correctionNotes', ''))) < 5 THEN
    RAISE EXCEPTION 'PILOT_CORRECTION_NOTES_REQUIRED' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS question_bank_review_pilot_guard ON public.question_bank_reviews;
CREATE TRIGGER question_bank_review_pilot_guard BEFORE INSERT OR UPDATE ON public.question_bank_reviews
  FOR EACH ROW EXECUTE FUNCTION public.question_bank_review_pilot_guard();
