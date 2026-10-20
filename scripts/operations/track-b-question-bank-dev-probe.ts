/**
 * Question Bank Factory -- read-only DEV state probe (before / after the migration).
 * Refuses unless the DB fingerprint is the official DEV one.
 *   npx tsx --env-file=.env.local scripts/operations/track-b-question-bank-dev-probe.ts
 */
import { createHash } from 'crypto';
import { db } from '@/lib/db';

async function main() {
  const u = new URL(process.env.DATABASE_URL ?? '');
  const fp = createHash('sha256').update(u.hostname + '|' + u.pathname.slice(1)).digest('hex').slice(0, 16);
  if (fp !== '2a29b99ee14a22b4') throw new Error(`REFUSING: not the DEV database (${fp})`);
  const q = async (sql: string) => (await db.query(sql)).rows;
  const hasBank = (await q(`SELECT to_regclass('public.question_bank_items') IS NOT NULL AS ok`))[0].ok;
  const out: Record<string, unknown> = {
    fingerprint: fp,
    ledger: (await q(`SELECT count(*)::int n, max(version) last FROM schema_migrations`))[0],
    ledgerTail: (await q(`SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 4`)).map((r: any) => r.version),
    approvedItems: await q(`SELECT status, count(*)::int n FROM approved_items GROUP BY 1 ORDER BY 1`),
    contentHash: (await q(`SELECT md5(string_agg(id::text || content::text || status, '|' ORDER BY id)) h, count(*)::int n FROM approved_items`))[0],
    responsesWithItem: (await q(`SELECT count(*)::int n, count(DISTINCT approved_item_id)::int items FROM exam_attempt_item_responses WHERE approved_item_id IS NOT NULL`))[0],
    responseSnapshotHash: (await q(`SELECT md5(string_agg(id::text || approved_item_id::text || item_snapshot::text, '|' ORDER BY id)) h FROM exam_attempt_item_responses WHERE approved_item_id IS NOT NULL`))[0].h,
    aiLimits: (await q(`SELECT day_calls, day_start, (day_start = date_trunc('day', statement_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS today FROM ai_global_limits`))[0],
  };
  if (hasBank) {
    out.bank = {
      items: (await q(`SELECT provenance, count(*)::int n FROM question_bank_items GROUP BY 1`)),
      lifecycle: await q(`SELECT coalesce(bank_lifecycle_status,'NULL') s, count(*)::int n FROM approved_items GROUP BY 1 ORDER BY 1`),
      unregistered: (await q(`SELECT count(*)::int n FROM approved_items WHERE bank_item_id IS NULL`))[0].n,
      requests: await q(`SELECT status, count(*)::int n FROM question_bank_generation_requests GROUP BY 1`),
      runs: await q(`SELECT trigger, status, ai_calls, candidates_generated, accepted, rejected, repaired, review_required, started_at FROM question_bank_factory_runs ORDER BY started_at`),
      snapshots: (await q(`SELECT count(*)::int n, count(DISTINCT exam_version_id)::int versions FROM question_bank_health_snapshots`))[0],
    };
  }
  console.log(JSON.stringify(out, null, 1));
  await db.end();
}
main().catch(async (e) => { console.error(e instanceof Error ? e.message : e); await db.end().catch(() => undefined); process.exit(1); });
