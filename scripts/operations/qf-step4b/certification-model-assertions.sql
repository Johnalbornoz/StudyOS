-- QF V5.2 -- behaviour of the PROPOSED Exam Bank certification / coverage model, on a throwaway database only.
-- Every line of output is "ok <name>" or "FAIL <name> ...". Run by scripts/qf-step4b-ephemeral-db-test.sh.
\set QUIET on
\pset tuples_only on
\pset format unaligned
CREATE FUNCTION pg_temp.refused(name text, q text, expect text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE q;
  RETURN 'FAIL ' || name || ' (accepted; expected ' || expect || ')';
EXCEPTION WHEN OTHERS THEN
  RETURN CASE WHEN SQLERRM LIKE '%' || expect || '%' THEN 'ok ' || name ELSE 'FAIL ' || name || ' (' || SQLERRM || ')' END;
END $$;
CREATE FUNCTION pg_temp.accepted(name text, q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE q;
  RETURN 'ok ' || name;
EXCEPTION WHEN OTHERS THEN
  RETURN 'FAIL ' || name || ' (' || SQLERRM || ')';
END $$;
CREATE FUNCTION pg_temp.eq(name text, got bigint, want bigint) RETURNS text LANGUAGE sql AS $$ SELECT CASE WHEN got = want THEN 'ok ' || name ELSE 'FAIL ' || name || ' (got ' || got || ', want ' || want || ')' END $$;

INSERT INTO assessment_systems (system_id, display_name, organization, system_type, lifecycle, provenance) VALUES ('TSYS', 'Test system', 'test', 'EXAM', 'ACTIVE', '{"basis":"TEST_FIXTURE"}');
INSERT INTO assessment_system_versions (system_id, version_id, label, lifecycle, provenance) VALUES ('TSYS', 'v1', 'v1', 'ACTIVE', '{"basis":"TEST_FIXTURE"}');
INSERT INTO assessment_system_nodes (node_id, system_id, version_id, kind, code, display_name) VALUES ('TSYS.MATH.P1', 'TSYS', 'v1', 'COMPONENT', 'MATH.P1', 'Paper 1');
INSERT INTO assessment_construct_cores (construct_family_id, family_version, family_type, canonical_subject, primary_concept_stable_id, lifecycle, family, content_hash)
  VALUES ('tf.test.core', '1.0.0', 'MATH_PROBLEM', 'Mathematics', 'math.test.concept', 'UNDER_REVIEW', '{"familyId":"tf.test.core","version":"1.0.0"}', repeat('a', 64));
INSERT INTO assessment_adapters (adapter_id, adapter_version, status, source, system_id, system_version_id, definition, content_hash) VALUES ('TSYS.MATH.P1', '1.0', 'PROVISIONAL', 'EA1_COMPONENT_PROFILE', 'TSYS', 'v1', '{}', repeat('b', 64));
INSERT INTO assessment_instance_renderers (renderer_version, construct, strategy, status) VALUES ('parametric.test@1.0.0', 'TEST_CONSTRUCT', 'PARAMETRIC_DETERMINISTIC', 'PROVISIONAL');
INSERT INTO assessment_construct_core_applicability (core_id, system_profile_id, adapter_id, status, basis) SELECT id, 'TSYS', 'TSYS.MATH.P1', 'SUPPORTED', '{}' FROM assessment_construct_cores WHERE construct_family_id = 'tf.test.core';

-- CERTIFIED is a recorded decision
SELECT pg_temp.refused('adapter cannot be flagged CERTIFIED without a record', $q$UPDATE assessment_adapters SET status = 'CERTIFIED' WHERE adapter_id = 'TSYS.MATH.P1'$q$, 'ADAPTER_CERTIFIED_NEEDS_A_CERTIFICATION');
SELECT pg_temp.refused('core cannot be flagged CERTIFIED without a record', $q$UPDATE assessment_construct_cores SET lifecycle = 'CERTIFIED', certification_version = 'c1', certified_by = 'rev1', certified_at = now() WHERE construct_family_id = 'tf.test.core'$q$, 'CORE_CERTIFIED_NEEDS_A_CERTIFICATION');
SELECT pg_temp.refused('renderer cannot be flagged CERTIFIED without a certified envelope', $q$UPDATE assessment_instance_renderers SET status = 'CERTIFIED' WHERE renderer_version = 'parametric.test@1.0.0'$q$, 'RENDERER_CERTIFIED_NEEDS_A_CERTIFIED_ENVELOPE');

-- reviewer scope
SELECT pg_temp.refused('a certification that names no qualification of the reviewer is refused', $q$INSERT INTO assessment_certifications (reviewer_id, authority, qualification_id, canonical_subject, system_id, object_type, object_id, object_version, decision, evidence_hash) VALUES ('rev1', 'INTERNAL_PILOT_REVIEWER', gen_random_uuid(), 'Mathematics', 'TSYS', 'CONSTRUCT_CORE', 'tf.test.core', '1.0.0', 'APPROVE', repeat('a', 64))$q$, 'CERTIFICATION_REVIEWER_NOT_QUALIFIED');
INSERT INTO assessment_reviewer_qualifications (reviewer_id, authority, canonical_subject, system_id, granted_by, granted_at) VALUES ('rev1', 'INTERNAL_PILOT_REVIEWER', 'Mathematics', 'TSYS', 'admin', now() - interval '1 day');
CREATE TEMP TABLE q AS SELECT id FROM assessment_reviewer_qualifications WHERE reviewer_id = 'rev1';
CREATE FUNCTION pg_temp.certify(p_type text, p_id text, p_version text, p_hash text, p_decision text DEFAULT 'APPROVE', p_subject text DEFAULT 'Mathematics', p_reviewer text DEFAULT 'rev1', p_notes text DEFAULT NULL, p_at timestamptz DEFAULT now()) RETURNS void LANGUAGE sql AS $$
  INSERT INTO assessment_certifications (reviewer_id, authority, qualification_id, canonical_subject, system_id, object_type, object_id, object_version, decision, decided_at, evidence_hash, notes)
  SELECT p_reviewer, 'INTERNAL_PILOT_REVIEWER', q.id, p_subject, 'TSYS', p_type, p_id, p_version, p_decision, p_at, p_hash, p_notes FROM q $$;
SELECT pg_temp.refused('a scope the reviewer does not hold is refused', $q$SELECT pg_temp.certify('CONSTRUCT_CORE', 'tf.test.core', '1.0.0', repeat('a', 64), 'APPROVE', 'Physics')$q$, 'CERTIFICATION_SCOPE_NOT_COVERED');
SELECT pg_temp.refused('another reviewer cannot use the qualification', $q$SELECT pg_temp.certify('CONSTRUCT_CORE', 'tf.test.core', '1.0.0', repeat('a', 64), 'APPROVE', 'Mathematics', 'someone-else')$q$, 'CERTIFICATION_REVIEWER_NOT_QUALIFIED');
SELECT pg_temp.refused('a decision made before the grant is refused', $q$SELECT pg_temp.certify('CONSTRUCT_CORE', 'tf.test.core', '1.0.0', repeat('a', 64), 'APPROVE', 'Mathematics', 'rev1', NULL, now() - interval '2 days')$q$, 'CERTIFICATION_QUALIFICATION_NOT_IN_FORCE');
SELECT pg_temp.refused('APPROVE_WITH_CHANGES needs a reason', $q$SELECT pg_temp.certify('CONSTRUCT_CORE', 'tf.test.core', '1.0.0', repeat('a', 64), 'APPROVE_WITH_CHANGES')$q$, 'assessment_certifications_reason_ck');

-- an approval of OTHER content certifies nothing
SELECT pg_temp.certify('ASSESSMENT_ADAPTER', 'TSYS.MATH.P1', '1.0', repeat('f', 64));
SELECT pg_temp.refused('an approval of other content does not certify the adapter', $q$UPDATE assessment_adapters SET status = 'CERTIFIED' WHERE adapter_id = 'TSYS.MATH.P1'$q$, 'ADAPTER_CERTIFIED_NEEDS_A_CERTIFICATION');
SELECT pg_temp.certify('ASSESSMENT_ADAPTER', 'TSYS.MATH.P1', '1.0', repeat('b', 64));
SELECT pg_temp.accepted('adapter CERTIFIED with a record on its content', $q$UPDATE assessment_adapters SET status = 'CERTIFIED' WHERE adapter_id = 'TSYS.MATH.P1'$q$);
SELECT pg_temp.certify('CONSTRUCT_CORE', 'tf.test.core', '1.0.0', repeat('a', 64));
SELECT pg_temp.accepted('core CERTIFIED with a record on its content', $q$UPDATE assessment_construct_cores SET lifecycle = 'CERTIFIED', certification_version = 'c1', certified_by = 'rev1', certified_at = now() WHERE construct_family_id = 'tf.test.core'$q$);
INSERT INTO assessment_renderer_envelopes (envelope_hash, renderer_version, construct_family_id, family_version, envelope)
  VALUES (repeat('c', 64), 'parametric.test@1.0.0', 'tf.test.core', '1.0.0', '{"rendererVersion":"parametric.test@1.0.0","constructFamilyId":"tf.test.core","constructFamilyVersion":"1.0.0","adapterIds":["TSYS.MATH.P1"],"bands":[{"planningBand":"FOUNDATIONAL","itemDifficulty":2},{"planningBand":"STANDARD","itemDifficulty":3},{"planningBand":"CHALLENGE","itemDifficulty":4}]}');
SELECT pg_temp.refused('an envelope is immutable', $q$UPDATE assessment_renderer_envelopes SET envelope = jsonb_set(envelope, '{bands,0,itemDifficulty}', '1')$q$, 'ROW_IS_IMMUTABLE');
SELECT pg_temp.certify('RENDERER_ENVELOPE', 'parametric.test@1.0.0', '1.0.0', repeat('c', 64));
SELECT pg_temp.accepted('renderer CERTIFIED with a certified envelope', $q$UPDATE assessment_instance_renderers SET status = 'CERTIFIED' WHERE renderer_version = 'parametric.test@1.0.0'$q$);
SELECT pg_temp.refused('certifications are append-only (update)', $q$UPDATE assessment_certifications SET decision = 'APPROVE'$q$, 'CERTIFICATION_IS_APPEND_ONLY');
SELECT pg_temp.refused('certifications are append-only (delete)', $q$DELETE FROM assessment_certifications$q$, 'CERTIFICATION_IS_APPEND_ONLY');

-- the instance
INSERT INTO assessment_certification_policies (policy_hash, policy_id, version, may_grant_scopes, policy) VALUES (repeat('5', 64), 'TEST_POLICY', 'V1', ARRAY['PILOT_PREVIEW'], '{"rules":[],"deliverableRights":{"PILOT_PREVIEW":["STUDYUS_ORIGINAL_DETERMINISTIC"],"PRODUCTION":[]}}');
CREATE FUNCTION pg_temp.instance(p_seed text, p_difficulty int, p_mode text, p_digest text, p_envelope text DEFAULT repeat('c', 64), p_rights text DEFAULT 'STUDYUS_OWNED', p_learner jsonb DEFAULT '{"prompt":"x","stimulus":null}', p_state text DEFAULT 'AUTOMATED_CERTIFIED_PILOT', p_scopes text DEFAULT 'PILOT_PREVIEW', p_category text DEFAULT 'STUDYUS_ORIGINAL_DETERMINISTIC') RETURNS text LANGUAGE sql AS $$
  SELECT format($f$INSERT INTO assessment_item_instances (core_id, primary_concept_stable_id, adaptation_specification_id, system_id, system_version_id, adapter_id, adapter_version, blueprint_bucket_id, seed, parameter_set_id, renderer_version, certification_version, learner, answer_key, response_policy, item_difficulty, envelope_hash, content_hash, certification_digest, certification_mode, rights_status, rights_basis, certification_state, eligibility_scopes, rights_category, policy_hash, recognition_id)
    SELECT id, 'math.test.concept', repeat('1', 64), 'TSYS', 'v1', 'TSYS.MATH.P1', '1.0', 't.cfg/p1/obj#0', %L, encode(sha256(convert_to(%L, 'UTF8')), 'hex'), 'parametric.test@1.0.0', 'c1', %L, '{"answers":["1"]}', '{"kind":"NUMERIC"}', %s, %L, repeat('d', 64), %L, %L, %L, 'Rendered deterministically from a StudyUs core.', %L, ARRAY[%L], %L, repeat('5', 64), %L FROM assessment_construct_cores WHERE construct_family_id = 'tf.test.core'$f$,
    p_seed, p_seed, p_learner::text, COALESCE(p_difficulty::text, 'NULL'), p_envelope, p_digest, p_mode, p_rights, p_state, p_scopes, p_category, p_seed) $$;
SELECT pg_temp.refused('an instance without a difficulty is refused', pg_temp.instance('s0', NULL, 'INHERITED_DETERMINISTIC_CERTIFICATION', repeat('0', 64)), 'DIFFICULTY_NOT_RECORDED');
SELECT pg_temp.refused('an instance without rights is refused', pg_temp.instance('s0', 3, 'INHERITED_DETERMINISTIC_CERTIFICATION', repeat('0', 64), repeat('c', 64), NULL), 'RIGHTS_NOT_VALID');
SELECT pg_temp.refused('an unclassified blueprint places nothing', pg_temp.instance('s0', 3, 'INHERITED_DETERMINISTIC_CERTIFICATION', repeat('0', 64)), 'BLUEPRINT_NOT_GOVERNED');
INSERT INTO assessment_blueprint_classifications (blueprint_id, classification_version, system_id, system_version_id, adapter_id, blueprint_class, facts, content_hash) VALUES ('t.cfg/p1', 'demo-1', 'TSYS', 'v1', 'TSYS.MATH.P1', 'DEMO', '{}', repeat('9', 64));
INSERT INTO assessment_blueprint_buckets (bucket_id, blueprint_id, classification_version, objective_code, primary_concept_stable_ids) VALUES ('t.cfg/p1/obj#0', 't.cfg/p1', 'demo-1', 'obj', ARRAY['math.test.concept']);
SELECT pg_temp.certify('BLUEPRINT_CLASSIFICATION', 't.cfg/p1', 'demo-1', repeat('9', 64));
SELECT pg_temp.refused('a certified DEMO classification still places nothing', pg_temp.instance('s0', 3, 'INHERITED_DETERMINISTIC_CERTIFICATION', repeat('0', 64)), 'BLUEPRINT_NOT_GOVERNED');
INSERT INTO assessment_blueprint_classifications (blueprint_id, classification_version, system_id, system_version_id, adapter_id, blueprint_class, facts, content_hash) VALUES ('t.cfg/p1', 'pilot-1', 'TSYS', 'v1', 'TSYS.MATH.P1', 'REDUCED', '{}', repeat('e', 64));
INSERT INTO assessment_blueprint_buckets (bucket_id, blueprint_id, classification_version, objective_code, primary_concept_stable_ids) VALUES ('t.cfg/p1/obj#0', 't.cfg/p1', 'pilot-1', 'obj', ARRAY['math.test.concept']);
SELECT pg_temp.refused('a REDUCED classification nobody certified places nothing', pg_temp.instance('s0', 3, 'INHERITED_DETERMINISTIC_CERTIFICATION', repeat('0', 64)), 'BLUEPRINT_NOT_GOVERNED');
SELECT pg_temp.certify('BLUEPRINT_CLASSIFICATION', 't.cfg/p1', 'pilot-1', repeat('e', 64));
SELECT pg_temp.refused('a difficulty the envelope does not assign is refused', pg_temp.instance('s0', 5, 'INHERITED_DETERMINISTIC_CERTIFICATION', repeat('0', 64)), 'DIFFICULTY_IS_NOT_THE_ENVELOPES');
SELECT pg_temp.refused('difficulty 6 is refused', pg_temp.instance('s0', 6, 'INHERITED_DETERMINISTIC_CERTIFICATION', repeat('0', 64)), 'DIFFICULTY_IS_NOT_THE_ENVELOPES');
SELECT pg_temp.refused('stimulus-bearing content does not inherit', pg_temp.instance('s0', 3, 'INHERITED_DETERMINISTIC_CERTIFICATION', repeat('0', 64), repeat('c', 64), 'STUDYUS_OWNED', '{"prompt":"x","stimulus":"a passage"}'), 'CONTENT_NEEDS_AN_INDIVIDUAL_REVIEW');
SELECT pg_temp.refused('no certification mode is refused', pg_temp.instance('s0', 3, NULL, repeat('0', 64)), 'NO_CERTIFICATION_MODE');
SELECT pg_temp.accepted('INHERITED instance inside a certified envelope is stored', pg_temp.instance('s1', 3, 'INHERITED_DETERMINISTIC_CERTIFICATION', repeat('1', 64)));
SELECT pg_temp.eq('it is Student-eligible', (SELECT count(*) FROM student_eligible_item_instances), 1);
SELECT pg_temp.eq('its difficulty is stored', (SELECT item_difficulty FROM student_eligible_item_instances LIMIT 1), 3);
SELECT pg_temp.refused('INDIVIDUAL mode without a review of that instance is refused', pg_temp.instance('s2', 4, 'INDIVIDUAL_ITEM_REVIEW', repeat('2', 64)), 'NO_INDIVIDUAL_REVIEW');
SELECT pg_temp.certify('ITEM_INSTANCE', repeat('2', 64), 'parametric.test@1.0.0', repeat('2', 64));
SELECT pg_temp.accepted('INDIVIDUAL instance with its own review is stored', pg_temp.instance('s2', 4, 'INDIVIDUAL_ITEM_REVIEW', repeat('2', 64)));
SELECT pg_temp.eq('both are Student-eligible', (SELECT count(*) FROM student_eligible_item_instances), 2);

-- revocation: a later non-approval of the envelope takes its inherited instances out of supply, and only those
SELECT pg_temp.certify('RENDERER_ENVELOPE', 'parametric.test@1.0.0', '1.0.0', repeat('c', 64), 'REJECT', 'Mathematics', 'rev1', 'A defect was found in the envelope.', now() + interval '1 second');
SELECT pg_temp.eq('rejecting the envelope withdraws the inherited instance only', (SELECT count(*) FROM student_eligible_item_instances), 1);
SELECT pg_temp.eq('the one left is the individually reviewed one', (SELECT count(*) FROM student_eligible_item_instances WHERE certification_mode = 'INDIVIDUAL_ITEM_REVIEW'), 1);
SELECT pg_temp.refused('no new inherited instance after the rejection', pg_temp.instance('s3', 3, 'INHERITED_DETERMINISTIC_CERTIFICATION', repeat('3', 64)), 'RENDERER_ENVELOPE_NOT_CERTIFIED');

-- qualifications: revoked once, never edited, never deleted
SELECT pg_temp.refused('a qualification cannot be edited', $q$UPDATE assessment_reviewer_qualifications SET canonical_subject = 'Physics', revoked_at = now()$q$, 'REVIEWER_QUALIFICATION_IS_IMMUTABLE');
SELECT pg_temp.accepted('a qualification can be revoked', $q$UPDATE assessment_reviewer_qualifications SET revoked_at = now() + interval '2 seconds'$q$);
SELECT pg_temp.refused('a qualification cannot be deleted', $q$DELETE FROM assessment_reviewer_qualifications$q$, 'REVIEWER_QUALIFICATION_NO_DELETE');
SELECT pg_temp.refused('no certification after the revocation', $q$SELECT pg_temp.certify('CONSTRUCT_CORE', 'tf.test.core', '1.0.0', repeat('a', 64), 'APPROVE', 'Mathematics', 'rev1', NULL, now() + interval '1 hour')$q$, 'CERTIFICATION_QUALIFICATION_NOT_IN_FORCE');

-- ============================================================ V5.2 ============================================================
-- certification by POLICY: an object nobody approved becomes eligible by a recorded automated decision, and only then
INSERT INTO assessment_renderer_envelopes (envelope_hash, renderer_version, construct_family_id, family_version, envelope)
  VALUES (repeat('7', 64), 'parametric.test@1.0.0', 'tf.test.core', '1.0.0', '{"rendererVersion":"parametric.test@1.0.0","constructFamilyId":"tf.test.core","constructFamilyVersion":"1.0.0","adapterIds":["TSYS.MATH.P1"],"bands":[{"planningBand":"STANDARD","itemDifficulty":3}]}');
SELECT pg_temp.refused('an envelope nobody and no policy certified supplies nothing', pg_temp.instance('v1', 3, 'INHERITED_DETERMINISTIC_CERTIFICATION', repeat('a', 64), repeat('7', 64)), 'RENDERER_ENVELOPE_NOT_CERTIFIED');
SELECT pg_temp.refused('HUMAN_CERTIFIED cannot be recorded without a person''s approval', $q$INSERT INTO assessment_object_certifications (object_type, object_id, object_version, content_hash, state, policy_hash, decided_by) VALUES ('RENDERER_ENVELOPE', 'parametric.test@1.0.0', '1.0.0', repeat('7', 64), 'HUMAN_CERTIFIED', repeat('5', 64), 'engine')$q$, 'HUMAN_CERTIFIED_NEEDS_AN_APPROVAL_OF_THIS_CONTENT');
SELECT pg_temp.refused('AUTOMATED_CERTIFIED_PILOT cannot carry an unmet reason', $q$INSERT INTO assessment_object_certifications (object_type, object_id, object_version, content_hash, state, policy_hash, reasons, decided_by) VALUES ('RENDERER_ENVELOPE', 'parametric.test@1.0.0', '1.0.0', repeat('7', 64), 'AUTOMATED_CERTIFIED_PILOT', repeat('5', 64), '[{"ruleId":"X"}]', 'engine')$q$, 'assessment_object_certifications_clean_ck');
SELECT pg_temp.refused('REVIEW_REQUIRED must say why', $q$INSERT INTO assessment_object_certifications (object_type, object_id, object_version, content_hash, state, policy_hash, decided_by) VALUES ('RENDERER_ENVELOPE', 'parametric.test@1.0.0', '1.0.0', repeat('7', 64), 'REVIEW_REQUIRED', repeat('5', 64), 'engine')$q$, 'assessment_object_certifications_reason_ck');
INSERT INTO assessment_object_certifications (object_type, object_id, object_version, content_hash, state, policy_hash, decided_by, decided_at) VALUES ('RENDERER_ENVELOPE', 'parametric.test@1.0.0', '1.0.0', repeat('7', 64), 'AUTOMATED_CERTIFIED_PILOT', repeat('5', 64), 'engine', now() + interval '3 seconds');
SELECT pg_temp.accepted('an instance inherits from an envelope the policy certified: no person approved it', pg_temp.instance('v1', 3, 'INHERITED_DETERMINISTIC_CERTIFICATION', repeat('a', 64), repeat('7', 64)));
SELECT pg_temp.refused('object certifications are append-only', $q$UPDATE assessment_object_certifications SET state = 'RETIRED'$q$, 'OBJECT_CERTIFICATION_IS_APPEND_ONLY');
SELECT pg_temp.refused('a policy is immutable', $q$UPDATE assessment_certification_policies SET may_grant_scopes = ARRAY['PILOT_PREVIEW', 'PRODUCTION']$q$, 'CERTIFICATION_POLICY_IS_IMMUTABLE');
-- certification is not eligibility: PRODUCTION is not something a calibration policy grants
SELECT pg_temp.refused('PRODUCTION is refused under a policy that does not deliver there', pg_temp.instance('v2', 3, 'INHERITED_DETERMINISTIC_CERTIFICATION', repeat('b', 64), repeat('7', 64), 'STUDYUS_OWNED', '{"prompt":"x","stimulus":null}', 'AUTOMATED_CERTIFIED_PILOT', 'PRODUCTION'), 'RIGHTS_STATE_NOT_DELIVERABLE');
SELECT pg_temp.refused('a state that is not a certification delivers nothing', pg_temp.instance('v2', 3, 'INHERITED_DETERMINISTIC_CERTIFICATION', repeat('b', 64), repeat('7', 64), 'STUDYUS_OWNED', '{"prompt":"x","stimulus":null}', 'REVIEW_REQUIRED'), 'NOT_CERTIFIED');
SELECT pg_temp.refused('a rights category the policy does not deliver is refused', pg_temp.instance('v2', 3, 'INHERITED_DETERMINISTIC_CERTIFICATION', repeat('b', 64), repeat('7', 64), 'STUDYUS_OWNED', '{"prompt":"x","stimulus":null}', 'AUTOMATED_CERTIFIED_PILOT', 'PILOT_PREVIEW', 'STUDYUS_ORIGINAL_GENERATED'), 'RIGHTS_STATE_NOT_DELIVERABLE');
SELECT pg_temp.eq('pilot view holds the pilot instances', (SELECT count(*) FROM student_eligible_item_instances_pilot), 2);
SELECT pg_temp.eq('production view holds nothing', (SELECT count(*) FROM student_eligible_item_instances_production), 0);
-- an incident freezes the envelope: its instances are quarantined, and no other instance is
INSERT INTO assessment_envelope_incidents (envelope_hash, reason, opened_by) VALUES (repeat('7', 64), 'A critical defect was found by audit.', 'auditor');
SELECT pg_temp.eq('an open incident quarantines the envelope''s instances only', (SELECT count(*) FROM student_eligible_item_instances), 1);
SELECT pg_temp.refused('nothing new is stored from a quarantined envelope', pg_temp.instance('v3', 3, 'INHERITED_DETERMINISTIC_CERTIFICATION', repeat('c', 64), repeat('7', 64)), 'QUARANTINED');
UPDATE assessment_envelope_incidents SET status = 'RESOLVED', resolved_by = 'auditor', resolved_at = now();
SELECT pg_temp.eq('resolving the incident returns them', (SELECT count(*) FROM student_eligible_item_instances), 2);
-- a later non-deliverable state of the object withdraws what the policy had certified
INSERT INTO assessment_object_certifications (object_type, object_id, object_version, content_hash, state, policy_hash, reasons, decided_by, decided_at) VALUES ('RENDERER_ENVELOPE', 'parametric.test@1.0.0', '1.0.0', repeat('7', 64), 'QUARANTINED', repeat('5', 64), '[{"ruleId":"AUDIT","reasonCode":"CRITICAL_DEFECT"}]', 'auditor', now() + interval '5 seconds');
SELECT pg_temp.eq('a later QUARANTINED state withdraws the automatically certified envelope', (SELECT count(*) FROM student_eligible_item_instances WHERE envelope_hash = repeat('7', 64)), 0);
SELECT pg_temp.refused('a coverage snapshot cannot claim more capacity than distinct variants', $q$INSERT INTO assessment_coverage_snapshots (policy_hash, eligibility_scope, raw_variant_capacity, distinct_deliverable_variants, certified_delivery_capacity, effective_repeatability_depth, summary) VALUES (repeat('5', 64), 'PILOT_PREVIEW', 100, 50, 60, 3, '{}')$q$, 'assessment_coverage_snapshots_capacity_ck');
SELECT pg_temp.refused('a batch records zero provider calls or is refused', $q$INSERT INTO assessment_certification_batches (batch_id, policy_hash, inputs_hash, provider_calls) VALUES ('b1', repeat('5', 64), repeat('6', 64), 1)$q$, 'provider_calls');
SELECT pg_temp.eq('the eligibility view in force is the strongest one', (SELECT count(*) FROM (SELECT public.assessment_supply_view_invariant() AS v) x WHERE v IS NULL), 1);
-- the table holds Exam Bank items and nothing else; coverage demand is exam demand only
SELECT pg_temp.refused('an item that is not an EXAM_BANK_ITEM cannot be stored as an instance', $q$UPDATE assessment_item_instances SET item_type = 'LEARNING_ITEM'$q$, 'ITEM_INSTANCE_IS_IMMUTABLE');
INSERT INTO assessment_coverage_snapshots (policy_hash, eligibility_scope, raw_variant_capacity, distinct_deliverable_variants, certified_delivery_capacity, effective_repeatability_depth, summary) VALUES (repeat('5', 64), 'PILOT_PREVIEW', 100, 50, 40, 3, '{}');
SELECT pg_temp.refused('a practice set or an internal assessment is not a demand on the Exam Bank', $q$INSERT INTO assessment_coverage_gaps (snapshot_id, demand_kind, difficulty_band, required, certified_capacity, missing, blocking_reason, fill) SELECT id, 'PRACTICE', 'ANY', 3, 0, 3, 'x', 'RENDER_DETERMINISTIC_CAPACITY' FROM assessment_coverage_snapshots$q$, 'demand_kind');
