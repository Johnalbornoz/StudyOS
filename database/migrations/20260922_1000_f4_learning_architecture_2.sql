-- F4: Learning Architecture 2.0 -- canonical academic catalog foundation,
-- strictly additive. Zero changes to concepts, subjects, topics, subtopics,
-- or any of the 19 evidence/state tables that FK to concepts(id)
-- (learning_evidence, mastery_records, concept_knowledge_state,
-- concept_memory_state, concept_transfer_state, etc. -- see
-- docs/implementation/f4/F4_CURRENT_LEARNING_ARCHITECTURE_ASSESSMENT.md).
--
-- Introduces a shared canonical catalog (canonical_subjects,
-- canonical_concepts, skills, competencies, contexts, and their
-- many-to-many junctions) plus one explicit, auditable correspondence
-- layer (concept_catalog_mapping / concept_catalog_mapping_candidates)
-- from existing per-student concepts to canonical identity. No concept is
-- ever merged solely by name -- see the backfill block below.
--
-- Fully idempotent, never applied automatically by build/start -- apply
-- explicitly via `npm run db:migrate`.
-- ---------------------------------------------------------------------

-- --- canonical catalog ---

CREATE TABLE IF NOT EXISTS public.canonical_subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT canonical_subjects_status_check CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED'))
);

CREATE INDEX IF NOT EXISTS idx_canonical_subjects_name ON public.canonical_subjects (lower(name));

-- Deliberately NO uniqueness on (canonical_subject_id, name): task's own
-- adversarial requirement is that two canonical concepts may legitimately
-- share a display name (different definition/level/scope). A uniqueness
-- constraint here would silently force exactly the name-based merge
-- INV-F4-04 forbids.
CREATE TABLE IF NOT EXISTS public.canonical_concepts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_subject_id uuid NOT NULL REFERENCES public.canonical_subjects(id),
  name text NOT NULL,
  description text,
  level text,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT canonical_concepts_status_check CHECK (status IN ('DRAFT', 'ACTIVE', 'DEPRECATED'))
);

CREATE INDEX IF NOT EXISTS idx_canonical_concepts_lookup
  ON public.canonical_concepts (canonical_subject_id, lower(name));

CREATE TABLE IF NOT EXISTS public.skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  skill_type text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT skills_skill_type_check CHECK (skill_type IN ('TRANSVERSAL', 'DISCIPLINE_SPECIFIC')),
  CONSTRAINT skills_status_check CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED'))
);

CREATE TABLE IF NOT EXISTS public.competencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  sequence integer,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT competencies_status_check CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED'))
);

CREATE TABLE IF NOT EXISTS public.contexts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  sequence integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contexts_code_check CHECK (code IN ('FAMILIAR', 'ALTERED', 'REAL_WORLD', 'UNFAMILIAR', 'CROSS_DOMAIN'))
);

-- --- many-to-many junctions ---

