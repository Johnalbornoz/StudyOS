-- B2-B1 -- DB-backed invariants of the Question Bank / B2 persistence schema (migrations 20261110_1000..1700).
-- Runs on an EPHEMERAL database only (called by b2b1-persistence-schema-cert.sh). Everything happens in one
-- transaction that is rolled back: the database is left exactly as it was found.
\set ON_ERROR_STOP 1
BEGIN;
SET CONSTRAINTS ALL IMMEDIATE;
\o /dev/null

CREATE TEMP TABLE b2b1_ids (k text PRIMARY KEY, v uuid NOT NULL DEFAULT gen_random_uuid());
CREATE TEMP TABLE b2b1_results (n serial, label text, outcome text);
CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM b2b1_ids WHERE k = p $$;

-- ok(label, sql): the statement must succeed.  no(label, sql, marker): it must fail with an error naming `marker`.
CREATE FUNCTION pg_temp.ok(label text, stmt text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE stmt;
  INSERT INTO b2b1_results (label, outcome) VALUES (label, 'PASS');
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'B2B1 FAIL [%]: expected success, got: %', label, SQLERRM;
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
    RAISE EXCEPTION 'B2B1 FAIL [%]: the statement was accepted', label;
  END IF;
  IF position(marker IN msg) = 0 THEN
    RAISE EXCEPTION 'B2B1 FAIL [%]: refused for another reason: %', label, msg;
  END IF;
  INSERT INTO b2b1_results (label, outcome) VALUES (label, 'PASS');
END $$;

-- Fixtures of this run ------------------------------------------------------------------------------------
INSERT INTO b2b1_ids (k) SELECT unnest(ARRAY['author', 'reviewer', 'reviewer2', 'grantor', 'system', 'item', 'v1', 'item2', 'v2', 'item3', 'v3', 'genitem',
  'asset', 'stim', 'sv', 'stim2', 'sv2', 'rights', 'qual', 'bpF1', 'bpF1r2', 'bpF2', 'bpR1', 'bpD1', 'form', 'form2', 'req']);
INSERT INTO users (id, clerk_id, is_system) VALUES (pg_temp.id('author'), 'b2b1:author', false), (pg_temp.id('reviewer'), 'b2b1:reviewer', false),
  (pg_temp.id('reviewer2'), 'b2b1:reviewer2', false), (pg_temp.id('grantor'), 'b2b1:grantor', false), (pg_temp.id('system'), 'b2b1:system', true);

-- A seeded bank item whose objective has a published concept mapping gives the exam version, objective,
-- exam family and canonical subject the new content is written for.
CREATE TEMP TABLE b2b1_ctx AS
SELECT qi.exam_version_id, qi.learning_objective_id AS objective_id, ed.exam_family, cc.id AS concept_id, cc.canonical_subject_id AS subject_id,
       (SELECT c2.id FROM canonical_concepts c2 WHERE c2.canonical_subject_id = cc.canonical_subject_id AND c2.id <> cc.id AND c2.status = 'ACTIVE' ORDER BY c2.id LIMIT 1) AS concept2_id,
       (SELECT s2.id FROM canonical_subjects s2 WHERE s2.id <> cc.canonical_subject_id
           AND s2.id NOT IN (SELECT c3.canonical_subject_id FROM objective_concept_mappings m3 JOIN canonical_concepts c3 ON c3.id = m3.canonical_concept_id
                              WHERE m3.learning_objective_id = qi.learning_objective_id) ORDER BY s2.id LIMIT 1) AS other_subject_id,
       (SELECT ai.id FROM approved_items ai WHERE ai.bank_item_id = qi.id AND ai.bank_lifecycle_status = 'ACTIVE' ORDER BY ai.id LIMIT 1) AS legacy_version_id,
       qi.id AS legacy_item_id
  FROM question_bank_items qi
  JOIN exam_versions ev ON ev.id = qi.exam_version_id JOIN exam_definitions ed ON ed.id = ev.exam_definition_id
  JOIN objective_concept_mappings m ON m.learning_objective_id = qi.learning_objective_id AND m.status = 'PUBLISHED'
  JOIN canonical_concepts cc ON cc.id = m.canonical_concept_id AND cc.status = 'ACTIVE'
 WHERE qi.provenance = 'FIXTURE' AND EXISTS (SELECT 1 FROM approved_items ai WHERE ai.bank_item_id = qi.id AND ai.bank_lifecycle_status = 'ACTIVE')
 ORDER BY qi.item_key, cc.id LIMIT 1;
DO $$ BEGIN
  IF (SELECT count(*) FROM b2b1_ctx WHERE concept2_id IS NOT NULL AND other_subject_id IS NOT NULL) <> 1 THEN
    RAISE EXCEPTION 'B2B1 SETUP: no seeded bank item with a mapped objective to anchor the tests';
  END IF;
END $$;

CREATE FUNCTION pg_temp.new_item(p_item text, p_version text, p_provenance text, p_author text, p_lifecycle text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO question_bank_items (id, item_key, exam_version_id, learning_objective_id, provenance, language)
  SELECT pg_temp.id(p_item), 'b2b1.' || p_item, exam_version_id, objective_id, p_provenance, 'es' FROM b2b1_ctx;
  INSERT INTO approved_items (id, learning_objective_id, question_type, content, created_by, status, bank_item_id, version_number, bank_lifecycle_status, content_hash)
  SELECT pg_temp.id(p_version), objective_id, 'MCQ', '{"stem":"b2b1"}'::jsonb, pg_temp.id(p_author),
         CASE WHEN p_lifecycle IN ('PILOT', 'ACTIVE') THEN 'PUBLISHED' ELSE 'DRAFT' END, pg_temp.id(p_item), 1, p_lifecycle, md5(p_version) FROM b2b1_ctx;
$$;

-- §18 Provenance ------------------------------------------------------------------------------------------
SELECT pg_temp.no('provenance: unknown class refused', $$INSERT INTO question_bank_items (item_key, learning_objective_id, provenance, language) SELECT 'b2b1.x', objective_id, 'AUTHORED', 'es' FROM b2b1_ctx$$, 'question_bank_items_provenance_check');
SELECT pg_temp.no('provenance: authored item cannot carry generation metadata', $$INSERT INTO question_bank_items (item_key, learning_objective_id, provenance, language, generation_metadata) SELECT 'b2b1.x', objective_id, 'STUDYUS_AUTHORED', 'es', '{"model":"m"}'::jsonb FROM b2b1_ctx$$, 'question_bank_items_authored_no_generation');
SELECT pg_temp.no('provenance: authored version needs a human author', $$SELECT pg_temp.new_item('item', 'v1', 'STUDYUS_AUTHORED', 'system', 'PILOT')$$, 'QUESTION_BANK_AUTHORED_NEEDS_HUMAN_AUTHOR');
SELECT pg_temp.ok('provenance: authored item written by a person', $$SELECT pg_temp.new_item('item', 'v1', 'STUDYUS_AUTHORED', 'author', 'PILOT')$$);
SELECT pg_temp.no('provenance: immutable on the identity', $$UPDATE question_bank_items SET provenance = 'OFFICIAL' WHERE id = pg_temp.id('item')$$, 'QUESTION_BANK_PROVENANCE_IMMUTABLE');
SELECT pg_temp.ok('provenance: generated item keeps its class', $$INSERT INTO question_bank_items (id, item_key, exam_version_id, learning_objective_id, provenance, language, generation_metadata) SELECT pg_temp.id('genitem'), 'b2b1.gen', exam_version_id, objective_id, 'STUDYUS_GENERATED', 'es', '{"model":"m"}'::jsonb FROM b2b1_ctx$$);
SELECT pg_temp.no('provenance: generated never becomes authored after human editing', $$UPDATE question_bank_items SET provenance = 'STUDYUS_AUTHORED', generation_metadata = NULL WHERE id = pg_temp.id('genitem')$$, 'QUESTION_BANK_PROVENANCE_IMMUTABLE');
SELECT pg_temp.ok('provenance: content origin AUTHORED accepted', $$UPDATE approved_items SET content_origin = 'AUTHORED' WHERE id = pg_temp.id('v1')$$);

-- §17 Rights ----------------------------------------------------------------------------------------------
SELECT pg_temp.ok('source access: every source has one', $q$DO $x$ BEGIN IF EXISTS (SELECT 1 FROM assessment_sources WHERE source_access IS NULL) THEN RAISE EXCEPTION 'null access'; END IF; END $x$$q$);
SELECT pg_temp.ok('source access: PUBLIC licence status became PUBLICLY_ACCESSIBLE and nothing else', $q$DO $x$ BEGIN IF EXISTS (SELECT 1 FROM assessment_sources WHERE (license_status = 'PUBLIC') <> (source_access = 'PUBLICLY_ACCESSIBLE')) THEN RAISE EXCEPTION 'mismatch'; END IF; END $x$$q$);
SELECT pg_temp.ok('source access: an existing writer that does not know the column still works', $$INSERT INTO assessment_sources (source_key, framework, title, license_status) VALUES ('b2b1.src', 'PAA', 'b2b1', 'PUBLIC')$$);
SELECT pg_temp.ok('source access: derived for that writer', $q$DO $x$ BEGIN IF (SELECT source_access FROM assessment_sources WHERE source_key = 'b2b1.src') <> 'PUBLICLY_ACCESSIBLE' THEN RAISE EXCEPTION 'not derived'; END IF; END $x$$q$);
SELECT pg_temp.ok('rights: no record was fabricated for existing content', $q$DO $x$ BEGIN IF EXISTS (SELECT 1 FROM question_bank_content_rights) THEN RAISE EXCEPTION 'rights exist'; END IF; END $x$$q$);
SELECT pg_temp.no('rights: content must exist', $$INSERT INTO question_bank_content_rights (content_type, content_id, source_access, reuse_rights, recorded_by) VALUES ('ITEM_VERSION', gen_random_uuid(), 'NOT_APPLICABLE', 'UNKNOWN', pg_temp.id('author'))$$, 'QUESTION_BANK_RIGHTS_CONTENT_NOT_FOUND');
SELECT pg_temp.no('rights: an asset id is not an item version', $$INSERT INTO question_bank_content_rights (content_type, content_id, source_access, reuse_rights, recorded_by) VALUES ('ASSET', pg_temp.id('v1'), 'NOT_APPLICABLE', 'UNKNOWN', pg_temp.id('author'))$$, 'QUESTION_BANK_RIGHTS_CONTENT_NOT_FOUND');
SELECT pg_temp.no('rights: unknown content type', $$INSERT INTO question_bank_content_rights (content_type, content_id, source_access, reuse_rights, recorded_by) VALUES ('ITEM', pg_temp.id('v1'), 'NOT_APPLICABLE', 'UNKNOWN', pg_temp.id('author'))$$, 'QUESTION_BANK_RIGHTS_CONTENT_NOT_FOUND');
SELECT pg_temp.no('rights: owned needs a holder and a permitted use', $$INSERT INTO question_bank_content_rights (content_type, content_id, source_access, reuse_rights, recorded_by) VALUES ('ITEM_VERSION', pg_temp.id('v1'), 'NOT_APPLICABLE', 'STUDYUS_OWNED', pg_temp.id('author'))$$, 'question_bank_content_rights_established');
SELECT pg_temp.no('rights: a licence is cited', $$INSERT INTO question_bank_content_rights (content_type, content_id, source_access, reuse_rights, rights_holder, permitted_use, recorded_by) VALUES ('ITEM_VERSION', pg_temp.id('v1'), 'LICENSED_SOURCE', 'LICENSED_FOR_USE', 'X', 'delivery', pg_temp.id('author'))$$, 'question_bank_content_rights_licence');
SELECT pg_temp.ok('rights: publicly accessible with unknown reuse can be recorded (and grants nothing)', $$INSERT INTO question_bank_content_rights (id, content_type, content_id, source_access, reuse_rights, recorded_by) VALUES (pg_temp.id('rights'), 'ITEM_VERSION', pg_temp.id('v1'), 'PUBLICLY_ACCESSIBLE', 'UNKNOWN', pg_temp.id('author'))$$);
SELECT pg_temp.no('rights: one current record per content', $$INSERT INTO question_bank_content_rights (content_type, content_id, source_access, reuse_rights, rights_holder, permitted_use, recorded_by) VALUES ('ITEM_VERSION', pg_temp.id('v1'), 'NOT_APPLICABLE', 'STUDYUS_OWNED', 'StudyUs', 'delivery', pg_temp.id('author'))$$, 'question_bank_content_rights_current');
SELECT pg_temp.no('rights: a record is not rewritten', $$UPDATE question_bank_content_rights SET reuse_rights = 'PROHIBITED' WHERE id = pg_temp.id('rights')$$, 'QUESTION_BANK_RIGHTS_APPEND_ONLY');
SELECT pg_temp.no('rights: a record is not deleted', $$DELETE FROM question_bank_content_rights WHERE id = pg_temp.id('rights')$$, 'QUESTION_BANK_RIGHTS_APPEND_ONLY');
SELECT pg_temp.ok('rights: superseded, then replaced by an owned record', $$UPDATE question_bank_content_rights SET superseded_at = now() WHERE id = pg_temp.id('rights');
  INSERT INTO question_bank_content_rights (content_type, content_id, source_access, reuse_rights, rights_holder, permitted_use, recorded_by) VALUES ('ITEM_VERSION', pg_temp.id('v1'), 'NOT_APPLICABLE', 'STUDYUS_OWNED', 'StudyUs', 'delivery', pg_temp.id('author'))$$);
SELECT pg_temp.ok('rights: content source usage recorded', $$INSERT INTO question_bank_content_sources (rights_id, assessment_source_id, usage) SELECT r.id, s.id, 'REFERENCE_ONLY' FROM question_bank_content_rights r, assessment_sources s WHERE r.content_id = pg_temp.id('v1') AND r.superseded_at IS NULL AND s.source_key = 'b2b1.src'$$);

-- §20 Assets and stimuli ----------------------------------------------------------------------------------
SELECT pg_temp.ok('asset: registered as a draft', $$INSERT INTO question_bank_assets (id, asset_key, kind, provenance, storage_provider, storage_key, sha256, media_type, size_bytes, created_by) VALUES (pg_temp.id('asset'), 'b2b1.asset', 'GRAPH', 'STUDYUS_AUTHORED', 'any-provider', 'qb/b2b1.svg', repeat('a', 64), 'image/svg+xml', 1200, pg_temp.id('author'))$$);
SELECT pg_temp.no('asset: active needs a text alternative', $$UPDATE question_bank_assets SET lifecycle_status = 'ACTIVE' WHERE id = pg_temp.id('asset')$$, 'question_bank_assets_active_alt_text');
SELECT pg_temp.ok('asset: rights record on an asset', $$INSERT INTO question_bank_content_rights (content_type, content_id, source_access, reuse_rights, rights_holder, permitted_use, recorded_by) VALUES ('ASSET', pg_temp.id('asset'), 'NOT_APPLICABLE', 'STUDYUS_OWNED', 'StudyUs', 'delivery', pg_temp.id('author'))$$);
SELECT pg_temp.ok('stimulus: paired passage created', $$INSERT INTO question_bank_stimuli (id, stimulus_key, kind, language, provenance) VALUES (pg_temp.id('stim'), 'b2b1.stim', 'PAIRED_PASSAGE', 'es', 'STUDYUS_AUTHORED')$$);
SELECT pg_temp.no('stimulus: unknown kind', $$INSERT INTO question_bank_stimuli (stimulus_key, kind, language, provenance) VALUES ('b2b1.bad', 'VIDEO', 'es', 'STUDYUS_AUTHORED')$$, 'kind_check');
SELECT pg_temp.no('stimulus: a version is born a draft', $$INSERT INTO question_bank_stimulus_versions (stimulus_id, version_number, lifecycle_status, content_hash, frozen_at, created_by) VALUES (pg_temp.id('stim'), 1, 'ACTIVE', 'h', now(), pg_temp.id('author'))$$, 'QUESTION_BANK_STIMULUS_VERSION_STARTS_DRAFT');
SELECT pg_temp.no('stimulus: a subset rule states both bounds', $$INSERT INTO question_bank_stimulus_versions (stimulus_id, version_number, selection_min_items, created_by) VALUES (pg_temp.id('stim'), 1, 2, pg_temp.id('author'))$$, 'question_bank_stimulus_versions_selection');
SELECT pg_temp.ok('stimulus: draft version', $$INSERT INTO question_bank_stimulus_versions (id, stimulus_id, version_number, created_by) VALUES (pg_temp.id('sv'), pg_temp.id('stim'), 1, pg_temp.id('author'))$$);
SELECT pg_temp.no('stimulus: cannot freeze an empty version', $$UPDATE question_bank_stimulus_versions SET lifecycle_status = 'REVIEW_REQUIRED', content_hash = 'h' WHERE id = pg_temp.id('sv')$$, 'QUESTION_BANK_STIMULUS_VERSION_EMPTY');
SELECT pg_temp.ok('stimulus: ordered parts A, B and a graph', $$INSERT INTO question_bank_stimulus_parts (stimulus_version_id, position, label, part_kind, body, asset_id) VALUES
  (pg_temp.id('sv'), 1, 'A', 'TEXT', '{"paragraphs":["a"]}', NULL), (pg_temp.id('sv'), 2, 'B', 'TEXT', '{"paragraphs":["b"]}', NULL), (pg_temp.id('sv'), 3, NULL, 'GRAPH', NULL, pg_temp.id('asset'))$$);
SELECT pg_temp.no('stimulus: two parts cannot share a position', $$INSERT INTO question_bank_stimulus_parts (stimulus_version_id, position, part_kind, body) VALUES (pg_temp.id('sv'), 2, 'TEXT', '{}')$$, 'question_bank_stimulus_parts_stimulus_version_id_position_key');
SELECT pg_temp.no('stimulus: a part has content', $$INSERT INTO question_bank_stimulus_parts (stimulus_version_id, position, part_kind) VALUES (pg_temp.id('sv'), 4, 'TEXT')$$, 'question_bank_stimulus_parts_has_content');
SELECT pg_temp.no('stimulus: a frozen version carries its hash', $$UPDATE question_bank_stimulus_versions SET lifecycle_status = 'REVIEW_REQUIRED' WHERE id = pg_temp.id('sv')$$, 'question_bank_stimulus_versions_frozen');
SELECT pg_temp.no('stimulus: a draft cannot be reviewed', $$INSERT INTO question_bank_stimulus_reviews (stimulus_version_id, decision, reviewed_by, review_notes) VALUES (pg_temp.id('sv'), 'REJECTED', pg_temp.id('reviewer'), 'not ready')$$, 'QUESTION_BANK_STIMULUS_REVIEW_NEEDS_FROZEN_VERSION');
SELECT pg_temp.ok('stimulus: frozen for review', $$UPDATE question_bank_stimulus_versions SET lifecycle_status = 'REVIEW_REQUIRED', content_hash = 'h1' WHERE id = pg_temp.id('sv')$$);
SELECT pg_temp.no('stimulus: parts fixed after freeze (insert)', $$INSERT INTO question_bank_stimulus_parts (stimulus_version_id, position, part_kind, body) VALUES (pg_temp.id('sv'), 4, 'SOURCE_NOTE', '{}')$$, 'QUESTION_BANK_STIMULUS_VERSION_IMMUTABLE');
SELECT pg_temp.no('stimulus: parts fixed after freeze (update)', $$UPDATE question_bank_stimulus_parts SET body = '{"paragraphs":["changed"]}' WHERE stimulus_version_id = pg_temp.id('sv') AND position = 1$$, 'QUESTION_BANK_STIMULUS_VERSION_IMMUTABLE');
SELECT pg_temp.no('stimulus: parts fixed after freeze (delete)', $$DELETE FROM question_bank_stimulus_parts WHERE stimulus_version_id = pg_temp.id('sv') AND position = 3$$, 'QUESTION_BANK_STIMULUS_VERSION_IMMUTABLE');
SELECT pg_temp.no('stimulus: version content fixed after freeze', $$UPDATE question_bank_stimulus_versions SET content_hash = 'h2' WHERE id = pg_temp.id('sv')$$, 'QUESTION_BANK_STIMULUS_VERSION_IMMUTABLE');
SELECT pg_temp.no('stimulus: a version is never deleted', $$DELETE FROM question_bank_stimulus_versions WHERE id = pg_temp.id('sv')$$, 'QUESTION_BANK_STIMULUS_VERSION_NO_DELETE');
SELECT pg_temp.no('stimulus: active needs an approving review', $$UPDATE question_bank_stimulus_versions SET lifecycle_status = 'ACTIVE' WHERE id = pg_temp.id('sv')$$, 'QUESTION_BANK_HUMAN_APPROVAL_REQUIRED');
SELECT pg_temp.ok('stimulus: current version set', $$UPDATE question_bank_stimuli SET current_version_id = pg_temp.id('sv') WHERE id = pg_temp.id('stim')$$);
SELECT pg_temp.ok('stimulus: second and third question written for it', $$SELECT pg_temp.new_item('item2', 'v2', 'STUDYUS_AUTHORED', 'author', 'PILOT'); SELECT pg_temp.new_item('item3', 'v3', 'STUDYUS_AUTHORED', 'author', 'PILOT')$$);
SELECT pg_temp.ok('stimulus: one stimulus version, many item versions', $$INSERT INTO question_bank_item_stimulus (approved_item_id, stimulus_version_id, position) VALUES (pg_temp.id('v2'), pg_temp.id('sv'), 1), (pg_temp.id('v3'), pg_temp.id('sv'), 2)$$);
SELECT pg_temp.ok('stimulus: shared identity is derivable without item content', $q$DO $x$ BEGIN IF (SELECT count(DISTINCT s.approved_item_id) FROM question_bank_item_stimulus s JOIN question_bank_stimulus_versions v ON v.id = s.stimulus_version_id WHERE v.stimulus_id = pg_temp.id('stim')) <> 2 THEN RAISE EXCEPTION 'not shared'; END IF; END $x$$q$);
SELECT pg_temp.no('stimulus: an item version is asked about one stimulus only', $$INSERT INTO question_bank_item_stimulus (approved_item_id, stimulus_version_id, position) VALUES (pg_temp.id('v2'), pg_temp.id('sv'), 3)$$, 'question_bank_item_stimulus_pkey');
SELECT pg_temp.no('stimulus: two questions cannot share an order', $$INSERT INTO question_bank_item_stimulus (approved_item_id, stimulus_version_id, position) VALUES (pg_temp.id('v1'), pg_temp.id('sv'), 2)$$, 'question_bank_item_stimulus_stimulus_version_id_position_key');
SELECT pg_temp.no('stimulus: a legacy active version is not re-linked', $$INSERT INTO question_bank_item_stimulus (approved_item_id, stimulus_version_id, position) SELECT legacy_version_id, pg_temp.id('sv'), 9 FROM b2b1_ctx$$, 'QUESTION_BANK_ITEM_STIMULUS_FROZEN');
SELECT pg_temp.ok('stimulus: no link was fabricated for existing items', $q$DO $x$ BEGIN IF (SELECT count(*) FROM question_bank_item_stimulus) <> 2 THEN RAISE EXCEPTION 'unexpected links'; END IF; END $x$$q$);
SELECT pg_temp.ok('asset: attached to an item version under review', $$INSERT INTO question_bank_item_assets (approved_item_id, asset_id, role, position) VALUES (pg_temp.id('v1'), pg_temp.id('asset'), 'STEM', 1)$$);
SELECT pg_temp.ok('asset: activated with a text alternative', $$UPDATE question_bank_assets SET alt_text = '{"es":"grafica"}', lifecycle_status = 'ACTIVE' WHERE id = pg_temp.id('asset')$$);
SELECT pg_temp.no('asset: bytes fixed once active', $$UPDATE question_bank_assets SET sha256 = repeat('b', 64) WHERE id = pg_temp.id('asset')$$, 'QUESTION_BANK_ASSET_IMMUTABLE');
SELECT pg_temp.no('asset: never deleted', $$DELETE FROM question_bank_assets WHERE id = pg_temp.id('asset')$$, 'QUESTION_BANK_ASSET_NO_DELETE');

-- §19 Attribution -----------------------------------------------------------------------------------------
SELECT pg_temp.ok('attribution: none was fabricated for existing items', $q$DO $x$ BEGIN IF EXISTS (SELECT 1 FROM question_bank_item_concepts) THEN RAISE EXCEPTION 'rows exist'; END IF; END $x$$q$);
SELECT pg_temp.ok('attribution: one PRIMARY', $$INSERT INTO question_bank_item_concepts (approved_item_id, canonical_concept_id, role, attributed_by) SELECT pg_temp.id('v1'), concept_id, 'PRIMARY', pg_temp.id('author') FROM b2b1_ctx$$);
SELECT pg_temp.no('attribution: a second PRIMARY is refused', $$INSERT INTO question_bank_item_concepts (approved_item_id, canonical_concept_id, role, attributed_by) SELECT pg_temp.id('v1'), concept2_id, 'PRIMARY', pg_temp.id('author') FROM b2b1_ctx$$, 'question_bank_item_concepts_one_primary');
SELECT pg_temp.ok('attribution: a SUPPORTING concept beside it', $$INSERT INTO question_bank_item_concepts (approved_item_id, canonical_concept_id, role, attributed_by) SELECT pg_temp.id('v1'), concept2_id, 'SUPPORTING', pg_temp.id('author') FROM b2b1_ctx$$);
SELECT pg_temp.no('attribution: promoting it to a second PRIMARY is refused', $$UPDATE question_bank_item_concepts SET role = 'PRIMARY' WHERE approved_item_id = pg_temp.id('v1') AND role = 'SUPPORTING'$$, 'question_bank_item_concepts_one_primary');
SELECT pg_temp.no('attribution: only PRIMARY and SUPPORTING are roles', $$INSERT INTO question_bank_item_concepts (approved_item_id, canonical_concept_id, role, attributed_by) SELECT pg_temp.id('v2'), concept_id, 'CONTEXT', pg_temp.id('author') FROM b2b1_ctx$$, 'role_check');
SELECT pg_temp.ok('attribution: there is no weight column', $q$DO $x$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'question_bank_item_concepts' AND column_name ILIKE '%weight%') THEN RAISE EXCEPTION 'weight'; END IF; END $x$$q$);
SELECT pg_temp.ok('attribution: a context tag is stored apart from attribution', $$INSERT INTO question_bank_item_context_tags (approved_item_id, canonical_concept_id, tagged_by) SELECT pg_temp.id('v2'), concept2_id, pg_temp.id('author') FROM b2b1_ctx$$);
SELECT pg_temp.no('attribution: a legacy active version is not attributed after the fact', $$INSERT INTO question_bank_item_concepts (approved_item_id, canonical_concept_id, role, attributed_by) SELECT legacy_version_id, concept_id, 'PRIMARY', pg_temp.id('author') FROM b2b1_ctx$$, 'QUESTION_BANK_ATTRIBUTION_FROZEN');

-- §21 Pools -----------------------------------------------------------------------------------------------
SELECT pg_temp.ok('pool: no membership was fabricated for existing items', $q$DO $x$ BEGIN IF EXISTS (SELECT 1 FROM question_bank_pool_memberships) THEN RAISE EXCEPTION 'rows exist'; END IF; END $x$$q$);
SELECT pg_temp.ok('pool: a standalone item joins one pool', $$INSERT INTO question_bank_pool_memberships (bank_item_id, pool, policy_id, policy_version, assigned_by) VALUES (pg_temp.id('item'), 'FULL_MOCK_1', 'b2-pilot-pools', '1', pg_temp.id('author'))$$);
SELECT pg_temp.no('pool: one active pilot pool per item', $$INSERT INTO question_bank_pool_memberships (bank_item_id, pool, policy_id, policy_version, assigned_by) VALUES (pg_temp.id('item'), 'PRACTICE', 'b2-pilot-pools', '1', pg_temp.id('author'))$$, 'question_bank_pool_memberships_item_active');
SELECT pg_temp.no('pool: unknown pool', $$INSERT INTO question_bank_pool_memberships (bank_item_id, pool, policy_id, policy_version, assigned_by) VALUES (pg_temp.id('genitem'), 'FULL_MOCK_3', 'b2-pilot-pools', '1', pg_temp.id('author'))$$, 'pool_check');
SELECT pg_temp.no('pool: a membership names exactly one subject', $$INSERT INTO question_bank_pool_memberships (bank_item_id, stimulus_id, pool, policy_id, policy_version, assigned_by) VALUES (pg_temp.id('genitem'), pg_temp.id('stim'), 'PRACTICE', 'b2-pilot-pools', '1', pg_temp.id('author'))$$, 'question_bank_pool_memberships_one_subject');
SELECT pg_temp.ok('pool: a stimulus joins one pool', $$INSERT INTO question_bank_pool_memberships (stimulus_id, pool, policy_id, policy_version, assigned_by) VALUES (pg_temp.id('stim'), 'FULL_MOCK_1', 'b2-pilot-pools', '1', pg_temp.id('author'))$$);
SELECT pg_temp.no('pool: one active pilot pool per stimulus', $$INSERT INTO question_bank_pool_memberships (stimulus_id, pool, policy_id, policy_version, assigned_by) VALUES (pg_temp.id('stim'), 'FULL_MOCK_2', 'b2-pilot-pools', '1', pg_temp.id('author'))$$, 'question_bank_pool_memberships_stimulus_active');
SELECT pg_temp.no('pool: a stimulus-bound item has no pool of its own', $$INSERT INTO question_bank_pool_memberships (bank_item_id, pool, policy_id, policy_version, assigned_by) VALUES (pg_temp.id('item2'), 'FULL_MOCK_2', 'b2-pilot-pools', '1', pg_temp.id('author'))$$, 'QUESTION_BANK_POOL_ITEM_INHERITS_STIMULUS_POOL');
SELECT pg_temp.no('pool: an item with its own pool cannot be bound to a stimulus', $$INSERT INTO question_bank_item_stimulus (approved_item_id, stimulus_version_id, position) VALUES (pg_temp.id('v1'), pg_temp.id('sv'), 3)$$, 'QUESTION_BANK_POOL_CONFLICT');
SELECT pg_temp.ok('pool: every member of a group resolves to the one pool of its stimulus', $q$DO $x$ BEGIN IF (SELECT count(DISTINCT m.pool) FROM question_bank_item_stimulus s JOIN question_bank_stimulus_versions v ON v.id = s.stimulus_version_id JOIN question_bank_pool_memberships m ON m.stimulus_id = v.stimulus_id AND m.retired_at IS NULL WHERE v.stimulus_id = pg_temp.id('stim')) <> 1 THEN RAISE EXCEPTION 'split'; END IF; END $x$$q$);
SELECT pg_temp.no('pool: a membership is not rewritten', $$UPDATE question_bank_pool_memberships SET pool = 'PRACTICE' WHERE bank_item_id = pg_temp.id('item')$$, 'QUESTION_BANK_POOL_MEMBERSHIP_APPEND_ONLY');
SELECT pg_temp.no('pool: a membership is not deleted', $$DELETE FROM question_bank_pool_memberships WHERE bank_item_id = pg_temp.id('item')$$, 'QUESTION_BANK_POOL_MEMBERSHIP_NO_DELETE');
SELECT pg_temp.ok('pool: legacy items are in no pool', $q$DO $x$ BEGIN IF EXISTS (SELECT 1 FROM question_bank_pool_memberships m JOIN b2b1_ctx c ON c.legacy_item_id = m.bank_item_id) THEN RAISE EXCEPTION 'legacy pooled'; END IF; END $x$$q$);

-- §22 Review ----------------------------------------------------------------------------------------------
SELECT pg_temp.no('qualification: not self-granted', $$INSERT INTO question_bank_reviewer_qualifications (user_id, canonical_subject_id, exam_family, granted_by) SELECT pg_temp.id('reviewer'), subject_id, exam_family, pg_temp.id('reviewer') FROM b2b1_ctx$$, 'question_bank_reviewer_qualifications_not_self_granted');
SELECT pg_temp.no('qualification: a system account is not a reviewer', $$INSERT INTO question_bank_reviewer_qualifications (user_id, canonical_subject_id, exam_family, granted_by) SELECT pg_temp.id('system'), subject_id, exam_family, pg_temp.id('grantor') FROM b2b1_ctx$$, 'QUESTION_BANK_QUALIFICATION_NEEDS_PERSON');
SELECT pg_temp.no('review: the author cannot approve their own item', $$INSERT INTO question_bank_reviews (approved_item_id, bank_item_id, decision, reviewed_by) VALUES (pg_temp.id('v1'), pg_temp.id('item'), 'APPROVED', pg_temp.id('author'))$$, 'QUESTION_BANK_REVIEW_AUTHOR_CANNOT_APPROVE');
SELECT pg_temp.no('review: an unqualified reviewer cannot approve', $$INSERT INTO question_bank_reviews (approved_item_id, bank_item_id, decision, reviewed_by) VALUES (pg_temp.id('v1'), pg_temp.id('item'), 'APPROVED', pg_temp.id('reviewer'))$$, 'QUESTION_BANK_REVIEWER_NOT_QUALIFIED');
SELECT pg_temp.ok('qualification: wrong subject, wrong family, expired and revoked ones granted', $$
  INSERT INTO question_bank_reviewer_qualifications (user_id, canonical_subject_id, exam_family, granted_by) SELECT pg_temp.id('reviewer'), other_subject_id, exam_family, pg_temp.id('grantor') FROM b2b1_ctx;
  INSERT INTO question_bank_reviewer_qualifications (user_id, canonical_subject_id, exam_family, granted_by) SELECT pg_temp.id('reviewer'), subject_id, exam_family || '_OTHER', pg_temp.id('grantor') FROM b2b1_ctx;
  INSERT INTO question_bank_reviewer_qualifications (user_id, canonical_subject_id, exam_family, granted_by, valid_from, valid_to) SELECT pg_temp.id('reviewer'), subject_id, exam_family, pg_temp.id('grantor'), now() - interval '2 years', now() - interval '1 year' FROM b2b1_ctx;
  INSERT INTO question_bank_reviewer_qualifications (user_id, canonical_subject_id, exam_family, granted_by, valid_from, revoked_at, revoked_by, revoke_reason) SELECT pg_temp.id('reviewer'), subject_id, exam_family, pg_temp.id('grantor'), now() - interval '1 year', now() - interval '1 day', pg_temp.id('grantor'), 'left the panel' FROM b2b1_ctx$$);
SELECT pg_temp.no('review: wrong subject, wrong family, expired or revoked qualification cannot approve', $$INSERT INTO question_bank_reviews (approved_item_id, bank_item_id, decision, reviewed_by) VALUES (pg_temp.id('v1'), pg_temp.id('item'), 'APPROVED', pg_temp.id('reviewer'))$$, 'QUESTION_BANK_REVIEWER_NOT_QUALIFIED');
SELECT pg_temp.no('review: authored item cannot be activated without an approving review', $$UPDATE approved_items SET bank_lifecycle_status = 'ACTIVE' WHERE id = pg_temp.id('v1')$$, 'QUESTION_BANK_HUMAN_APPROVAL_REQUIRED');
SELECT pg_temp.ok('review: an unqualified reviewer can still request a correction', $$INSERT INTO question_bank_reviews (approved_item_id, bank_item_id, decision, reviewed_by, review_notes) VALUES (pg_temp.id('v1'), pg_temp.id('item'), 'CORRECTION_REQUESTED', pg_temp.id('reviewer'), 'distractor B is ambiguous')$$);
SELECT pg_temp.ok('qualification: valid one granted for the subject and the family', $$INSERT INTO question_bank_reviewer_qualifications (id, user_id, canonical_subject_id, exam_family, granted_by) SELECT pg_temp.id('qual'), pg_temp.id('reviewer'), subject_id, exam_family, pg_temp.id('grantor') FROM b2b1_ctx$$);
SELECT pg_temp.no('review: someone else''s qualification cannot be named', $$INSERT INTO question_bank_reviews (approved_item_id, bank_item_id, decision, reviewed_by, reviewer_qualification_id) VALUES (pg_temp.id('v1'), pg_temp.id('item'), 'APPROVED', pg_temp.id('reviewer2'), pg_temp.id('qual'))$$, 'QUESTION_BANK_REVIEWER_NOT_QUALIFIED');
SELECT pg_temp.ok('review: a qualified independent reviewer approves', $$INSERT INTO question_bank_reviews (approved_item_id, bank_item_id, decision, reviewed_by, checklist_key, checklist_version) VALUES (pg_temp.id('v1'), pg_temp.id('item'), 'APPROVED', pg_temp.id('reviewer'), 'qb.item.review', '1')$$);
SELECT pg_temp.ok('review: the qualification used is stamped on the review', $q$DO $x$ BEGIN IF (SELECT reviewer_qualification_id FROM question_bank_reviews WHERE approved_item_id = pg_temp.id('v1') AND decision = 'APPROVED') IS DISTINCT FROM pg_temp.id('qual') THEN RAISE EXCEPTION 'not stamped'; END IF; END $x$$q$);
SELECT pg_temp.no('review: checklist key and version go together', $$INSERT INTO question_bank_reviews (approved_item_id, bank_item_id, decision, reviewed_by, review_notes, checklist_key) VALUES (pg_temp.id('v1'), pg_temp.id('item'), 'REJECTED', pg_temp.id('reviewer'), 'rejected here', 'k')$$, 'question_bank_reviews_checklist_identity');
SELECT pg_temp.ok('review: the approved authored version becomes active', $$UPDATE approved_items SET bank_lifecycle_status = 'ACTIVE' WHERE id = pg_temp.id('v1')$$);
SELECT pg_temp.no('attribution: fixed once the version is active', $$UPDATE question_bank_item_concepts SET role = 'SUPPORTING' WHERE approved_item_id = pg_temp.id('v1') AND role = 'PRIMARY'$$, 'QUESTION_BANK_ATTRIBUTION_FROZEN');
SELECT pg_temp.no('asset: an active version keeps its assets', $$DELETE FROM question_bank_item_assets WHERE approved_item_id = pg_temp.id('v1')$$, 'QUESTION_BANK_ITEM_ASSET_FROZEN');
SELECT pg_temp.no('qualification: not rewritten', $$UPDATE question_bank_reviewer_qualifications SET exam_family = 'X' WHERE id = pg_temp.id('qual')$$, 'QUESTION_BANK_QUALIFICATION_IMMUTABLE');
SELECT pg_temp.no('stimulus review: the author cannot approve their own stimulus', $$INSERT INTO question_bank_stimulus_reviews (stimulus_version_id, decision, reviewed_by, reviewer_qualification_id) VALUES (pg_temp.id('sv'), 'APPROVED', pg_temp.id('author'), pg_temp.id('qual'))$$, 'QUESTION_BANK_REVIEW_AUTHOR_CANNOT_APPROVE');
SELECT pg_temp.no('stimulus review: approval names a valid qualification', $$INSERT INTO question_bank_stimulus_reviews (stimulus_version_id, decision, reviewed_by) VALUES (pg_temp.id('sv'), 'APPROVED', pg_temp.id('reviewer'))$$, 'QUESTION_BANK_REVIEWER_NOT_QUALIFIED');
SELECT pg_temp.ok('stimulus review: qualified approval, then active', $$INSERT INTO question_bank_stimulus_reviews (stimulus_version_id, decision, reviewed_by, reviewer_qualification_id) VALUES (pg_temp.id('sv'), 'APPROVED', pg_temp.id('reviewer'), pg_temp.id('qual'));
  UPDATE question_bank_stimulus_versions SET lifecycle_status = 'ACTIVE' WHERE id = pg_temp.id('sv')$$);
SELECT pg_temp.ok('qualification: revoked', $$UPDATE question_bank_reviewer_qualifications SET revoked_at = now(), revoked_by = pg_temp.id('grantor'), revoke_reason = 'end of engagement' WHERE id = pg_temp.id('qual')$$);
-- QB-R1C (20261112_1000): the approval reads the item version's explicit PRIMARY concept, never its objective's mappings.
SELECT pg_temp.no('review: an unattributed version cannot be approved, whatever its objective maps to', $$INSERT INTO question_bank_reviews (approved_item_id, bank_item_id, decision, reviewed_by, reviewed_at) VALUES (pg_temp.id('v2'), pg_temp.id('item2'), 'APPROVED', pg_temp.id('reviewer'), now() + interval '1 second')$$, 'QUESTION_BANK_PRIMARY_ATTRIBUTION_REQUIRED');
SELECT pg_temp.ok('attribution: the next item gets its PRIMARY concept', $$INSERT INTO question_bank_item_concepts (approved_item_id, canonical_concept_id, role, attributed_by) SELECT pg_temp.id('v2'), concept_id, 'PRIMARY', pg_temp.id('author') FROM b2b1_ctx$$);
SELECT pg_temp.no('review: a revoked reviewer cannot approve the next item', $$INSERT INTO question_bank_reviews (approved_item_id, bank_item_id, decision, reviewed_by, reviewed_at) VALUES (pg_temp.id('v2'), pg_temp.id('item2'), 'APPROVED', pg_temp.id('reviewer'), now() + interval '1 second')$$, 'QUESTION_BANK_REVIEWER_NOT_QUALIFIED');
SELECT pg_temp.no('originality: content must exist', $$INSERT INTO question_bank_originality_checks (content_type, content_id, method, method_version, result, performed_by_kind, performed_by, disposition) VALUES ('ITEM_VERSION', gen_random_uuid(), 'manual', '1', 'CLEAR', 'HUMAN', pg_temp.id('reviewer'), 'ACCEPTED')$$, 'QUESTION_BANK_ORIGINALITY_CONTENT_NOT_FOUND');
SELECT pg_temp.no('originality: a match is never accepted', $$INSERT INTO question_bank_originality_checks (content_type, content_id, method, method_version, result, performed_by_kind, performed_by, disposition) VALUES ('ITEM_VERSION', pg_temp.id('v1'), 'manual', '1', 'MATCH', 'HUMAN', pg_temp.id('reviewer'), 'ACCEPTED')$$, 'question_bank_originality_checks_match_not_accepted');
SELECT pg_temp.ok('originality: results recorded for an item version and a stimulus version', $$INSERT INTO question_bank_originality_checks (content_type, content_id, method, method_version, compared_against, result, performed_by_kind, performed_by, disposition) VALUES
  ('ITEM_VERSION', pg_temp.id('v1'), 'manual', '1', ARRAY['b2b1.src'], 'CLEAR', 'HUMAN', pg_temp.id('reviewer'), 'ACCEPTED'), ('STIMULUS_VERSION', pg_temp.id('sv'), 'manual', '1', ARRAY['b2b1.src'], 'CLEAR', 'HUMAN', pg_temp.id('reviewer'), 'ACCEPTED')$$);
SELECT pg_temp.no('originality: a result is not rewritten', $$UPDATE question_bank_originality_checks SET result = 'SIMILAR' WHERE content_id = pg_temp.id('v1')$$, 'QUESTION_BANK_ORIGINALITY_APPEND_ONLY');
SELECT pg_temp.ok('review: no qualification, review or originality record was fabricated for legacy items', $q$DO $x$ BEGIN IF EXISTS (SELECT 1 FROM question_bank_reviews r JOIN question_bank_items qi ON qi.id = r.bank_item_id WHERE qi.item_key NOT LIKE 'b2b1.%' AND r.reviewer_qualification_id IS NOT NULL) OR (SELECT count(*) FROM question_bank_originality_checks) <> 2 THEN RAISE EXCEPTION 'fabricated'; END IF; END $x$$q$);

-- §22 Blueprint variants ----------------------------------------------------------------------------------
SELECT pg_temp.ok('blueprint: every existing blueprint is legacy (purpose, form, revision, pool all NULL)', $q$DO $x$ BEGIN IF EXISTS (SELECT 1 FROM assessment_blueprints WHERE purpose IS NOT NULL OR form_number IS NOT NULL OR revision IS NOT NULL OR pool IS NOT NULL) OR NOT EXISTS (SELECT 1 FROM assessment_blueprints) THEN RAISE EXCEPTION 'classified'; END IF; END $x$$q$);
SELECT pg_temp.no('blueprint: still one legacy blueprint per exam version', $$INSERT INTO assessment_blueprints (exam_version_id) SELECT exam_version_id FROM assessment_blueprints LIMIT 1$$, 'assessment_blueprints_legacy_per_version');
SELECT pg_temp.no('blueprint: a variant declares form and revision', $$INSERT INTO assessment_blueprints (exam_version_id, purpose) SELECT exam_version_id, 'FULL' FROM b2b1_ctx$$, 'assessment_blueprints_variant_identity');
SELECT pg_temp.no('blueprint: a legacy blueprint carries no pool', $$UPDATE assessment_blueprints SET pool = 'PRACTICE' WHERE purpose IS NULL$$, 'assessment_blueprints_variant_identity');
SELECT pg_temp.ok('blueprint: Full 1, Full 2, Reduced 1 and Diagnostic coexist with the legacy blueprint of the version', $$INSERT INTO assessment_blueprints (id, exam_version_id, purpose, form_number, revision, pool) SELECT x.id, c.exam_version_id, x.purpose, x.form, 1, x.pool FROM b2b1_ctx c,
  (VALUES (pg_temp.id('bpF1'), 'FULL', 1, 'FULL_MOCK_1'), (pg_temp.id('bpF2'), 'FULL', 2, 'FULL_MOCK_2'), (pg_temp.id('bpR1'), 'REDUCED', 1, 'REDUCED_MOCK'), (pg_temp.id('bpD1'), 'DIAGNOSTIC', 1, 'DIAGNOSTIC')) AS x(id, purpose, form, pool)$$);
SELECT pg_temp.no('blueprint: a variant identity is unique', $$INSERT INTO assessment_blueprints (exam_version_id, purpose, form_number, revision) SELECT exam_version_id, 'FULL', 1, 1 FROM b2b1_ctx$$, 'assessment_blueprints_variant_identity_key');
SELECT pg_temp.no('blueprint: identity never changes', $$UPDATE assessment_blueprints SET form_number = 3 WHERE id = pg_temp.id('bpF1')$$, 'ASSESSMENT_BLUEPRINT_IDENTITY_IMMUTABLE');
SELECT pg_temp.no('blueprint: a legacy blueprint is not classified after the fact', $$UPDATE assessment_blueprints SET purpose = 'FULL', form_number = 1, revision = 1 WHERE id = (SELECT id FROM assessment_blueprints WHERE purpose IS NULL LIMIT 1)$$, 'ASSESSMENT_BLUEPRINT_IDENTITY_IMMUTABLE');
SELECT pg_temp.no('blueprint: a variant is not published empty', $$UPDATE assessment_blueprints SET status = 'PUBLISHED' WHERE id = pg_temp.id('bpF1')$$, 'ASSESSMENT_BLUEPRINT_PUBLISH_NEEDS_REQUIREMENTS');
SELECT pg_temp.no('requirement: a legacy blueprint takes none', $$INSERT INTO assessment_blueprint_requirements (blueprint_id, requirement_key, kind, value, authority, policy_id, policy_version) SELECT id, 'k', 'POOL_POLICY', '{}', 'STUDYUS_POLICY', 'p', '1' FROM assessment_blueprints WHERE purpose IS NULL LIMIT 1$$, 'ASSESSMENT_BLUEPRINT_REQUIREMENT_NEEDS_VARIANT');
SELECT pg_temp.no('requirement: an official requirement cites a source', $$INSERT INTO assessment_blueprint_requirements (blueprint_id, requirement_key, kind, value, authority) VALUES (pg_temp.id('bpF1'), 'TOTAL_ITEM_COUNT', 'TOTAL_ITEM_COUNT', '175', 'OFFICIAL')$$, 'ASSESSMENT_BLUEPRINT_OFFICIAL_WITHOUT_SOURCE');
SELECT pg_temp.no('requirement: a StudyUs policy names its policy', $$INSERT INTO assessment_blueprint_requirements (blueprint_id, requirement_key, kind, value, authority) VALUES (pg_temp.id('bpF1'), 'DIFFICULTY', 'DIFFICULTY_DISTRIBUTION', '{}', 'STUDYUS_POLICY')$$, 'assessment_blueprint_requirements_policy_ref');
SELECT pg_temp.no('requirement: reduced size is never official', $$INSERT INTO assessment_blueprint_requirements (blueprint_id, requirement_key, kind, value, authority) VALUES (pg_temp.id('bpR1'), 'REDUCED_SIZE', 'REDUCED_SIZE', '88', 'OFFICIAL')$$, 'assessment_blueprint_requirements_policy_only_kinds');
SELECT pg_temp.ok('requirement: official with its source, policy with its policy', $$WITH r AS (INSERT INTO assessment_blueprint_requirements (id, blueprint_id, requirement_key, kind, value, authority) VALUES (pg_temp.id('req'), pg_temp.id('bpF1'), 'TOTAL_ITEM_COUNT', 'TOTAL_ITEM_COUNT', '175', 'OFFICIAL') RETURNING id)
  INSERT INTO assessment_blueprint_requirement_sources (requirement_id, assessment_source_id) SELECT r.id, s.id FROM r, assessment_sources s WHERE s.source_key = 'b2b1.src';
  INSERT INTO assessment_blueprint_requirements (blueprint_id, requirement_key, kind, value, authority, policy_id, policy_version) VALUES (pg_temp.id('bpF1'), 'POOL_POLICY', 'POOL_POLICY', '{"overlap":"ZERO_INTENTIONAL_OVERLAP"}', 'STUDYUS_POLICY', 'b2-pilot-pools', '1'),
    (pg_temp.id('bpR1'), 'REDUCED_SIZE', 'REDUCED_SIZE', '88', 'STUDYUS_POLICY', 'q1-reduced', '1'), (pg_temp.id('bpF1'), 'STIMULUS_SET:lectura', 'STIMULUS_SET', '{"kind":"PAIRED_PASSAGE","sets":1,"minItems":2,"maxItems":6}', 'STUDYUS_POLICY', 'q1-sets', '1')$$);
SELECT pg_temp.no('requirement: the last source of an official requirement cannot be removed', $$DELETE FROM assessment_blueprint_requirement_sources WHERE requirement_id = pg_temp.id('req')$$, 'ASSESSMENT_BLUEPRINT_OFFICIAL_WITHOUT_SOURCE');
SELECT pg_temp.no('requirement: unique key inside a blueprint', $$INSERT INTO assessment_blueprint_requirements (blueprint_id, requirement_key, kind, value, authority, policy_id, policy_version) VALUES (pg_temp.id('bpF1'), 'POOL_POLICY', 'POOL_POLICY', '{}', 'STUDYUS_POLICY', 'p', '1')$$, 'assessment_blueprint_requirements_key');
SELECT pg_temp.ok('blueprint: Full 1 and Reduced 1 published', $$UPDATE assessment_blueprints SET status = 'PUBLISHED' WHERE id IN (pg_temp.id('bpF1'), pg_temp.id('bpR1'))$$);
SELECT pg_temp.no('requirement: fixed once the variant is published', $$UPDATE assessment_blueprint_requirements SET value = '170' WHERE id = pg_temp.id('req')$$, 'ASSESSMENT_BLUEPRINT_REQUIREMENTS_FIXED');
SELECT pg_temp.no('requirement: none added once published', $$INSERT INTO assessment_blueprint_requirements (blueprint_id, requirement_key, kind, value, authority, policy_id, policy_version) VALUES (pg_temp.id('bpF1'), 'EXPOSURE', 'EXPOSURE_POLICY', '{}', 'STUDYUS_POLICY', 'p', '1')$$, 'ASSESSMENT_BLUEPRINT_REQUIREMENTS_FIXED');
SELECT pg_temp.ok('blueprint: revision 2 of Full 1 drafted beside the published revision 1', $$INSERT INTO assessment_blueprints (id, exam_version_id, purpose, form_number, revision, pool) SELECT pg_temp.id('bpF1r2'), exam_version_id, 'FULL', 1, 2, 'FULL_MOCK_1' FROM b2b1_ctx;
  INSERT INTO assessment_blueprint_requirements (blueprint_id, requirement_key, kind, value, authority, policy_id, policy_version) VALUES (pg_temp.id('bpF1r2'), 'POOL_POLICY', 'POOL_POLICY', '{}', 'STUDYUS_POLICY', 'b2-pilot-pools', '1')$$);
SELECT pg_temp.no('blueprint: one published revision per form', $$UPDATE assessment_blueprints SET status = 'PUBLISHED' WHERE id = pg_temp.id('bpF1r2')$$, 'assessment_blueprints_one_published_revision');
SELECT pg_temp.no('blueprint: the pool of a published variant is fixed', $$UPDATE assessment_blueprints SET pool = 'FULL_MOCK_2' WHERE id = pg_temp.id('bpF1')$$, 'ASSESSMENT_BLUEPRINT_POOL_FIXED');
SELECT pg_temp.ok('blueprint: existing readers still find exactly one legacy blueprint per version', $q$DO $x$ BEGIN IF EXISTS (SELECT 1 FROM assessment_blueprints WHERE purpose IS NULL GROUP BY exam_version_id HAVING count(*) > 1) THEN RAISE EXCEPTION 'dup'; END IF; END $x$$q$);

-- §22 Frozen forms ----------------------------------------------------------------------------------------
SELECT pg_temp.ok('frozen form: no existing instance points at one', $q$DO $x$ BEGIN IF EXISTS (SELECT 1 FROM exam_instances WHERE frozen_form_id IS NOT NULL) OR EXISTS (SELECT 1 FROM assessment_frozen_forms) THEN RAISE EXCEPTION 'forms exist'; END IF; END $x$$q$);
SELECT pg_temp.no('frozen form: not for a legacy blueprint', $$INSERT INTO assessment_frozen_forms (blueprint_id, fidelity, attempt_type, pool, created_by) SELECT id, 'FULL', 'FULL_MOCK', 'FULL_MOCK_1', pg_temp.id('author') FROM assessment_blueprints WHERE purpose IS NULL LIMIT 1$$, 'ASSESSMENT_FROZEN_FORM_BLUEPRINT_MISMATCH');
SELECT pg_temp.no('frozen form: not for a diagnostic blueprint', $$INSERT INTO assessment_frozen_forms (blueprint_id, fidelity, attempt_type, pool, created_by) VALUES (pg_temp.id('bpD1'), 'FULL', 'FULL_MOCK', 'FULL_MOCK_1', pg_temp.id('author'))$$, 'ASSESSMENT_FROZEN_FORM_BLUEPRINT_MISMATCH');
SELECT pg_temp.no('frozen form: a full form is a full mock', $$INSERT INTO assessment_frozen_forms (blueprint_id, fidelity, attempt_type, pool, created_by) VALUES (pg_temp.id('bpF1'), 'FULL', 'REDUCED_MOCK', 'FULL_MOCK_1', pg_temp.id('author'))$$, 'assessment_frozen_forms_fidelity_attempt');
SELECT pg_temp.no('frozen form: its pool is the blueprint pool', $$INSERT INTO assessment_frozen_forms (blueprint_id, fidelity, attempt_type, pool, created_by) VALUES (pg_temp.id('bpF1'), 'FULL', 'FULL_MOCK', 'FULL_MOCK_2', pg_temp.id('author'))$$, 'ASSESSMENT_FROZEN_FORM_POOL_MISMATCH');
SELECT pg_temp.ok('frozen form: drafted for Full 1', $$INSERT INTO assessment_frozen_forms (id, blueprint_id, fidelity, attempt_type, pool, created_by) VALUES (pg_temp.id('form'), pg_temp.id('bpF1'), 'FULL', 'FULL_MOCK', 'FULL_MOCK_1', pg_temp.id('author'))$$);
SELECT pg_temp.no('frozen form: not published empty', $$UPDATE assessment_frozen_forms SET status = 'PUBLISHED', frozen_at = now(), frozen_by = pg_temp.id('author'), form_hash = repeat('c', 64) WHERE id = pg_temp.id('form')$$, 'ASSESSMENT_FROZEN_FORM_EMPTY');
SELECT pg_temp.no('frozen form: a position references a Question Bank item version', $$INSERT INTO assessment_frozen_form_positions (form_id, slot_index, approved_item_id) VALUES (pg_temp.id('form'), 0, gen_random_uuid())$$, 'ASSESSMENT_FROZEN_FORM_NEEDS_BANK_VERSION');
SELECT pg_temp.no('frozen form: a stimulus-bound item carries its stimulus version', $$INSERT INTO assessment_frozen_form_positions (form_id, slot_index, approved_item_id) VALUES (pg_temp.id('form'), 1, pg_temp.id('v2'))$$, 'ASSESSMENT_FROZEN_FORM_STIMULUS_MISMATCH');
SELECT pg_temp.ok('frozen form: ordered positions, a standalone item and a stimulus group', $$INSERT INTO assessment_frozen_form_positions (form_id, slot_index, approved_item_id, stimulus_version_id, unit_position) VALUES
  (pg_temp.id('form'), 0, pg_temp.id('v1'), NULL, NULL), (pg_temp.id('form'), 1, pg_temp.id('v2'), pg_temp.id('sv'), 1), (pg_temp.id('form'), 2, pg_temp.id('v3'), pg_temp.id('sv'), 2)$$);
SELECT pg_temp.no('frozen form: an item version appears once', $$INSERT INTO assessment_frozen_form_positions (form_id, slot_index, approved_item_id) VALUES (pg_temp.id('form'), 3, pg_temp.id('v1'))$$, 'assessment_frozen_form_positions_form_id_approved_item_id_key');
SELECT pg_temp.no('frozen form: a slot holds one item', $$INSERT INTO assessment_frozen_form_positions (form_id, slot_index, approved_item_id) SELECT pg_temp.id('form'), 0, legacy_version_id FROM b2b1_ctx$$, 'assessment_frozen_form_positions_pkey');
SELECT pg_temp.no('frozen form: publishing records who froze it and its hash', $$UPDATE assessment_frozen_forms SET status = 'PUBLISHED' WHERE id = pg_temp.id('form')$$, 'assessment_frozen_forms_frozen');
SELECT pg_temp.ok('frozen form: published', $$UPDATE assessment_frozen_forms SET status = 'PUBLISHED', frozen_at = now(), frozen_by = pg_temp.id('author'), form_hash = repeat('c', 64) WHERE id = pg_temp.id('form')$$);
SELECT pg_temp.no('frozen form: positions immutable after publish (update)', $$UPDATE assessment_frozen_form_positions SET slot_index = 9 WHERE form_id = pg_temp.id('form') AND slot_index = 0$$, 'ASSESSMENT_FROZEN_FORM_IMMUTABLE');
SELECT pg_temp.no('frozen form: positions immutable after publish (insert)', $$INSERT INTO assessment_frozen_form_positions (form_id, slot_index, approved_item_id) SELECT pg_temp.id('form'), 5, legacy_version_id FROM b2b1_ctx$$, 'ASSESSMENT_FROZEN_FORM_IMMUTABLE');
SELECT pg_temp.no('frozen form: positions immutable after publish (delete)', $$DELETE FROM assessment_frozen_form_positions WHERE form_id = pg_temp.id('form')$$, 'ASSESSMENT_FROZEN_FORM_IMMUTABLE');
SELECT pg_temp.no('frozen form: a published form is not rewritten', $$UPDATE assessment_frozen_forms SET form_hash = repeat('d', 64) WHERE id = pg_temp.id('form')$$, 'ASSESSMENT_FROZEN_FORM_IMMUTABLE');
SELECT pg_temp.no('frozen form: a published form is not deleted', $$DELETE FROM assessment_frozen_forms WHERE id = pg_temp.id('form')$$, 'ASSESSMENT_FROZEN_FORM_IMMUTABLE');
SELECT pg_temp.no('frozen form: the item version it references stays immutable', $$UPDATE approved_items SET content = '{"stem":"changed"}' WHERE id = pg_temp.id('v1')$$, 'QUESTION_BANK_VERSION_IMMUTABLE');
SELECT pg_temp.ok('frozen form: a second form is drafted for the same blueprint', $$INSERT INTO assessment_frozen_forms (id, blueprint_id, fidelity, attempt_type, pool, created_by) VALUES (pg_temp.id('form2'), pg_temp.id('bpF1'), 'FULL', 'FULL_MOCK', 'FULL_MOCK_1', pg_temp.id('author'));
  INSERT INTO assessment_frozen_form_positions (form_id, slot_index, approved_item_id) VALUES (pg_temp.id('form2'), 0, pg_temp.id('v1'))$$);
SELECT pg_temp.no('frozen form: one published form per blueprint', $$UPDATE assessment_frozen_forms SET status = 'PUBLISHED', frozen_at = now(), frozen_by = pg_temp.id('author'), form_hash = repeat('e', 64) WHERE id = pg_temp.id('form2')$$, 'assessment_frozen_forms_one_published');
SELECT pg_temp.ok('frozen form: an instance can reference a form, and older instances stay valid without one', $q$DO $x$ DECLARE n bigint; BEGIN
  SELECT count(*) INTO n FROM exam_instances; UPDATE exam_instances SET frozen_form_id = pg_temp.id('form') WHERE id = (SELECT id FROM exam_instances ORDER BY id LIMIT 1);
  IF (SELECT count(*) FROM exam_instances WHERE frozen_form_id IS NULL) < greatest(n - 1, 0) THEN RAISE EXCEPTION 'instances changed'; END IF; END $x$$q$);
SELECT pg_temp.ok('frozen form: retired with a reason', $$UPDATE exam_instances SET frozen_form_id = NULL WHERE frozen_form_id IS NOT NULL; UPDATE assessment_frozen_forms SET status = 'RETIRED', retired_at = now(), retire_reason = 'replaced' WHERE id = pg_temp.id('form')$$);

\o
\pset tuples_only on
SELECT 'B2B1_SCHEMA_INVARIANTS = ' || count(*) || ' PASS' FROM b2b1_results;
ROLLBACK;
