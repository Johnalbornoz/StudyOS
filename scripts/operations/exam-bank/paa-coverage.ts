/**
 * TRACK B -- exact blueprint coverage of an exam version from its Certified Exam Bank. READ ONLY.
 *
 * Computes the bank health from the database as it is (no snapshot is written, nothing is refreshed) in the delivery
 * scope named by EXAM_BANK_DELIVERY_SCOPE, and prints, per component and per blueprint cell: positions, the supply a
 * Student could be delivered in practice, and the repeatability depth (reduced forms that share no item).
 *
 *   EXAM_BANK_DELIVERY_SCOPE=PILOT_PREVIEW npx tsx --env-file=<env> scripts/operations/exam-bank/paa-coverage.ts [--family PAA] [--out <file>]
 */
import { writeFileSync } from 'fs';

async function main(): Promise<number> {
  const arg = (name: string): string | null => { const at = process.argv.indexOf(name); return at > 0 ? process.argv[at + 1] ?? null : null; };
  const family = arg('--family') ?? 'PAA';
  const { db } = await import('@/lib/db');
  const { listBankVersions, loadVersionHealthInputs, healthFromInputs } = await import('@/lib/exam-core/question-bank/health.service');
  const { examBankDeliveryScope } = await import('@/lib/exam-bank/delivery-scope');
  try {
    const versions = (await listBankVersions()).filter((v) => v.family === family);
    const report: unknown[] = [];
    for (const v of versions) {
      const inputs = await loadVersionHealthInputs(v.examVersionId);
      if (!inputs) continue;
      const h = healthFromInputs(inputs);
      const components = h.components.map((c) => {
        const cells = h.cells.filter((x) => x.sectionKey === c.sectionKey);
        const covered = cells.filter((x) => x.reducedPositions > 0 && x.counts.practiceEligible >= x.reducedPositions);
        return {
          sectionKey: c.sectionKey, officialItemCount: c.officialItemCount, reducedPositions: c.reducedPositions,
          positionsCovered: covered.reduce((n, x) => n + x.reducedPositions, 0), cells: cells.length, cellsCovered: covered.length,
          eligibleItems: cells.reduce((n, x) => n + x.counts.practiceEligible, 0), practice: c.practice, reducedAssembles: c.reducedAssembles, fullAssembles: c.fullAssembles, formCapacityProbed: c.reducedFormCapacity,
          // forms that share NO item: the scarcest cell decides
          disjointForms: cells.length === 0 ? 0 : Math.min(...cells.map((x) => (x.reducedPositions > 0 ? Math.floor(x.counts.practiceEligible / x.reducedPositions) : Infinity))),
          missing: cells.filter((x) => !covered.includes(x)).map((x) => ({ objective: x.objectiveCode, positions: x.reducedPositions, eligible: x.counts.practiceEligible })),
        };
      });
      const positions = components.reduce((n, c) => n + c.reducedPositions, 0); const covered = components.reduce((n, c) => n + c.positionsCovered, 0);
      console.log(`${v.examVersionId} scope=${examBankDeliveryScope()} coverage ${covered}/${positions} positions (${positions ? Math.round((100 * covered) / positions) : 0}%)`);
      for (const c of components) console.log(`  ${c.sectionKey.padEnd(12)} ${c.positionsCovered}/${c.reducedPositions} positions  cells ${c.cellsCovered}/${c.cells}  eligible ${c.eligibleItems}  practice=${c.practice} reduced=${c.reducedAssembles} full=${c.fullAssembles}  disjointForms=${c.disjointForms}${c.missing.length ? `  missing: ${c.missing.map((m) => `${m.objective}(${m.eligible}/${m.positions})`).join(', ')}` : ''}`);
      report.push({ examVersionId: v.examVersionId, scope: examBankDeliveryScope(), positions, covered, readiness: h.readiness, components });
    }
    const out = arg('--out');
    if (out) writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
    return versions.length > 0 ? 0 : 1;
  } finally { await db.end(); }
}
main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(1); });
