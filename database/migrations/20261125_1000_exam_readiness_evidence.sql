-- TRACK B -- Exam Readiness evidence, separated from the Learning Knowledge State (S1 of the separation design,
-- docs/audits/exam-bank/EXAM_READINESS_SEPARATION_AUDIT.md section 5).
-- ORDER. Follows 20261124_1200. ADDITIVE ONLY: one new table, empty. No existing table, row or function is changed.
--
-- Invariant it serves:  LEARNING + INTERNAL_ASSESSMENT -> Knowledge State;  EXAM_ASSESSMENT -> Exam Readiness.
-- One row = one scored (or explicitly unscored) exam response, attributed to the item's PRIMARY canonical concept and
-- to its exam context. It needs NO learner concept, plan entry or route: an off-plan concept gets exam evidence too.
-- A row is never a Learning row: evidence_class is pinned to EXAM_ASSESSMENT.
-- Identity: (response, canonical concept) -- a replayed completion writes nothing new.
-- History: rows follow their response (ON DELETE CASCADE from exam_attempt_item_responses); nothing else deletes them.
--
-- Rollback: DROP TABLE public.exam_readiness_evidence (no other object depends on it).

CREATE TABLE public.exam_readiness_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_class text NOT NULL DEFAULT 'EXAM_ASSESSMENT' CHECK (evidence_class = 'EXAM_ASSESSMENT'),
  student_id uuid NOT NULL,
  exam_attempt_id uuid NOT NULL,
  response_id uuid NOT NULL REFERENCES public.exam_attempt_item_responses(id) ON DELETE CASCADE,
  approved_item_id uuid NOT NULL,
  exam_version_id uuid,
  exam_target_id uuid,
  system_id text,
  learning_objective_id uuid,
  blueprint_bucket_id text,
  canonical_concept_id uuid,
  canonical_concept_stable_id text,
  status text NOT NULL CHECK (status IN ('SCORED', 'ASSISTED', 'PENDING_REVIEW', 'UNANSWERED')),
  score numeric,
  max_score numeric,
  fraction numeric CHECK (fraction IS NULL OR (fraction >= 0 AND fraction <= 1)),
  -- exam performance is never independent LEARNING evidence; an assisted response is never independent exam evidence
  independent boolean NOT NULL DEFAULT false,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (canonical_concept_id IS NOT NULL OR canonical_concept_stable_id IS NOT NULL),
  CHECK (status <> 'SCORED' OR (score IS NOT NULL AND max_score IS NOT NULL AND fraction IS NOT NULL)),
  CHECK (status = 'SCORED' OR independent = false)
);
CREATE UNIQUE INDEX exam_readiness_evidence_identity ON public.exam_readiness_evidence (response_id, COALESCE(canonical_concept_stable_id, canonical_concept_id::text));
CREATE INDEX exam_readiness_evidence_student_exam ON public.exam_readiness_evidence (student_id, exam_version_id, occurred_at);
CREATE INDEX exam_readiness_evidence_concept ON public.exam_readiness_evidence (student_id, canonical_concept_stable_id);
