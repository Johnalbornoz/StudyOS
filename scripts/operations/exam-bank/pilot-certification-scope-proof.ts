/**
 * TRACK B -- proof that the automated pilot certification path is narrowly fail-closed (migrations 20261124_1000..1200).
 * Every attempt runs against the database's own guards inside ONE transaction that is always ROLLED BACK.
 *
 *   EXAM_BANK_PUBLICATION_FP=<fp> npx tsx --env-file=<env> scripts/operations/exam-bank/pilot-certification-scope-proof.ts
 */
import { createHash } from 'crypto';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
const TARGETS: Readonly<Record<string, string>> = { '2a29b99ee14a22b4': 'DEV', '4c249c68e0627b9f': 'PREVIEW_TRACK_B' };
const results: boolean[] = [];
const check = (id: string, ok: boolean, detail = ''): void => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}${detail ? '  [' + detail.slice(0, 150) + ']' : ''}`); };
async function main(): Promise<void> {
  const url = new URL(process.env.DATABASE_URL ?? '');
  const fp = createHash('sha256').update(url.hostname + '|' + url.pathname.slice(1)).digest('hex').slice(0, 16);
  if (!TARGETS[fp] || process.env.EXAM_BANK_PUBLICATION_FP !== fp) throw new Error(`REFUSING: database ${fp}`);
  const { db } = await import('@/lib/db');
  const { certifyArtefacts } = await import('@/lib/exam-bank/pilot/paa-pilot-publication.service');
  const { PAA_PILOT_CERT_POLICY_V1, PAA_PILOT_DECIDER, PAA_PILOT_POLICY_HASH } = await import('@/lib/exam-bank/pilot/paa-pilot-policy');
  const { contentHash } = await import('@/lib/exam-core/question-bank/bank.service');
  const dir = join(process.cwd(), 'docs/exams/paa-pilot/round-1');
  const art = readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
  const ci = certifyArtefacts(art).flatMap((c) => c.certified).find((x) => x.item.stimulus === null)!;
  const c = await db.connect();
  /** Runs `fn` in a savepoint and returns the database's refusal (or null when it was accepted); always undone. */
  const attempt = async (fn: () => Promise<unknown>): Promise<string | null> => { await c.query('SAVEPOINT a'); try { await fn(); await c.query('ROLLBACK TO SAVEPOINT a'); return null; } catch (e: any) { await c.query('ROLLBACK TO SAVEPOINT a'); return String(e?.message ?? e); } };
  await c.query('BEGIN');
  try {
    const author = (await c.query(`SELECT id FROM users WHERE is_system = true ORDER BY created_at, id LIMIT 1`)).rows[0].id;
    await c.query(`INSERT INTO exam_bank_pilot_environment (scope, database_fingerprint, declared_by, basis) VALUES ('PILOT_PREVIEW', $1, 'proof', 'scope proof, rolled back') ON CONFLICT (singleton) DO NOTHING`, [fp]);
    await c.query(`INSERT INTO assessment_certification_policies (policy_hash, policy_id, version, may_grant_scopes, policy) VALUES ($1, $2, $3, $4::text[], $5::jsonb) ON CONFLICT DO NOTHING`, [PAA_PILOT_POLICY_HASH, PAA_PILOT_CERT_POLICY_V1.policyId, PAA_PILOT_CERT_POLICY_V1.version, ['PILOT_PREVIEW'], JSON.stringify(PAA_PILOT_CERT_POLICY_V1)]);
    const target = async (config: string | null, section: string | null) => (await c.query(`SELECT v.id AS v, comp.id AS comp, lo.id AS lo, d.exam_family FROM exam_definitions d JOIN exam_versions v ON v.exam_definition_id = d.id AND v.status = 'PUBLISHED' JOIN assessment_components comp ON comp.exam_version_id = v.id JOIN blueprint_objective_targets t ON t.assessment_component_id = comp.id JOIN learning_objectives lo ON lo.id = t.learning_objective_id WHERE ($1::text IS NULL AND d.exam_family <> 'PAA' OR d.config_key = $1) AND ($2::text IS NULL OR comp.section_key = $2) LIMIT 1`, [config, section])).rows[0];
    const paa = await target('v2.paa', ci.component);
    const other = await target(null, null);
    const content = { ...ci.content, key: `proof.${ci.item.itemId}` };
    const hash = contentHash(content);
    const make = async (t: any, key: string, lineage: string, provenance: string) => {
      const item = (await c.query(`INSERT INTO question_bank_items (item_key, exam_version_id, assessment_component_id, learning_objective_id, cell_key, provenance, language, lineage_class, generation_metadata) VALUES ($1, $2, $3, $4, 'proof', $5, 'es', $6, $7::jsonb) RETURNING id`, [key, t.v, t.comp, t.lo, provenance, lineage, provenance === 'STUDYUS_GENERATED' ? '{"proof":true}' : null])).rows[0].id;
      const version = (await c.query(`INSERT INTO approved_items (learning_objective_id, question_type, content, created_by, status, content_origin, bank_item_id, version_number, bank_lifecycle_status, content_hash, target_difficulty, calibration_confidence, lifecycle_updated_at, usage_eligibility, exam_alignment) VALUES ($1, 'multiple_choice', $2::jsonb, $3, 'APPROVED', $4, $5, 1, 'VALIDATED', $6, 3, 'INSUFFICIENT_DATA', now(), ARRAY['PRACTICE'], 'MOCK_READY') RETURNING id`, [t.lo, JSON.stringify(content), author, provenance === 'FIXTURE' ? 'FIXTURE' : 'GENERATED', item, hash])).rows[0].id;
      return { item, version };
    };
    const certify = (x: { item: string; version: string }, over: Record<string, unknown> = {}) => {
      const v = { policy: PAA_PILOT_POLICY_HASH, state: 'AUTOMATED_CERTIFIED_PILOT', scopes: ['PILOT_PREVIEW'], rights: 'STUDYUS_ORIGINAL_GENERATED', evidence: ci.evidence, lineage: { ...ci.lineage }, decider: PAA_PILOT_DECIDER, system: 'PAA', hash, ...over } as any;
      return c.query(`INSERT INTO exam_bank_pilot_item_certifications (approved_item_id, bank_item_id, content_hash, item_digest, system_id, component_key, blueprint_bucket, policy_hash, certification_state, eligibility_scopes, rights_category, evidence, lineage, decided_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::text[], $11, $12::jsonb, $13::jsonb, $14)`, [x.version, x.item, v.hash, ci.itemDigest, v.system, ci.component, ci.objectiveCode, v.policy, v.state, v.scopes, v.rights, JSON.stringify(v.evidence), JSON.stringify(v.lineage), v.decider]);
    };
    const activate = (x: { version: string }) => c.query(`UPDATE approved_items SET bank_lifecycle_status = 'ACTIVE', status = 'PUBLISHED', published_at = now() WHERE id = $1`, [x.version]);
    const refused = (r: string | null, code: RegExp) => r !== null && code.test(r);

    const good = await make(paa, 'proof.good', 'PILOT_CERTIFIED', 'STUDYUS_GENERATED');
    check('A1  a generated PAA version with NO certification cannot be activated', refused(await attempt(() => activate(good)), /QUESTION_BANK_(PILOT_REQUIRED|HUMAN_APPROVAL_REQUIRED)/));
    const human50 = (await c.query(`SELECT policy_hash FROM assessment_certification_policies WHERE policy_id <> 'PAA_PILOT_CERT_POLICY' LIMIT 1`)).rows[0]?.policy_hash;
    if (human50) check('A2  another policy (HUMAN50_POLICY_V1), although it grants PILOT_PREVIEW, certifies nothing here', refused(await attempt(() => certify(good, { policy: human50 })), /EXAM_BANK_PILOT_CERTIFICATION_OUT_OF_SCOPE/));
    check('A3  a decider that is not the policy itself is refused', refused(await attempt(() => certify(good, { decider: 'policy:SOMETHING_ELSE' })), /OUT_OF_SCOPE/) && refused(await attempt(() => certify(good, { decider: 'john' })), /check|EXAM_BANK_PILOT_CERTIFICATION_(OUT_OF_)?SCOPE/i));
    check('A4  REVIEW_REQUIRED / REJECTED are not certification states', refused(await attempt(() => certify(good, { state: 'REVIEW_REQUIRED' })), /check|EXAM_BANK_PILOT_CERTIFICATION_(OUT_OF_)?SCOPE/i) && refused(await attempt(() => certify(good, { state: 'REJECTED' })), /check|EXAM_BANK_PILOT_CERTIFICATION_(OUT_OF_)?SCOPE/i));
    check('A5  a failed validator in the evidence is refused', refused(await attempt(() => certify(good, { evidence: ci.evidence.map((g, i) => (i === 0 ? { ...g, passed: false } : g)) })), /OUT_OF_SCOPE/));
    check('A6  a policy rule missing from the evidence is refused', refused(await attempt(() => certify(good, { evidence: ci.evidence.slice(1) })), /OUT_OF_SCOPE/));
    check('A7  incomplete generation lineage is refused', refused(await attempt(() => certify(good, { lineage: { ...ci.lineage, executionId: '' } })), /OUT_OF_SCOPE/) && refused(await attempt(() => certify(good, { lineage: { ...ci.lineage, model: undefined } })), /OUT_OF_SCOPE/));
    check('A8  unknown or other rights are refused', refused(await attempt(() => certify(good, { rights: 'UNKNOWN' })), /check|EXAM_BANK_PILOT_CERTIFICATION_(OUT_OF_)?SCOPE/i) && refused(await attempt(() => certify(good, { rights: 'STUDYUS_ORIGINAL_DETERMINISTIC' })), /check|EXAM_BANK_PILOT_CERTIFICATION_(OUT_OF_)?SCOPE/i));
    check('A9  PRODUCTION is not a scope this certification can grant', refused(await attempt(() => certify(good, { scopes: ['PRODUCTION'] })), /check|EXAM_BANK_PILOT_CERTIFICATION_(OUT_OF_)?SCOPE/i) && refused(await attempt(() => certify(good, { scopes: ['PILOT_PREVIEW', 'PRODUCTION'] })), /check|EXAM_BANK_PILOT_CERTIFICATION_(OUT_OF_)?SCOPE/i));
    check('A10 another assessment system is refused', refused(await attempt(() => certify(good, { system: 'IB' })), /check|EXAM_BANK_PILOT_CERTIFICATION_(OUT_OF_)?SCOPE/i));
    check('A11 a certification of other content than the version holds is refused', refused(await attempt(() => certify(good, { hash: 'f'.repeat(64) })), /IS_NOT_OF_THIS_CONTENT/));
    if (other) { const foreign = await attempt(async () => { const x = await make(other, 'proof.other-system', 'PILOT_CERTIFIED', 'STUDYUS_GENERATED'); await certify(x); }); check(`A12 a generated item of another exam family (${other.exam_family}) cannot be certified, whatever the row says`, refused(foreign, /EXAM_BANK_PILOT_CERTIFICATION_SCOPE/), foreign ?? 'accepted'); }
    const legacy = await attempt(async () => { const x = await make(paa, 'proof.legacy', 'LEGACY', 'STUDYUS_GENERATED'); await certify(x); });
    check('A13 arbitrary generated content (not PILOT_CERTIFIED lineage) cannot be certified', refused(legacy, /EXAM_BANK_PILOT_CERTIFICATION_SCOPE/));
    const fixture = await attempt(async () => { const x = await make(paa, 'proof.fixture', 'PILOT_CERTIFIED', 'FIXTURE'); await certify(x); });
    check('A14 a fixture cannot be certified', refused(fixture, /EXAM_BANK_PILOT_CERTIFICATION_SCOPE/));
    const undeclared = await attempt(async () => { await c.query(`DELETE FROM exam_bank_pilot_environment`); await certify(good); });
    check('A15 in a database that has not declared itself a pilot environment, nothing is certified', refused(undeclared, /EXAM_BANK_PILOT_ENVIRONMENT_NOT_DECLARED/));
    // ---- the one accepted path
    const accepted = await attempt(async () => { await certify(good); await activate(good); const n = (await c.query(`SELECT count(*)::int AS n FROM exam_bank_pilot_deliverable_versions WHERE approved_item_id = $1`, [good.version])).rows[0].n; await c.query(`UPDATE question_bank_items SET current_version_id = $2 WHERE id = $1`, [good.item, good.version]); const m = (await c.query(`SELECT count(*)::int AS n FROM exam_bank_pilot_deliverable_versions WHERE approved_item_id = $1`, [good.version])).rows[0].n; if (n !== 0 || m !== 1) throw new Error(`VIEW ${n}/${m}`); });
    check('B1  the governed path is accepted: PAA policy + every rule passed + complete lineage -> ACTIVE, deliverable once it is the current version', accepted === null, accepted ?? '');
    const afterRevoke = await attempt(async () => { await certify(good); await activate(good); await c.query(`UPDATE question_bank_items SET current_version_id = $2 WHERE id = $1`, [good.item, good.version]); await c.query(`UPDATE exam_bank_pilot_item_certifications SET revoked_at = now(), revoke_reason = 'proof' WHERE approved_item_id = $1`, [good.version]); const n = (await c.query(`SELECT count(*)::int AS n FROM exam_bank_pilot_deliverable_versions WHERE approved_item_id = $1`, [good.version])).rows[0].n; if (n !== 0) throw new Error(`STILL DELIVERABLE ${n}`); });
    check('B2  a revoked certification delivers nothing', afterRevoke === null, afterRevoke ?? '');
    const withoutEnv = await attempt(async () => { await certify(good); await activate(good); await c.query(`UPDATE question_bank_items SET current_version_id = $2 WHERE id = $1`, [good.item, good.version]); await c.query(`DELETE FROM exam_bank_pilot_environment`); const n = (await c.query(`SELECT count(*)::int AS n FROM exam_bank_pilot_deliverable_versions`)).rows[0].n; if (n !== 0) throw new Error(`STILL DELIVERABLE ${n}`); });
    check('B3  without the pilot-environment declaration the delivery view is empty for everything', withoutEnv === null, withoutEnv ?? '');
    check('B4  no human review row was written by any of this', Number((await c.query(`SELECT count(*)::int AS n FROM question_bank_reviews r JOIN approved_items ai ON ai.id = r.approved_item_id JOIN question_bank_items qi ON qi.id = ai.bank_item_id WHERE qi.lineage_class = 'PILOT_CERTIFIED'`)).rows[0].n) === 0);
  } finally { await c.query('ROLLBACK'); c.release(); await db.end(); }
  console.log(`RESULT ${results.filter(Boolean).length}/${results.length} (everything rolled back)`);
  process.exit(results.every(Boolean) ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
