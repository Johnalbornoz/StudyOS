/**
 * TRACK B -- governed, audited lifecycle actions on published Exam Bank versions (never content, never a delete):
 *
 *   AICE_P5_SUPERSEDED_IDENTITY  the AICE P5 versions published under the two SUPERSEDED identities
 *                                (AICE-9709-IDENTITY-COLLISION-2026-10-16) -> SUPERSEDED / RETIRED; the item rows, their
 *                                certified instances and history stay. Their replacement is batch AICE-9709-P5-CANON-A2.
 *   PAA_DUPLICATE_TEMPLATE       the PAA language version whose generic wording duplicates a template the objective
 *                                already holds (no depth for the full-length form) -> SUSPENDED. Its usage is already
 *                                FULL_MOCK only and a usage cannot be empty, so the audited lifecycle is the mechanism.
 *
 *   EXAM_BANK_PUBLICATION_FP=<fp> npx tsx --env-file=<env> scripts/operations/exam-bank/bank-lifecycle-governance.ts [--apply]
 *
 * DRY RUN by default. Authorised targets: DEV and the pilot candidate's own database.
 */
import { createHash } from 'crypto';

const TARGETS: Readonly<Record<string, string>> = { '2a29b99ee14a22b4': 'DEV', '4baac799b9bd2a6a': 'PILOT_CANDIDATE_20261015' };
const SUPERSEDED_IDS = ['math.prob.permutations-combinations', 'math.prob.probability-events'];
const PAA_DUPLICATE_ITEM_KEYS = ['paa.pilot.lect-explicitas.1c5e758435c1'];

async function main(): Promise<number> {
  const apply = process.argv.includes('--apply');
  const u = new URL(process.env.DATABASE_URL ?? '');
  const fp = createHash('sha256').update(`${u.hostname}|${u.pathname.slice(1)}`).digest('hex').slice(0, 16);
  if (!TARGETS[fp] || process.env.EXAM_BANK_PUBLICATION_FP !== fp) { console.error(`REFUSING: database ${fp} is not an authorised target`); return 2; }
  const { db } = await import('@/lib/db');
  const c = await (db as any).connect();
  try {
    await c.query('BEGIN');
    const event = (itemId: string, versionId: string, to: string, reason: string, detail: unknown) => c.query(`INSERT INTO question_bank_lifecycle_events (bank_item_id, approved_item_id, from_status, to_status, reason, actor_kind, actor_user_id, run_id, detail) VALUES ($1, $2, 'ACTIVE', $3, $4, 'SYSTEM', NULL, NULL, $5::jsonb)`, [itemId, versionId, to, reason, JSON.stringify(detail)]);
    // ---- AICE P5 under the superseded identities
    const aice = (await c.query(`
      SELECT qi.id AS item_id, ai.id AS version_id, lo.code, i.primary_concept_stable_id AS concept
        FROM question_bank_items qi JOIN approved_items ai ON ai.id = qi.current_version_id JOIN learning_objectives lo ON lo.id = qi.learning_objective_id
        JOIN assessment_item_instances i ON i.id = qi.item_instance_id
       WHERE qi.lineage_class = 'CORE_DERIVED' AND ai.bank_lifecycle_status = 'ACTIVE' AND i.primary_concept_stable_id = ANY($1::text[]) AND lo.code LIKE 'aice.9709.p5.%'`, [SUPERSEDED_IDS])).rows;
    for (const r of aice) {
      await c.query(`UPDATE approved_items SET bank_lifecycle_status = 'SUPERSEDED', status = 'RETIRED' WHERE id = $1`, [r.version_id]);
      await c.query(`UPDATE question_bank_items SET retired_at = now(), retire_reason = 'SUPERSEDED_BY_CANONICAL_IDENTITY: AICE-9709-IDENTITY-COLLISION-2026-10-16', updated_at = now() WHERE id = $1`, [r.item_id]);
      await event(r.item_id, r.version_id, 'SUPERSEDED', 'SUPERSEDED_BY_CANONICAL_IDENTITY', { decision: 'AICE-9709-IDENTITY-COLLISION-2026-10-16', supersededIdentity: r.concept, replacementBatch: 'AICE-9709-P5-CANON-A2' });
    }
    // ---- PAA duplicate-template language version
    const dup = (await c.query(`
      SELECT qi.id AS item_id, ai.id AS version_id, lo.code, ai.template_fingerprint AS t, ai.usage_eligibility AS usage,
             (SELECT count(*)::int FROM approved_items o JOIN question_bank_items oq ON oq.id = o.bank_item_id AND oq.current_version_id = o.id
               WHERE o.learning_objective_id = ai.learning_objective_id AND o.id <> ai.id AND o.template_fingerprint = ai.template_fingerprint AND o.bank_lifecycle_status = 'ACTIVE') AS others
        FROM question_bank_items qi JOIN approved_items ai ON ai.id = qi.current_version_id JOIN learning_objectives lo ON lo.id = qi.learning_objective_id
       WHERE qi.item_key = ANY($1::text[]) AND ai.bank_lifecycle_status = 'ACTIVE'`, [PAA_DUPLICATE_ITEM_KEYS])).rows;
    const dupOk = dup.filter((r: any) => r.others > 0);
    for (const r of dupOk) {
      await c.query(`UPDATE approved_items SET bank_lifecycle_status = 'SUSPENDED', status = 'IN_REVIEW' WHERE id = $1`, [r.version_id]);
      await event(r.item_id, r.version_id, 'SUSPENDED', 'DUPLICATE_TEMPLATE_NON_DIVERSITY', { objective: r.code, usage: r.usage, sameTemplateActiveVersions: r.others, note: 'certified; its wording duplicates a template the objective already holds, so it adds no position to a form; certification and history preserved' });
    }
    console.log(JSON.stringify({ target: TARGETS[fp], mode: apply ? 'APPLY' : 'DRY_RUN', aiceSuperseded: aice.length, aiceByObjective: aice.reduce((m: Record<string, number>, r: any) => ({ ...m, [r.code]: (m[r.code] ?? 0) + 1 }), {}), paaDuplicateFound: dup.length, paaDuplicateSuspended: dupOk.length, paaDuplicate: dup.map((r: any) => ({ objective: r.code, usage: r.usage, sameTemplateActiveVersions: r.others })) }));
    await c.query(apply ? 'COMMIT' : 'ROLLBACK');
    return 0;
  } catch (e) { await c.query('ROLLBACK').catch(() => undefined); console.error(e instanceof Error ? e.message : String(e)); return 1; }
  finally { c.release(); await (db as any).end?.(); }
}
main().then((code) => process.exit(code));
