-- CURR-PAA / B2-B0 migration 10 -- item version -> curriculum node (ADDITIVE).
--
-- Official Domain / Topic traceability of a Question Bank item version. Under B0 X.11 the Domain and Topic
-- layers are curriculum structure (`structure_nodes`); this table points an item version at ONE Topic node.
-- Its Domain is that Topic's parent, so "exactly one Domain and exactly one Topic" holds by construction:
--   - one row per item version (primary key);
--   - the node is an ACTIVE node of type TOPIC whose parent is an ACTIVE node of type DOMAIN;
--   - the node belongs to the structure version of the item's own learning objective.
-- The link is reviewed content: it can be settled while the version is under review and is fixed once the
-- version is in use or closed (the rule the stimulus link and the concept attribution already follow).
-- A node that items are traced to keeps its place: neither it nor its Domain can be re-typed, moved to
-- another parent or another structure version while a link exists.
--
-- No link is created for any existing item: legacy items stay untraced.
-- Curriculum rows (the Section / Domain / Topic nodes themselves) are NOT created by this migration; they are
-- content, materialised by the Curriculum Authority's services.
--
-- Rollback (only while empty): DROP TRIGGER trg_structure_node_traced_guard ON public.structure_nodes;
--   DROP FUNCTION public.structure_node_traced_guard(); DROP TABLE public.question_bank_item_curriculum_nodes;
--   DROP FUNCTION public.question_bank_item_curriculum_node_guard(); DELETE FROM schema_migrations WHERE version = '20261111_1000';

CREATE TABLE public.question_bank_item_curriculum_nodes (
  approved_item_id uuid PRIMARY KEY REFERENCES public.approved_items(id),
  structure_node_id uuid NOT NULL REFERENCES public.structure_nodes(id),
  linked_by uuid NOT NULL REFERENCES public.users(id),
  linked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX question_bank_item_curriculum_nodes_node ON public.question_bank_item_curriculum_nodes (structure_node_id);

CREATE FUNCTION public.question_bank_item_curriculum_node_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target uuid;
  st text;
  is_bank boolean;
  objective_version uuid;
  topic record;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'QUESTION_BANK_ITEM_CURRICULUM_NODE_NO_UPDATE: remove and re-link instead' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    target := OLD.approved_item_id;
  ELSE
    target := NEW.approved_item_id;
  END IF;
  SELECT ai.bank_lifecycle_status, ai.bank_item_id IS NOT NULL, n.structure_version_id INTO st, is_bank, objective_version
    FROM public.approved_items ai JOIN public.learning_objectives lo ON lo.id = ai.learning_objective_id JOIN public.structure_nodes n ON n.id = lo.structure_node_id
   WHERE ai.id = target;
  IF NOT coalesce(is_bank, false) THEN
    RAISE EXCEPTION 'QUESTION_BANK_ITEM_CURRICULUM_NODE_NEEDS_BANK_VERSION: %', target USING ERRCODE = 'check_violation';
  END IF;
  IF st IN ('ACTIVE', 'CALIBRATED', 'SUSPENDED', 'RETIRED', 'SUPERSEDED', 'REJECTED') THEN
    RAISE EXCEPTION 'QUESTION_BANK_ITEM_CURRICULUM_NODE_FROZEN: version % is %; trace a new version instead', target, st USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  SELECT t.node_type, t.status, t.structure_version_id, d.node_type AS parent_type, d.status AS parent_status INTO topic
    FROM public.structure_nodes t LEFT JOIN public.structure_nodes d ON d.id = t.parent_id WHERE t.id = NEW.structure_node_id;
  IF topic.node_type IS DISTINCT FROM 'TOPIC' OR topic.status IS DISTINCT FROM 'ACTIVE' THEN
    RAISE EXCEPTION 'QUESTION_BANK_ITEM_CURRICULUM_NODE_NOT_A_TOPIC: node % is not an active Topic', NEW.structure_node_id USING ERRCODE = 'check_violation';
  END IF;
  IF topic.parent_type IS DISTINCT FROM 'DOMAIN' OR topic.parent_status IS DISTINCT FROM 'ACTIVE' THEN
    RAISE EXCEPTION 'QUESTION_BANK_ITEM_CURRICULUM_NODE_TOPIC_WITHOUT_DOMAIN: Topic % has no active Domain', NEW.structure_node_id USING ERRCODE = 'check_violation';
  END IF;
  IF topic.structure_version_id IS DISTINCT FROM objective_version THEN
    RAISE EXCEPTION 'QUESTION_BANK_ITEM_CURRICULUM_NODE_OTHER_STRUCTURE: Topic % is not in the structure version of the objective of version %', NEW.structure_node_id, target USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_question_bank_item_curriculum_node_guard BEFORE INSERT OR UPDATE OR DELETE ON public.question_bank_item_curriculum_nodes
  FOR EACH ROW EXECUTE FUNCTION public.question_bank_item_curriculum_node_guard();

-- A traced Topic, and the Domain above it, keep their place in the hierarchy.
CREATE FUNCTION public.structure_node_traced_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.question_bank_item_curriculum_nodes l JOIN public.structure_nodes t ON t.id = l.structure_node_id
              WHERE t.id = OLD.id OR t.parent_id = OLD.id) THEN
    RAISE EXCEPTION 'STRUCTURE_NODE_TRACED_BY_ITEMS: node % carries item traceability; its type, parent and version are fixed', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_structure_node_traced_guard BEFORE UPDATE ON public.structure_nodes
  FOR EACH ROW WHEN (OLD.parent_id IS DISTINCT FROM NEW.parent_id OR OLD.node_type IS DISTINCT FROM NEW.node_type OR OLD.structure_version_id IS DISTINCT FROM NEW.structure_version_id)
  EXECUTE FUNCTION public.structure_node_traced_guard();
