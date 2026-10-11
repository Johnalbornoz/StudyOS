/**
 * EA-1 -- prints the mathematics adaptation matrix and the PAA evidence-demand estimate.
 *   npx tsx scripts/operations/ea1-adaptation-matrix.ts            summary of the matrix and of the demand estimate
 *   npx tsx scripts/operations/ea1-adaptation-matrix.ts --matrix   the whole matrix (JSON)
 *   npx tsx scripts/operations/ea1-adaptation-matrix.ts --demand   the demand estimate under every scenario (JSON)
 *   npx tsx scripts/operations/ea1-adaptation-matrix.ts --approach-poc   EA-1A: the Mexico and Colombia learning-approach proofs of concept
 *   npx tsx scripts/operations/ea1-adaptation-matrix.ts --write    writes the three artifacts
 *       docs/exams/assessment-adaptation/EA1_math_adaptation_matrix.json
 *       docs/exams/assessment-adaptation/EA1_paa_evidence_demand.json
 *       docs/exams/assessment-adaptation/EA1A_learning_approach_poc.json
 * Pure functions and file IO only: this script opens no database and no network connection, calls no model and
 * generates no question. The artifacts hold specifications' identities and counts; codes and stable ids only.
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import { buildMathAdaptationMatrix, MATH_POC_MATRIX_ARTIFACT, serializeMathAdaptationMatrix } from '@/lib/assessment-adaptation/math-poc-matrix';
import { buildLearningApproachPoc, LEARNING_APPROACH_POC_ARTIFACT, serializeLearningApproachPoc } from '@/lib/assessment-adaptation/learning-approach-poc';
import { buildPaaEvidenceDemand, PAA_EVIDENCE_DEMAND_ARTIFACT, serializePaaEvidenceDemand } from './ea1-paa-evidence-demand';

function main() {
  const matrix = buildMathAdaptationMatrix();
  const demand = buildPaaEvidenceDemand();
  const approachPoc = buildLearningApproachPoc();
  if (process.argv.includes('--write')) {
    writeFileSync(join(process.cwd(), MATH_POC_MATRIX_ARTIFACT), serializeMathAdaptationMatrix(matrix));
    writeFileSync(join(process.cwd(), PAA_EVIDENCE_DEMAND_ARTIFACT), serializePaaEvidenceDemand(demand));
    writeFileSync(join(process.cwd(), LEARNING_APPROACH_POC_ARTIFACT), serializeLearningApproachPoc(approachPoc));
  }
  if (process.argv.includes('--approach-poc')) console.log(JSON.stringify({ summary: approachPoc.summary, comparisons: approachPoc.comparisons, specialCases: approachPoc.specialCases }, null, 2));
  else if (process.argv.includes('--matrix')) console.log(JSON.stringify(matrix, null, 2));
  else if (process.argv.includes('--demand')) console.log(JSON.stringify(demand, null, 2));
  else {
    const mark = (c: (typeof matrix.cells)[number]) => (c.outcome === 'SPECIFICATION' ? `${c.declaredSupport === 'SUPPORTED_WITH_CONSTRAINTS' ? 'C' : 'S'} ${c.specificationId!.slice(0, 8)} [${c.applicability.basis}]` : `REFUSED ${c.refusal!.code}`);
    const grid = Object.fromEntries(matrix.families.map((f) => [f.familyId, Object.fromEntries(matrix.cells.filter((c) => c.familyId === f.familyId).map((c) => [`${c.level === 'SYSTEM' ? 'system:' : ''}${c.targetId}`, mark(c)]))]));
    console.log(JSON.stringify({ matrix: { summary: matrix.summary, grid }, demand: { kind: demand.kind, note: demand.note, scenarios: demand.scenarios.map((s) => ({ assumption: s.assumption, totals: s.totals, bySection: s.bySection })) } }, null, 2));
  }
}

main();
