-- Blueprint SLOT CONSTRAINTS (additive, non-destructive).
--
-- A required slot (blueprint_objective_targets row) may constrain structured dimensions beyond its learning
-- objective and its dedicated columns (question type, difficulty band, command term), e.g. a Saber 11 slot:
--   [{"dimension": "COMPETENCE", "value": "FORMULACION_Y_EJECUCION"}, {"dimension": "CONTENT_CATEGORY", "value": "GEOMETRIA"}]
-- A competence x content combination is an assembly constraint, never a learning objective.
-- Existing rows get [] (no constraint): every existing blueprint keeps exactly its current meaning.
--
-- Rollback:
--   ALTER TABLE public.blueprint_objective_targets DROP CONSTRAINT IF EXISTS blueprint_objective_targets_constraints_check;
--   ALTER TABLE public.blueprint_objective_targets DROP COLUMN IF EXISTS constraints;

ALTER TABLE public.blueprint_objective_targets ADD COLUMN IF NOT EXISTS constraints jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'blueprint_objective_targets_constraints_check') THEN
    ALTER TABLE public.blueprint_objective_targets ADD CONSTRAINT blueprint_objective_targets_constraints_check CHECK (
      jsonb_typeof(constraints) = 'array'
      AND jsonb_array_length(constraints) <= 6
      AND NOT jsonb_path_exists(constraints, '$[*] ? (@.type() != "object")')
      AND NOT jsonb_path_exists(constraints, '$[*] ? (!exists(@.dimension) || !exists(@.value) || @.dimension.type() != "string" || @.value.type() != "string")')
      AND NOT jsonb_path_exists(constraints, '$[*] ? (!(@.dimension like_regex "^(COMPETENCE|CONTENT_CATEGORY|ASSESSMENT_OBJECTIVE|PROCESS|CONTEXT|MARKS)$") || !(@.value like_regex "^[A-Z0-9][A-Z0-9_]*$"))')
    );
  END IF;
END $$;
