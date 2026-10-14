/**
 * TRACK B -- publish the PAA pilot certified supply (generated Reading / Writing / English) into a database.
 * See src/lib/exam-bank/pilot/paa-pilot-publication.service.ts. It calls no provider.
 *
 *   EXAM_BANK_PUBLICATION_FP=<fp> npx tsx --env-file=<env> scripts/operations/exam-bank/publish-paa-pilot-supply.ts [--apply]
 *
 * DRY RUN by default. Authorised targets: DEV (dry run only -- an older DEV deployment does not know the pilot lineage)
 * and the Track B Preview candidate's own database. Never the shared Preview database, Stage or Production.
 */
import { createHash } from 'crypto';
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const TARGETS: Readonly<Record<string, { name: string; mayApply: boolean }>> = { '2a29b99ee14a22b4': { name: 'DEV', mayApply: false }, '4c249c68e0627b9f': { name: 'PREVIEW_TRACK_B', mayApply: true } };
async function main(): Promise<number> {
  const apply = process.argv.includes('--apply');
  const url = new URL(process.env.DATABASE_URL ?? '');
  const fp = createHash('sha256').update(url.hostname + '|' + url.pathname.slice(1)).digest('hex').slice(0, 16);
  const target = TARGETS[fp];
  if (!target || process.env.EXAM_BANK_PUBLICATION_FP !== fp || (apply && !target.mayApply)) { console.error(`REFUSING: database ${fp} is not an authorised target${apply ? ' for --apply' : ''}, or EXAM_BANK_PUBLICATION_FP does not name it.`); return 2; }
  const dir = join(process.cwd(), 'docs/exams/paa-pilot');
  const files = readdirSync(dir).filter((d) => /^round-\d+$/.test(d)).sort().flatMap((d) => readdirSync(join(dir, d)).filter((f) => f.endsWith('.json')).sort().map((f) => join(dir, d, f)));
  const artefacts = files.map((f) => JSON.parse(readFileSync(f, 'utf8'))).filter((a) => a.generated && a.provenance && Array.isArray(a.runs));
  const { runPilotPublication } = await import('@/lib/exam-bank/pilot/paa-pilot-publication.service');
  const { db } = await import('@/lib/db');
  const client = await db.connect();
  try {
    const report = await runPilotPublication(client, artefacts, { apply });
    console.log(`paa pilot publication -- target ${target.name} db ${fp} -- ${report.mode} ${report.committed ? 'COMMITTED' : 'ROLLED BACK (nothing kept)'}`);
    console.log(`units ${report.units}; candidates ${report.candidates}; certified ${report.certified}; review required ${report.reviewRequired}`);
    console.log(`stimuli +${report.stimuliInserted} (=${report.stimuliSkipped}); items +${report.itemsInserted} (=${report.itemsSkipped}); by objective ${JSON.stringify(report.byObjective)}`);
    console.log('BLOCKED', JSON.stringify(report.blocked));
    console.log('VERIFICATION', JSON.stringify(report.verification));
    const out = process.argv.indexOf('--out'); if (out > 0) writeFileSync(process.argv[out + 1], `${JSON.stringify({ target: target.name, fingerprint: fp, ...report }, null, 2)}\n`);
    if (report.committed) {
      // readiness is a stored bank-health snapshot: refreshed here, in the scope this database is published for
      process.env.EXAM_BANK_DELIVERY_SCOPE = 'PILOT_PREVIEW';
      const { refreshVersionHealth } = await import('@/lib/exam-core/question-bank/health.service');
      const versions = (await db.query(`SELECT DISTINCT exam_version_id FROM question_bank_items WHERE lineage_class = 'PILOT_CERTIFIED' AND exam_version_id IS NOT NULL`)).rows.map((r: { exam_version_id: string }) => r.exam_version_id);
      for (const v of versions) { const h = await refreshVersionHealth(v); console.log(`BANK HEALTH ${v}: ${(h?.health.components ?? []).map((x) => `${x.sectionKey} practice=${x.practice} reduced=${x.reducedAssembles}`).join('; ')}`); }
    }
    return 0;
  } catch (e) { console.error(`FAILED (nothing written): ${e instanceof Error ? e.message : String(e)}`); return 1; } finally { client.release(); await db.end(); }
}
main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(1); });