CREATE TABLE IF NOT EXISTS public.canonical_concept_skills (
  canonical_concept_id uuid NOT NULL REFERENCES public.canonical_concepts(id),
  skill_id uuid NOT NULL REFERENCES public.skills(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (canonical_concept_id, skill_id)
);

CREATE TABLE IF NOT EXISTS public.skill_competencies (
  skill_id uuid NOT NULL REFERENCES public.skills(id),
  competency_id uuid NOT NULL REFERENCES public.competencies(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (skill_id, competency_id)
);

-- "Where justified" (task 12) -- a direct concept-to-competency link that
-- does NOT require routing through a skill. Its existence is taxonomy
-- metadata only; it never implies a learner has attained that competency
-- (INV-F4-09).
CREATE TABLE IF NOT EXISTS public.canonical_concept_competencies (
  canonical_concept_id uuid NOT NULL REFERENCES public.canonical_concepts(id),
  competency_id uuid NOT NULL REFERENCES public.competencies(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (canonical_concept_id, competency_id)
);

-- Canonical-level prerequisite graph -- distinct from, and does not read
-- from or write to, the existing per-student concept_relationships table.
-- Cycle prevention is enforced in application code (recursive CTE) before
-- insert, never by a DB constraint (Postgres has no native DAG check).
CREATE TABLE IF NOT EXISTS public.canonical_concept_prerequisites (
  prerequisite_concept_id uuid NOT NULL REFERENCES public.canonical_concepts(id),
  concept_id uuid NOT NULL REFERENCES public.canonical_concepts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (prerequisite_concept_id, concept_id),
  CONSTRAINT canonical_concept_prerequisites_no_self_loop CHECK (prerequisite_concept_id <> concept_id)
);

-- --- correspondence layer: existing learner concepts -> canonical identity ---

CREATE TABLE IF NOT EXISTS public.concept_catalog_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_concept_id uuid NOT NULL UNIQUE REFERENCES public.concepts(id),
  canonical_concept_id uuid REFERENCES public.canonical_concepts(id),
  status text NOT NULL,
  mapping_method text,
  reviewed_by uuid REFERENCES public.users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT concept_catalog_mapping_status_check CHECK (status IN ('MATCHED', 'PROPOSED', 'AMBIGUOUS', 'UNRESOLVED')),
  CONSTRAINT concept_catalog_mapping_method_check CHECK (mapping_method IS NULL OR mapping_method IN ('EXACT_LABEL_MATCH', 'MANUAL_REVIEW', 'SEED_FIXTURE')),
  CONSTRAINT concept_catalog_mapping_matched_has_canonical CHECK (
    (status = 'MATCHED') = (canonical_concept_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_concept_catalog_mapping_status ON public.concept_catalog_mapping (status);
CREATE INDEX IF NOT EXISTS idx_concept_catalog_mapping_canonical ON public.concept_catalog_mapping (canonical_concept_id);

CREATE TABLE IF NOT EXISTS public.concept_catalog_mapping_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mapping_id uuid NOT NULL REFERENCES public.concept_catalog_mapping(id),
  canonical_concept_id uuid NOT NULL REFERENCES public.canonical_concepts(id),
  confidence numeric,
  rationale text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT concept_catalog_mapping_candidates_confidence_check CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
);

CREATE INDEX IF NOT EXISTS idx_concept_catalog_mapping_candidates_mapping ON public.concept_catalog_mapping_candidates (mapping_id);

-- --- reviewed fixture taxonomy (task 9/10/11 -- small, reviewed, not a full production catalog) ---

INSERT INTO public.competencies (code, name, sequence)
VALUES
  ('C1', 'Recall', 1),
  ('C2', 'Conceptual Understanding', 2),
  ('C3', 'Application', 3),
  ('C4', 'Analysis', 4),
  ('C5', 'Problem Solving', 5),
  ('C6', 'Reasoning / Justification', 6),
  ('C7', 'Evaluation', 7),
  ('C8', 'Transfer', 8),
  ('C9', 'Communication', 9),
  ('C10', 'Metacognition', 10)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.contexts (code, name, sequence)
VALUES
  ('FAMILIAR', 'Familiar', 1),
  ('ALTERED', 'Altered', 2),
  ('REAL_WORLD', 'Real World', 3),
  ('UNFAMILIAR', 'Unfamiliar', 4),
  ('CROSS_DOMAIN', 'Cross Domain', 5)
ON CONFLICT (code) DO NOTHING;

-- skills has no unique constraint on name (see catalog model doc), so
-- idempotency here is an explicit existence check rather than ON CONFLICT.
INSERT INTO public.skills (name, skill_type)
SELECT v.name, v.skill_type
FROM (VALUES
  ('interpret', 'TRANSVERSAL'),
  ('compare', 'TRANSVERSAL'),
  ('infer', 'TRANSVERSAL'),
  ('analyze', 'TRANSVERSAL'),
  ('justify', 'TRANSVERSAL'),
  ('evaluate', 'TRANSVERSAL'),
  ('model', 'TRANSVERSAL'),
  ('communicate', 'TRANSVERSAL'),
  ('factor polynomial', 'DISCIPLINE_SPECIFIC'),
  ('balance equation', 'DISCIPLINE_SPECIFIC'),
  ('solve vectors', 'DISCIPLINE_SPECIFIC')
) AS v(name, skill_type)
WHERE NOT EXISTS (
  SELECT 1 FROM public.skills sk WHERE sk.name = v.name AND sk.skill_type = v.skill_type
);

-- --- backfill: every existing concept gets exactly one mapping row ---
--
-- Idempotent: only processes concepts.id values with no existing
-- concept_catalog_mapping row, so a second run of this migration (or a
-- future run after new concepts are created) is always a safe no-op for
-- already-mapped concepts.
--
-- Never merges by name alone across an ambiguous candidate set (INV-F4-04):
-- zero candidates -> UNRESOLVED; exactly one -> MATCHED; two or more ->
-- AMBIGUOUS with every candidate recorded, never an automatic pick.
DO $$
DECLARE
  concept_row RECORD;
  concept_label text;
  candidate_count integer;
  single_candidate_id uuid;
  new_mapping_id uuid;
BEGIN
  FOR concept_row IN
    SELECT c.id AS concept_id, s.name AS subject_name
    FROM public.concepts c
    JOIN public.subjects s ON s.id = c.subject_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.concept_catalog_mapping m WHERE m.learner_concept_id = c.id
    )
  LOOP
    -- Prefer an English label; fall back to any available localization.
    SELECT cl.label INTO concept_label
    FROM public.concept_localizations cl
    WHERE cl.concept_id = concept_row.concept_id
    ORDER BY (cl.language = 'en') DESC, cl.created_at ASC
    LIMIT 1;

    new_mapping_id := gen_random_uuid();

    IF concept_label IS NULL THEN
      INSERT INTO public.concept_catalog_mapping (id, learner_concept_id, canonical_concept_id, status, mapping_method)
      VALUES (new_mapping_id, concept_row.concept_id, NULL, 'UNRESOLVED', NULL);
      CONTINUE;
    END IF;

    SELECT COUNT(*) INTO candidate_count
    FROM public.canonical_concepts cc
    JOIN public.canonical_subjects cs ON cs.id = cc.canonical_subject_id
    WHERE lower(trim(cs.name)) = lower(trim(concept_row.subject_name))
      AND lower(trim(cc.name)) = lower(trim(concept_label));

    IF candidate_count = 0 THEN
      INSERT INTO public.concept_catalog_mapping (id, learner_concept_id, canonical_concept_id, status, mapping_method)
      VALUES (new_mapping_id, concept_row.concept_id, NULL, 'UNRESOLVED', NULL);

    ELSIF candidate_count = 1 THEN
      SELECT cc.id INTO single_candidate_id
      FROM public.canonical_concepts cc
      JOIN public.canonical_subjects cs ON cs.id = cc.canonical_subject_id
      WHERE lower(trim(cs.name)) = lower(trim(concept_row.subject_name))
        AND lower(trim(cc.name)) = lower(trim(concept_label));

      INSERT INTO public.concept_catalog_mapping (id, learner_concept_id, canonical_concept_id, status, mapping_method)
      VALUES (new_mapping_id, concept_row.concept_id, single_candidate_id, 'MATCHED', 'EXACT_LABEL_MATCH');

      INSERT INTO public.concept_catalog_mapping_candidates (mapping_id, canonical_concept_id, confidence, rationale)
      VALUES (new_mapping_id, single_candidate_id, 1.0, 'exact label match within same-named canonical subject');

    ELSE
      INSERT INTO public.concept_catalog_mapping (id, learner_concept_id, canonical_concept_id, status, mapping_method)
      VALUES (new_mapping_id, concept_row.concept_id, NULL, 'AMBIGUOUS', NULL);

      INSERT INTO public.concept_catalog_mapping_candidates (mapping_id, canonical_concept_id, confidence, rationale)
      SELECT new_mapping_id, cc.id, 0.5, 'exact label match but multiple canonical concepts share this name -- never auto-picked'
      FROM public.canonical_concepts cc
      JOIN public.canonical_subjects cs ON cs.id = cc.canonical_subject_id
      WHERE lower(trim(cs.name)) = lower(trim(concept_row.subject_name))
        AND lower(trim(cc.name)) = lower(trim(concept_label));
    END IF;
  END LOOP;
END $$;
