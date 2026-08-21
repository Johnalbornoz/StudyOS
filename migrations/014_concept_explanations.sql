CREATE TABLE IF NOT EXISTS concept_explanations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_id UUID NOT NULL REFERENCES concepts(id),
  language VARCHAR(10) NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(concept_id, language)
);

CREATE INDEX IF NOT EXISTS concept_explanations_concept_idx ON concept_explanations(concept_id);
