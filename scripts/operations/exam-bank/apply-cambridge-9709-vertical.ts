/**
 * Applies ONE configuration -- the Cambridge 9709 Paper 1 vertical (v2.cambridge.9709-as) -- and then the assessment
 * structure catalogue (its cie.asal nodes bind to it). DEV ONLY (fingerprint-gated). Dry run by default; --write
 * commits. Idempotent. No other configuration is applied.
 *
 *   npx tsx --env-file=<dev env> scripts/operations/exam-bank/apply-cambridge-9709-vertical.ts [--write]
 */
import { createHash } from 'crypto';

const TARGETS: Readonly<Record<string, string>> = { '2a29b99ee14a22b4': 'DEV', '4baac799b9bd2a6a': 'PILOT_CANDIDATE_20261015' };
const WRITE = process.argv.includes('--write');
async function main(): Promise<void> {
  const u = new URL(process.env.DATABASE_URL ?? '');
  const fp = createHash('sha256').update(`${u.hostname}|${u.pathname.slice(1)}`).digest('hex').slice(0, 16);
  if (!TARGETS[fp]) throw new Error(`REFUSING: not an authorised database (${fp})`);
  const { db } = await import('@/lib/db');
  const { applyExamVerticalConfig } = await import('@/lib/exam-core/apply-vertical-config.service');
  const { applyAssessmentStructure } = await import('@/lib/exam-core/catalog/structure.service');
  const { CAMBRIDGE_9709_AS_V2 } = await import('@/lib/exam-core/verticals/v2/cambridge-9709');
  console.log(`cambridge 9709 vertical apply -- db ${fp} (${TARGETS[fp]}) -- ${WRITE ? 'WRITE' : 'DRY RUN'}`);
  const r = await applyExamVerticalConfig(CAMBRIDGE_9709_AS_V2, { write: WRITE });
  console.log(JSON.stringify({ key: r.key, family: r.family, noop: r.noop, write: r.write, versionId: r.versionId, sections: Object.keys(r.componentIdsBySection), objectives: Object.keys(r.objectiveIdsByCode) }));
  const s = await applyAssessmentStructure({ write: WRITE });
  console.log(JSON.stringify({ structure: s }));
  await db.end();
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
