/**
 * Question Bank V2 -- DEMAND-DRIVEN INVENTORY (pure).
 *
 * How many distinct approved questions a blueprint cell needs is computed from
 * actual Student demand, never from one fixed number per concept:
 *
 *   EXPECTED_EXPOSURES        = Students in process   x questions each over the horizon
 *                             + Students with retention due x retention questions each
 *                             + Students assigned the concept x assignment questions each
 *   REQUIRED_UNIQUE_QUESTIONS = EXPECTED_EXPOSURES / TARGET_MAX_STUDENTS_PER_QUESTION
 *                               (never fewer than one practice form of the cell)
 *   then split by the difficulty mix, compared with the APPROVED usable inventory
 *   per band -> deficit, repeat rate, days of coverage, GREEN / YELLOW / RED, and a
 *   Factory recommendation with its difficulty mix.
 *
 * An operational capacity model, not a mathematical guarantee: it plans inventory so
 * that, within the horizon, a Student rarely meets the same question twice and a
 * question is not shown to more Students than the exposure ceiling.
 */
import { apportion } from './cells';
import type { DifficultyBand } from './quality';

export interface DemandPolicy {
  horizonDays: number;
  /** Practice questions one Student working the exam answers over the horizon, across the whole exam (spread by the cell's blueprint share). */
  practiceQuestionsPerStudent: number;
  /** Mock forms one Student takes over the horizon (each uses the cell's positions once). */
  mocksPerStudent: number;
  retentionQuestionsPerStudent: number;
  assignmentQuestionsPerStudent: number;
  /** Exposure ceiling: how many Students may meet the same question within the horizon. */
  targetMaxStudentsPerQuestion: number;
  difficultyMix: Record<DifficultyBand, number>;
  /** YELLOW below this share of the requirement (or below the horizon of coverage). */
  yellowAt: number;
}

export const DEFAULT_DEMAND_POLICY: DemandPolicy = {
  horizonDays: 14,
  practiceQuestionsPerStudent: 60,
  mocksPerStudent: 1,
  retentionQuestionsPerStudent: 3,
  assignmentQuestionsPerStudent: 5,
  targetMaxStudentsPerQuestion: 8,
  difficultyMix: { LOW: 0.3, MEDIUM: 0.5, HIGH: 0.2 },
  yellowAt: 0.75,
};

export interface CellDemandInput {
  /** Share of the exam's blueprint positions this cell holds (0..1). */
  blueprintShare: number;
  reducedPositions: number;
  /** Students actively preparing the exam whose learner state for the cell's concepts is not yet secure (or unknown). */
  studentsInProcess: number;
  studentsRetentionDue: number;
  studentsAssigned: number;
  /** Approved, practice-usable versions by effective difficulty band. */
  approvedByBand: Record<DifficultyBand, number>;
  /** Of those, usable for mocks. */
  mockReady: number;
  /** Exposures of this cell's items in the last horizon (exam_item_usage). */
  recentExposures: number;
  /** Distinct Students exposed in the last horizon. */
  recentStudents: number;
  /** Candidates already in the pipeline (pilot awaiting review, validating, queued). */
  inPipeline: number;
}

export type InventoryStatus = 'GREEN' | 'YELLOW' | 'RED';

export interface CellDemand {
  studentsInProcess: number;
  studentsRetentionDue: number;
  studentsAssigned: number;
  expectedQuestionsPerStudent: number;
  expectedExposures: number;
  requiredUnique: number;
  approved: number;
  approvedByBand: Record<DifficultyBand, number>;
  requiredByBand: Record<DifficultyBand, number>;
  practiceReady: number;
  mockReady: number;
  deficit: number;
  deficitByBand: Record<DifficultyBand, number>;
  /** Share of expected exposures that would exceed the per-question exposure ceiling. */
  expectedRepeatRate: number;
  /** Recent exposures per approved question (last horizon). */
  currentExposureRate: number | null;
  estimatedDaysOfCoverage: number | null;
  status: InventoryStatus;
  recommendation: { generate: number; mix: Record<DifficultyBand, number>; inPipeline: number };
}

const BANDS: DifficultyBand[] = ['LOW', 'MEDIUM', 'HIGH'];

