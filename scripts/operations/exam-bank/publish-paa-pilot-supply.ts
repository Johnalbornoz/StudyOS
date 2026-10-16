/**
 * TRACK B -- publish the PAA pilot certified supply (generated Reading / Writing / English) into a database.
 * See src/lib/exam-bank/pilot/paa-pilot-publication.service.ts. It calls no provider.
 *
 *   EXAM_BANK_PUBLICATION_FP=<fp> npx tsx --env-file=<env> scripts/operations/exam-bank/publish-paa-pilot-supply.ts [--apply]
 *
 * DRY RUN by default. Authorised targets: DEV and the frozen Preview database (dry run only) and the pilot candidate's
 * own database (4baac799, apply). Never the shared Preview database, Stage or Production.
 */
import { createHash } from 'crypto';
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

// 2026-10-15: the frozen Preview database (4c249c68, PAA baseline 610d3c6) is never written again; the converged pilot
// candidate's OWN database (Neon branch pilot-candidate-20261015) is the one apply target.
const TARGETS: Readonly<Record<string, { name: string; mayApply: boolean }>> = { '2a29b99ee14a22b4': { name: 'DEV', mayApply: false }, '4c249c68e0627b9f': { name: 'PREVIEW_TRACK_B_FROZEN', mayApply: false }, '4baac799b9bd2a6a': { name: 'PILOT_CANDIDATE_20261015', mayApply: true } };
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
    console.log(`stimuli +${report.stimuliInserted} (=${report.stimuliSkipped}); items +${report.itemsInserted} (=${report.itemsSkipped}); usage authorised ${report.usageAuthorized ?? 0}; by objective ${JSON.stringify(report.byObjective)}`);
    console.log('BLOCKED', JSON.stringify(report.blocked));
    console.log('VERIFICATION', JSON.stringify(report.verification));
    const out = process.argv.indexOf('--out'); if (out > 0) writeFileSync(process.argv[out + 1], `${JSON.stringify({ target: target.name, fingerprint: fp, ...report }, null, 2)}\n`);
    if (report.committed) {
      // readiness is a stored bank-health snapshot: refreshed here, in the scope this database is published for
      process.env.EXAM_BANK_DELIVERY_SCOPE = 'PILOT_PREVIEW';
      const { refreshVersionHealth } = await import('@/lib/exam-core/question-bank/health.service');
      // every PAA version the certified supply serves by objective (the reduced v2.paa and the full-length v2.paa-full-length)
      const versions = (await db.query(`SELECT DISTINCT v.id AS exam_version_id FROM exam_versions v JOIN exam_definitions d ON d.id = v.exam_definition_id WHERE d.exam_family = 'PAA' AND v.status = 'PUBLISHED'`)).rows.map((r: { exam_version_id: string }) => r.exam_version_id);
      for (const v of versions) { const h = await refreshVersionHealth(v); console.log(`BANK HEALTH ${v}: ${(h?.health.components ?? []).map((x) => `${x.sectionKey} practice=${x.practice} reduced=${x.reducedAssembles}`).join('; ')}`); }
    }
    return 0;
  } catch (e) { console.error(`FAILED (nothing written): ${e instanceof Error ? e.message : String(e)}`); return 1; } finally { client.release(); await db.end(); }
}
main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(1); });
