/**
 * QB-R2C -- prints the PAA generation plan: the 865 planned items grouped into generation units.
 *   npx tsx scripts/operations/qb-paa-generation-plan.ts            summary; reads nothing but the repository
 *   npx tsx scripts/operations/qb-paa-generation-plan.ts --units    every unit (JSON)
 *   npx tsx scripts/operations/qb-paa-generation-plan.ts --write    writes the planning artifact
 *       docs/exams/question-bank/audits/q1-paa/QB_R2C_paa_generation_plan.json
 * The artifact is UNBOUND: codes and stable ids only, no row id of any environment. This script opens no
 * database and no network connection; it writes that one file and nothing else.
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import { buildPaaGenerationPlan, summarizePaaGenerationPlan } from '@/lib/exam-core/question-bank/production/paa-generation-plan';

export const GENERATION_PLAN_ARTIFACT = 'docs/exams/question-bank/audits/q1-paa/QB_R2C_paa_generation_plan.json';

function main() {
  const plan = buildPaaGenerationPlan();
  const summary = summarizePaaGenerationPlan(plan);
  if (process.argv.includes('--write')) writeFileSync(join(process.cwd(), GENERATION_PLAN_ARTIFACT), `${JSON.stringify({ summary, plan }, null, 1)}\n`);
  console.log(JSON.stringify(process.argv.includes('--units') ? { summary, plan } : summary, null, 2));
  if (summary.violations.length) process.exit(2);
}

main();