export function computeCellDemand(input: CellDemandInput, policy: DemandPolicy = DEFAULT_DEMAND_POLICY): CellDemand {
  const perStudent = Math.max(1, Math.round(policy.practiceQuestionsPerStudent * input.blueprintShare)) + policy.mocksPerStudent * input.reducedPositions;
  const expectedExposures = input.studentsInProcess * perStudent + input.studentsRetentionDue * policy.retentionQuestionsPerStudent + input.studentsAssigned * policy.assignmentQuestionsPerStudent;
  const demandUnique = Math.ceil(expectedExposures / Math.max(1, policy.targetMaxStudentsPerQuestion));
  // Unseen-first needs at least one Student's own questions in distinct items, and one practice form of the cell.
  const requiredUnique = expectedExposures > 0 ? Math.max(demandUnique, perStudent, input.reducedPositions) : 0;
  const weights = BANDS.map((b) => policy.difficultyMix[b]);
  const reqArr = apportion(requiredUnique, weights);
  const requiredByBand = Object.fromEntries(BANDS.map((b, i) => [b, reqArr[i]])) as Record<DifficultyBand, number>;
  const approved = BANDS.reduce((n, b) => n + input.approvedByBand[b], 0);
  const deficitByBand = Object.fromEntries(BANDS.map((b) => [b, Math.max(0, requiredByBand[b] - input.approvedByBand[b])])) as Record<DifficultyBand, number>;
  const deficit = Math.max(0, requiredUnique - approved);
  const bandShort = BANDS.reduce((n, b) => n + deficitByBand[b], 0);

  // Generate what is missing, in the bands that are short; never less than the total deficit (extra goes to MEDIUM).
  const generateTotal = Math.max(0, Math.max(deficit, bandShort) - input.inPipeline);
  const mix = { ...deficitByBand };
  const extra = Math.max(deficit, bandShort) - bandShort;
  if (extra > 0) mix.MEDIUM += extra;
  // Scale the mix down by what is already in the pipeline (largest bands first).
  let over = BANDS.reduce((n, b) => n + mix[b], 0) - generateTotal;
  for (const b of ['MEDIUM', 'LOW', 'HIGH'] as DifficultyBand[]) {
    const take = Math.min(mix[b], Math.max(0, over));
    mix[b] -= take;
    over -= take;
  }

  const capacity = approved * policy.targetMaxStudentsPerQuestion;
  const expectedRepeatRate = expectedExposures > 0 ? Math.max(0, 1 - capacity / expectedExposures) : 0;
  const days = expectedExposures > 0 ? (capacity / expectedExposures) * policy.horizonDays : null;
  const estimatedDaysOfCoverage = days === null ? null : Math.round(Math.min(days, 365) * 10) / 10;
  let status: InventoryStatus = 'GREEN';
  if (expectedExposures > 0) {
    if (approved === 0 || approved < requiredUnique * 0.5 || (estimatedDaysOfCoverage ?? 0) < policy.horizonDays / 2) status = 'RED';
    else if (deficit > 0 || bandShort > 0 || (estimatedDaysOfCoverage ?? 0) < policy.horizonDays) status = 'YELLOW';
  }
  return {
    studentsInProcess: input.studentsInProcess,
    studentsRetentionDue: input.studentsRetentionDue,
    studentsAssigned: input.studentsAssigned,
    expectedQuestionsPerStudent: perStudent,
    expectedExposures,
    requiredUnique,
    approved,
    approvedByBand: input.approvedByBand,
    requiredByBand,
    practiceReady: approved,
    mockReady: input.mockReady,
    deficit,
    deficitByBand,
    expectedRepeatRate: Math.round(expectedRepeatRate * 1000) / 1000,
    currentExposureRate: approved > 0 ? Math.round((input.recentExposures / approved) * 100) / 100 : null,
    estimatedDaysOfCoverage,
    status,
    recommendation: { generate: generateTotal, mix, inPipeline: input.inPipeline },
  };
}

/** Per-candidate difficulty plan for a generation batch from a band mix (LOW 2, MEDIUM 3, HIGH 4). */
export function difficultyPlan(mix: Partial<Record<DifficultyBand, number>>, count: number): number[] {
  const plan: number[] = [];
  for (const b of ['LOW', 'MEDIUM', 'HIGH'] as DifficultyBand[]) for (let i = 0; i < (mix[b] ?? 0); i++) plan.push(b === 'LOW' ? 2 : b === 'MEDIUM' ? 3 : 4);
  while (plan.length < count) plan.push(3);
  return plan.slice(0, count);
}
