/**
 * EA-1 -- the 865 planned PAA items read as REQUIRED EVIDENCE INSTANCES (pure: no file, no database, no network).
 *
 * It joins the two things that must not import each other inside `src`: the resolved PAA requirement cells (the
 * Production OS) and the family-demand analysis (task families). The cells are read and never changed.
 *
 * The result is a PLANNING ESTIMATE under stated, provisional StudyUs assumptions. Four scenarios are printed so
 * that no single number is mistaken for a commitment; the first is the one the EA-1 report quotes.
 */
import { resolvePaaRequirementCells } from '@/lib/exam-core/question-bank/production/paa-cells';
import { EA1_DEFAULT_FAMILY_ASSUMPTION, evidenceDemandByConcept, type EvidenceDemandReport, type FamilyIndependenceAssumption } from '@/lib/exam-core/question-bank/task-families/family-demand';

export const PAA_EVIDENCE_DEMAND_ARTIFACT = 'docs/exams/assessment-adaptation/EA1_paa_evidence_demand.json' as const;
export const PAA_DEMAND_SCENARIOS: readonly FamilyIndependenceAssumption[] = [
  EA1_DEFAULT_FAMILY_ASSUMPTION,
  { maxInstancesPerFamilyPerPool: 1, familyMayServeSeveralPools: true },
  { maxInstancesPerFamilyPerPool: 2, familyMayServeSeveralPools: false },
  { maxInstancesPerFamilyPerPool: 1, familyMayServeSeveralPools: false },
];

export interface PaaEvidenceDemand { kind: 'EA1_PAA_EVIDENCE_DEMAND'; note: string; cells: number; scenarios: EvidenceDemandReport[] }

export function buildPaaEvidenceDemand(): PaaEvidenceDemand {
  const cells = resolvePaaRequirementCells();
  return {
    kind: 'EA1_PAA_EVIDENCE_DEMAND',
    note: 'PLANNING ESTIMATE. The 865 planned PAA items as required evidence instances per PRIMARY concept, and the fewest task families that could supply them under each stated assumption. The assumptions are provisional StudyUs policy: no independence rule exists yet. The demand and the cells are unchanged.',
    cells: cells.length,
    scenarios: PAA_DEMAND_SCENARIOS.map((a) => evidenceDemandByConcept(cells, a)),
  };
}
export const serializePaaEvidenceDemand = (d: PaaEvidenceDemand): string => `${JSON.stringify(d, null, 1)}\n`;
