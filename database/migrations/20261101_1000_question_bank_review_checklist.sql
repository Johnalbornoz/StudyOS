-- QB pilot -- structured human review checklist (additive, non-destructive).
--
-- A governed population pilot (e.g. Saber 11 Matemáticas) declares the points a reviewer must confirm
-- item by item (answer, distractors, competence, assertion / evidence, content category, StudyUs difficulty,
-- language, solution, originality). The application requires every declared point on an APPROVED decision;
-- the database re-checks that an APPROVED review never carries an unconfirmed point.
-- Existing reviews keep review_checklist = NULL.
--
-- Rollback:
--   ALTER TABLE public.question_bank_reviews DROP CONSTRAINT IF EXISTS question_bank_reviews_checklist_check;
--   ALTER TABLE public.question_bank_reviews DROP COLUMN IF EXISTS review_checklist;

ALTER TABLE public.question_bank_reviews ADD COLUMN IF NOT EXISTS review_checklist jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'question_bank_reviews_checklist_check') THEN
    ALTER TABLE public.question_bank_reviews ADD CONSTRAINT question_bank_reviews_checklist_check CHECK (
      review_checklist IS NULL
      OR (jsonb_typeof(review_checklist) = 'object'
          AND NOT jsonb_path_exists(review_checklist, '$.* ? (@.type() != "boolean")')
          AND (decision <> 'APPROVED' OR NOT jsonb_path_exists(review_checklist, '$.* ? (@ == false)')))
    );
  END IF;
END $$;
