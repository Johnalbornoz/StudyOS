/**
 * Emits src/lib/assessment-instance/library/cf-ib-aahl-01.package-seeds.ts from the PINNED CF-IB-AAHL-01 package: per
 * core and planning band, `<batch>/<candidateId>@rk=<recognitionKey>` of every candidate. Pure; refuses an unpinned package.
 *
 *   npx tsx scripts/operations/exam-bank/emit-cf-seeds.ts
 */
import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const PACKAGE = 'docs/exams/content-factory/CF-IB-AAHL-01/CF-IB-AAHL-01_CANDIDATE_PACKAGE.json';
const OUT = 'src/lib/assessment-instance/library/cf-ib-aahl-01.package-seeds.ts';
const PINNED = '678741c9d6423e6e328847979bf8ca60358bcc944a2d42258f099604c6e659a8';
const bytes = readFileSync(join(process.cwd(), PACKAGE));
if (createHash('sha256').update(bytes).digest('hex') !== PINNED) { console.error('PACKAGE_NOT_PINNED'); process.exit(1); }
const pkg = JSON.parse(bytes.toString()) as { batchId: string; candidates: { candidateId: string; recognitionId: string; planningBand: string; lineage: { coreId: string } }[] };
const by: Record<string, Record<string, string[]>> = {};
for (const c of pkg.candidates) {
  const rk = c.recognitionId.slice(c.lineage.coreId.length + 1);
  ((by[c.lineage.coreId] ??= {})[c.planningBand] ??= []).push(`${pkg.batchId}/${c.candidateId}@rk=${rk}`);
}
const body = Object.entries(by).map(([core, bands]) => `  '${core}': {\n${Object.entries(bands).map(([b, s]) => `    ${b}: [\n${s.map((x) => `      '${x}',`).join('\n')}\n    ],`).join('\n')}\n  },`).join('\n');
writeFileSync(join(process.cwd(), OUT), `/**
 * GENERATED from ${PACKAGE} (sha256 ${PINNED.slice(0, 8)}...).
 * Every candidate of the package, by core and planning band: \`<batch>/<candidateId>@rk=<recognitionKey>\`.
 * Regenerate with scripts/operations/exam-bank/emit-cf-seeds.ts; never by hand.
 */
import type { PlanningBand } from './parametric';

export const CF_IB_AAHL_01_PACKAGE_SEEDS: Readonly<Record<string, Readonly<Partial<Record<PlanningBand, readonly string[]>>>>> = {
${body}
};
`);
console.log(`${pkg.candidates.length} seeds, ${Object.keys(by).length} cores -> ${OUT}`);
