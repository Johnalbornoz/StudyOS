-- Curriculum convergence -- Learn curriculum provenance (ADDITIVE).
--
-- The canonical concept says WHAT a Student learns (`concept_catalog_mapping.canonical_concept_id`, unchanged).
-- This table says WHERE in the Student's curriculum that Learn concept belongs, as durable references only:
--
--   Learn concept (concepts.id)
--     -> canonical concept      canonical_concepts.id       (the identity the lineage was recorded for)
--     -> academic subject       academic_subjects.id        (programme, qualification and level are its own columns)
--     -> structure version      structure_versions.id
--     -> curriculum node        structure_nodes.id
--     -> learning objective     learning_objectives.id      (the only node <-> concept path the catalogue has:
--                                                            node -> objective -> objective_concept_mappings)
--
-- No curriculum name is copied: every label is read from the governed rows these ids point at.
-- One row per Learn concept. The lineage is a fact about how the concept entered Learn: it is validated when
-- it is written and never rewritten afterwards (the catalogue may move on; the record does not).
--
-- Validated on INSERT (anything else is refused -- fail closed, nothing is "corrected"):
--   - the Learn concept is linked (MATCHED) to exactly this canonical concept;
--   - the node belongs to the structure version, the version to the academic subject, and it is PUBLISHED;
--   - the objective hangs from the node and is ACTIVE;
--   - a PUBLISHED objective -> concept mapping joins that objective and that canonical concept.
--
-- No row is created for any existing Learn concept: concepts added before this migration have no recorded
-- lineage and stay as they are.
--
-- Rollback (only while empty): DROP TABLE public.learner_concept_curriculum_provenance;
--   DROP FUNCTION public.learner_concept_curriculum_provenance_guard(); DELETE FROM schema_migrations WHERE version = '20261122_1000';

CREATE TABLE public.learner_concept_curriculum_provenance (
  learner_concept_id uuid PRIMARY KEY REFERENCES public.concepts(id) ON DELETE CASCADE,
  canonical_concept_id uuid NOT NULL REFERENCES public.canonical_concepts(id),
  academic_subject_id uuid NOT NULL REFERENCES public.academic_subjects(id),
  structure_version_id uuid NOT NULL REFERENCES public.structure_versions(id),
  structure_node_id uuid NOT NULL REFERENCES public.structure_nodes(id),
  learning_objective_id uuid NOT NULL REFERENCES public.learning_objectives(id),
  recorded_by uuid REFERENCES public.users(id),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX learner_concept_curriculum_provenance_version ON public.learner_concept_curriculum_provenance (structure_version_id);
CREATE INDEX learner_concept_curriculum_provenance_node ON public.learner_concept_curriculum_provenance (structure_node_id);
CREATE INDEX learner_concept_curriculum_provenance_subject ON public.learner_concept_curriculum_provenance (academic_subject_id);

CREATE FUNCTION public.learner_concept_curriculum_provenance_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  node_version uuid;
  version_subject uuid;
  version_status text;
  objective_node uuid;
  objective_status text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'LEARNER_CONCEPT_CURRICULUM_PROVENANCE_IMMUTABLE: %', OLD.learner_concept_id USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.concept_catalog_mapping m
                  WHERE m.learner_concept_id = NEW.learner_concept_id AND m.status = 'MATCHED' AND m.canonical_concept_id = NEW.canonical_concept_id) THEN
    RAISE EXCEPTION 'LEARNER_CONCEPT_CURRICULUM_PROVENANCE_CANONICAL_MISMATCH: Learn concept % is not linked to canonical concept %', NEW.learner_concept_id, NEW.canonical_concept_id USING ERRCODE = 'check_violation';
  END IF;
  SELECT n.structure_version_id INTO node_version FROM public.structure_nodes n WHERE n.id = NEW.structure_node_id;
  IF node_version IS DISTINCT FROM NEW.structure_version_id THEN
    RAISE EXCEPTION 'LEARNER_CONCEPT_CURRICULUM_PROVENANCE_NODE_VERSION: node % is not in structure version %', NEW.structure_node_id, NEW.structure_version_id USING ERRCODE = 'check_violation';
  END IF;
  SELECT sv.academic_subject_id, sv.status INTO version_subject, version_status FROM public.structure_versions sv WHERE sv.id = NEW.structure_version_id;
  IF version_subject IS DISTINCT FROM NEW.academic_subject_id THEN
    RAISE EXCEPTION 'LEARNER_CONCEPT_CURRICULUM_PROVENANCE_VERSION_SUBJECT: structure version % is not of academic subject %', NEW.structure_version_id, NEW.academic_subject_id USING ERRCODE = 'check_violation';
  END IF;
  IF version_status IS DISTINCT FROM 'PUBLISHED' THEN
    RAISE EXCEPTION 'LEARNER_CONCEPT_CURRICULUM_PROVENANCE_VERSION_NOT_PUBLISHED: structure version % is %', NEW.structure_version_id, version_status USING ERRCODE = 'check_violation';
  END IF;
  SELECT lo.structure_node_id, lo.status INTO objective_node, objective_status FROM public.learning_objectives lo WHERE lo.id = NEW.learning_objective_id;
  IF objective_node IS DISTINCT FROM NEW.structure_node_id OR objective_status IS DISTINCT FROM 'ACTIVE' THEN
    RAISE EXCEPTION 'LEARNER_CONCEPT_CURRICULUM_PROVENANCE_OBJECTIVE_NODE: objective % is not an ACTIVE objective of node %', NEW.learning_objective_id, NEW.structure_node_id USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.objective_concept_mappings ocm
                  WHERE ocm.learning_objective_id = NEW.learning_objective_id AND ocm.canonical_concept_id = NEW.canonical_concept_id AND ocm.status = 'PUBLISHED') THEN
    RAISE EXCEPTION 'LEARNER_CONCEPT_CURRICULUM_PROVENANCE_NO_MAPPING: no PUBLISHED mapping joins objective % and canonical concept %', NEW.learning_objective_id, NEW.canonical_concept_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER trg_learner_concept_curriculum_provenance_guard BEFORE INSERT OR UPDATE ON public.learner_concept_curriculum_provenance
  FOR EACH ROW EXECUTE FUNCTION public.learner_concept_curriculum_provenance_guard();
