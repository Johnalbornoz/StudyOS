-- Track B -- Exam V2 completion block (DEV).
--
-- Strictly additive. Never applied automatically -- governed runner only.
-- 20261020_1000 (Exam Architecture V2) is applied and is NOT edited.
--
-- Rollback (DEV only, manual):
--   ALTER TABLE public.exam_instances DROP COLUMN IF EXISTS focus_objective_ids;
--   DELETE FROM public.schema_migrations WHERE version = '20261021_1000';
-- ---------------------------------------------------------------------

-- Skill-level practice (e.g. PAA -> Practicar -> Lectura -> Inferencia): the
-- instance's plan and form are restricted to these blueprint objectives.
-- Empty = every objective of the selected components.
ALTER TABLE public.exam_instances ADD COLUMN IF NOT EXISTS focus_objective_ids uuid[] NOT NULL DEFAULT '{}';
