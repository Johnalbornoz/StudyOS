-- CURR-PAA -- DB-backed invariants of item version -> curriculum node (migration 20261111_1000), on a database
-- where the certified PAA hierarchy is materialised. EPHEMERAL database only; one transaction, rolled back.
\set ON_ERROR_STOP 1
BEGIN;
\o /dev/null
CREATE TEMP TABLE cp_ids (k text PRIMARY KEY, v uuid NOT NULL DEFAULT gen_random_uuid());
CREATE TEMP TABLE cp_results (n serial, label text);
CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM cp_ids WHERE k = p $$;
CREATE FUNCTION pg_temp.ok(label text, stmt text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE stmt;
  INSERT INTO cp_results (label) VALUES (label);
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'CURR-PAA FAIL [%]: expected success, got: %', label, SQLERRM;
END $$;
CREATE FUNCTION pg_temp.no(label text, stmt text, marker text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  msg text;
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    msg := SQLERRM;
  END;
  IF msg IS NULL THEN
    RAISE EXCEPTION 'CURR-PAA FAIL [%]: the statement was accepted', label;
  END IF;
  IF position(marker IN msg) = 0 THEN
    RAISE EXCEPTION 'CURR-PAA FAIL [%]: refused for another reason: %', label, msg;
  END IF;
  INSERT INTO cp_results (label) VALUES (label);
END $$;

INSERT INTO cp_ids (k) SELECT unnest(ARRAY['author', 'item', 'v1', 'item2', 'v2', 'looseTopic']);
INSERT INTO users (id, clerk_id, is_system) VALUES (pg_temp.id('author'), 'currpaa:author', false);

-- A Lectura objective of v2.paa, a Topic of Lectura, a Topic of Matemáticas (another structure version), a Domain node.
CREATE TEMP TABLE cp_ctx AS
SELECT lo.id AS objective_id, qi.exam_version_id,
       (SELECT id FROM structure_nodes WHERE code = 'paa.topic.001') AS lectura_topic,
       (SELECT id FROM structure_nodes WHERE code = 'paa.topic.002') AS lectura_topic2,
       (SELECT id FROM structure_nodes WHERE code = 'paa.dom.lectura.vocabulario') AS lectura_domain,
       (SELECT id FROM structure_nodes WHERE code = 'paa.dom.lectura.ideas') AS lectura_domain2,
       (SELECT t.id FROM structure_nodes t JOIN structure_nodes d ON d.id = t.parent_id WHERE d.code = 'paa.dom.matematicas.algebra' ORDER BY t.code LIMIT 1) AS math_topic,
       (SELECT ai.id FROM approved_items ai WHERE ai.bank_item_id = qi.id AND ai.bank_lifecycle_status = 'ACTIVE' LIMIT 1) AS legacy_version,
       n.structure_version_id
  FROM learning_objectives lo JOIN structure_nodes n ON n.id = lo.structure_node_id JOIN structure_versions sv ON sv.id = n.structure_version_id
  JOIN question_bank_items qi ON qi.learning_objective_id = lo.id
 WHERE lo.code = 'paa.lect.vocabulario' AND sv.source_locator = 'exam-vertical-config:v2.paa' LIMIT 1;
DO $$ BEGIN
  IF (SELECT count(*) FROM cp_ctx WHERE lectura_topic IS NOT NULL AND math_topic IS NOT NULL AND lectura_domain IS NOT NULL AND legacy_version IS NOT NULL) <> 1 THEN
    RAISE EXCEPTION 'CURR-PAA SETUP: hierarchy or PAA fixtures not found';
  END IF;
END $$;
CREATE FUNCTION pg_temp.new_item(p_item text, p_version text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO question_bank_items (id, item_key, exam_version_id, learning_objective_id, provenance, language) SELECT pg_temp.id(p_item), 'currpaa.' || p_item, exam_version_id, objective_id, 'STUDYUS_AUTHORED', 'es' FROM cp_ctx;
  INSERT INTO approved_items (id, learning_objective_id, question_type, content, created_by, status, bank_item_id, version_number, bank_lifecycle_status, content_hash)
  SELECT pg_temp.id(p_version), objective_id, 'MCQ', '{"stem":"currpaa"}'::jsonb, pg_temp.id('author'), 'PUBLISHED', pg_temp.id(p_item), 1, 'PILOT', md5(p_version) FROM cp_ctx;
$$;
SELECT pg_temp.new_item('item', 'v1');
SELECT pg_temp.new_item('item2', 'v2');

SELECT pg_temp.ok('no legacy item was traced', $q$DO $x$ BEGIN IF EXISTS (SELECT 1 FROM question_bank_item_curriculum_nodes) THEN RAISE EXCEPTION 'links exist'; END IF; END $x$$q$);
SELECT pg_temp.no('a Domain node is not a Topic', $$INSERT INTO question_bank_item_curriculum_nodes (approved_item_id, structure_node_id, linked_by) SELECT pg_temp.id('v1'), lectura_domain, pg_temp.id('author') FROM cp_ctx$$, 'QUESTION_BANK_ITEM_CURRICULUM_NODE_NOT_A_TOPIC');
SELECT pg_temp.no('a bootstrap section node is not a Topic', $$INSERT INTO question_bank_item_curriculum_nodes (approved_item_id, structure_node_id, linked_by) SELECT pg_temp.id('v1'), n.id, pg_temp.id('author') FROM cp_ctx c JOIN structure_nodes n ON n.structure_version_id = c.structure_version_id AND n.node_type = 'EXAM_SECTION'$$, 'QUESTION_BANK_ITEM_CURRICULUM_NODE_NOT_A_TOPIC');
SELECT pg_temp.ok('a Topic with no Domain above it exists for the test', $$INSERT INTO structure_nodes (id, structure_version_id, node_type, source_label, code, order_index) SELECT pg_temp.id('looseTopic'), structure_version_id, 'TOPIC', 'loose', 'currpaa.loose', 999 FROM cp_ctx$$);
SELECT pg_temp.no('a Topic must sit under a Domain', $$INSERT INTO question_bank_item_curriculum_nodes (approved_item_id, structure_node_id, linked_by) VALUES (pg_temp.id('v1'), pg_temp.id('looseTopic'), pg_temp.id('author'))$$, 'QUESTION_BANK_ITEM_CURRICULUM_NODE_TOPIC_WITHOUT_DOMAIN');
SELECT pg_temp.no('a Topic of another section (another structure version) is refused', $$INSERT INTO question_bank_item_curriculum_nodes (approved_item_id, structure_node_id, linked_by) SELECT pg_temp.id('v1'), math_topic, pg_temp.id('author') FROM cp_ctx$$, 'QUESTION_BANK_ITEM_CURRICULUM_NODE_OTHER_STRUCTURE');
SELECT pg_temp.no('a legacy active version is not traced after the fact', $$INSERT INTO question_bank_item_curriculum_nodes (approved_item_id, structure_node_id, linked_by) SELECT legacy_version, lectura_topic, pg_temp.id('author') FROM cp_ctx$$, 'QUESTION_BANK_ITEM_CURRICULUM_NODE_FROZEN');
SELECT pg_temp.no('only a Question Bank item version is traced', $$INSERT INTO question_bank_item_curriculum_nodes (approved_item_id, structure_node_id, linked_by) SELECT gen_random_uuid(), lectura_topic, pg_temp.id('author') FROM cp_ctx$$, 'QUESTION_BANK_ITEM_CURRICULUM_NODE_NEEDS_BANK_VERSION');
SELECT pg_temp.ok('a new item version is traced to one certified Topic', $$INSERT INTO question_bank_item_curriculum_nodes (approved_item_id, structure_node_id, linked_by) SELECT pg_temp.id('v1'), lectura_topic, pg_temp.id('author') FROM cp_ctx$$);
SELECT pg_temp.no('exactly one Topic per item version', $$INSERT INTO question_bank_item_curriculum_nodes (approved_item_id, structure_node_id, linked_by) SELECT pg_temp.id('v1'), lectura_topic2, pg_temp.id('author') FROM cp_ctx$$, 'question_bank_item_curriculum_nodes_pkey');
SELECT pg_temp.no('a link is replaced, not rewritten', $$UPDATE question_bank_item_curriculum_nodes SET structure_node_id = (SELECT lectura_topic2 FROM cp_ctx) WHERE approved_item_id = pg_temp.id('v1')$$, 'QUESTION_BANK_ITEM_CURRICULUM_NODE_NO_UPDATE');
SELECT pg_temp.ok('exactly one official Domain and one Section follow from the Topic', $q$DO $x$ DECLARE r record; BEGIN
  SELECT count(*) AS n, min(d.code) AS domain, min(s.code) AS section, min(t.source) AS authority INTO r FROM question_bank_item_curriculum_nodes l JOIN structure_nodes t ON t.id = l.structure_node_id JOIN structure_nodes d ON d.id = t.parent_id JOIN structure_nodes s ON s.id = d.parent_id WHERE l.approved_item_id = pg_temp.id('v1');
  IF r.n <> 1 OR r.domain <> 'paa.dom.lectura.vocabulario' OR r.section <> 'paa.sec.lectura' OR r.authority <> 'OFFICIAL' THEN RAISE EXCEPTION 'trace is %', r; END IF; END $x$$q$);
SELECT pg_temp.no('a traced Topic cannot be moved to another Domain', $$UPDATE structure_nodes SET parent_id = (SELECT lectura_domain2 FROM cp_ctx) WHERE id = (SELECT lectura_topic FROM cp_ctx)$$, 'STRUCTURE_NODE_TRACED_BY_ITEMS');
SELECT pg_temp.no('a traced Topic cannot be re-typed', $$UPDATE structure_nodes SET node_type = 'EXAM_SECTION' WHERE id = (SELECT lectura_topic FROM cp_ctx)$$, 'STRUCTURE_NODE_TRACED_BY_ITEMS');
SELECT pg_temp.no('the Domain above a traced Topic cannot be re-typed or moved', $$UPDATE structure_nodes SET node_type = 'SECTION', parent_id = NULL WHERE id = (SELECT lectura_domain FROM cp_ctx)$$, 'STRUCTURE_NODE_TRACED_BY_ITEMS');
SELECT pg_temp.ok('a traced Topic can still be reordered: only its type, parent and version are fixed', $$UPDATE structure_nodes SET order_index = order_index WHERE id = (SELECT lectura_topic FROM cp_ctx)$$);
SELECT pg_temp.no('a traced Topic cannot be deleted', $$DELETE FROM structure_nodes WHERE id = (SELECT lectura_topic FROM cp_ctx)$$, 'question_bank_item_curriculum_nodes_structure_node_id_fkey');
SELECT pg_temp.ok('the link can be removed and replaced while the version is under review', $$DELETE FROM question_bank_item_curriculum_nodes WHERE approved_item_id = pg_temp.id('v1');
  INSERT INTO question_bank_item_curriculum_nodes (approved_item_id, structure_node_id, linked_by) SELECT pg_temp.id('v1'), lectura_topic2, pg_temp.id('author') FROM cp_ctx$$);
SELECT pg_temp.ok('a second item can share the Topic', $$INSERT INTO question_bank_item_curriculum_nodes (approved_item_id, structure_node_id, linked_by) SELECT pg_temp.id('v2'), lectura_topic2, pg_temp.id('author') FROM cp_ctx$$);
SELECT pg_temp.ok('a rejected version keeps its trace for the record', $$UPDATE approved_items SET bank_lifecycle_status = 'REVIEW_REQUIRED', status = 'IN_REVIEW' WHERE id = pg_temp.id('v2'); UPDATE approved_items SET bank_lifecycle_status = 'REJECTED', status = 'REJECTED' WHERE id = pg_temp.id('v2')$$);
SELECT pg_temp.no('the trace of a closed version is fixed', $$DELETE FROM question_bank_item_curriculum_nodes WHERE approved_item_id = pg_temp.id('v2')$$, 'QUESTION_BANK_ITEM_CURRICULUM_NODE_FROZEN');
\o
\pset tuples_only on
SELECT 'CURR_PAA_TRACEABILITY_INVARIANTS = ' || count(*) || ' PASS' FROM cp_results;
ROLLBACK;
