/**
 * B2 -- the pipeline of each family (pure):
 *
 *   coverage of the available questions
 *     -> QuestionEligibility (hard; nothing ineligible reaches the solver, whatever it would score)
 *     -> solver candidates
 *     -> the family's policy (BlueprintRequirement + plan)
 *     -> the shared solver
 *     -> BlueprintResult + audit snapshot
 *
 * Three policies, one solver, one result contract. Every pipeline here is for a STUDENT delivery: the content
 * audience is never a parameter, so technical-demo / fixture content cannot enter a learner selection.
 */
import type { ItemDimensionValues } from '@/lib/exam-core/slot-constraints';
import type { DeliveryUse } from '@/lib/exam-core/question-bank/lifecycle';
import { questionRefKey, type QuestionCoverage } from '@/lib/assessment-foundation/question-coverage';
import { evaluateQuestionEligibility, type QuestionEligibilityRequest } from '@/lib/assessment-foundation/question-eligibility';
import type { AssembledForm } from '@/lib/exam-core/form-assembly';
import { candidateFromCoverage, NO_EXPOSURE, type ExposureFacts, type SolverCandidate } from './solver/candidate';
import { solveBlueprint } from './solver/solve';
import { buildSolution, evidenceDigest, type BlueprintSolution, type EligibilitySummary } from './result';
import { buildLearningBlueprint, LEARNING_POLICY, type LearningPolicyInput } from './policy/learning';
import { buildExamPreparationBlueprint, EXAM_PREPARATION_POLICY, type ExamPreparationPolicyInput, type ExamPreparationPlan } from './policy/exam-preparation';
import { buildOfficialBlueprint, OFFICIAL_EXAM_POLICY, type OfficialExamPolicyInput } from './policy/official-exam';

/** Exposure of a question for this Student, by `<store>:<id>`. Absent = never seen. */
export type ExposureIndex = ReadonlyMap<string, ExposureFacts>;

export interface CandidateExtras {
  dimensions?: ItemDimensionValues;
  templateKey?: string | null;
}

/** Hard eligibility first. Returns the questions that may compete and why the others may not. */
export function eligibleSolverCandidates(
  coverages: readonly QuestionCoverage[],
  request: QuestionEligibilityRequest,
  exposure: ExposureIndex = new Map(),
  extras: ReadonlyMap<string, CandidateExtras> = new Map()
): { candidates: SolverCandidate[]; summary: EligibilitySummary } {
  const rejected: Record<string, number> = {};
  const candidates: SolverCandidate[] = [];
  // Student deliveries only: the audience is fixed here and cannot be widened by a caller.
  const studentRequest: QuestionEligibilityRequest = { ...request, audience: 'STUDENT' };
  for (const coverage of coverages) {
    const verdict = evaluateQuestionEligibility(coverage, studentRequest);
    if (!verdict.eligible) {
      for (const reason of verdict.reasons) rejected[reason] = (rejected[reason] ?? 0) + 1;
      continue;
    }
    const key = questionRefKey(coverage.ref);
    candidates.push(candidateFromCoverage(coverage, { exposure: exposure.get(key) ?? NO_EXPOSURE, ...(extras.get(key) ?? {}) }));
  }
  return { candidates, summary: { total: coverages.length, eligible: candidates.length, rejected } };
}

/* ------------------------------------------------------------------ */
/* LEARNING                                                             */
/* ------------------------------------------------------------------ */

export interface LearningSolveInput {
  policy: LearningPolicyInput;
  /** Coverage of every question that could be used (either store). */
  coverages: readonly QuestionCoverage[];
  exposure?: ExposureIndex;
  /** Explicit "now" the evidence needs were projected at (recorded in the snapshot; never read from a clock here). */
  asOf?: string | null;
}

export function solveLearningBlueprint(input: LearningSolveInput): BlueprintSolution {
  const built = buildLearningBlueprint(input.policy);
  const targetIds = built.plan.targets.map((t) => t.id);
  const { candidates, summary } = eligibleSolverCandidates(
    input.coverages,
    { family: 'LEARNING', studentId: input.policy.studentId, canonicalConceptIds: targetIds.length > 0 ? targetIds : null, structureVersionIds: null },
    input.exposure
  );
  const outcome = solveBlueprint(built.plan, candidates);
  return buildSolution({
    requirement: built.requirement,
    plan: built.plan,
    policy: built.requirement?.policy ?? { id: LEARNING_POLICY.id, version: LEARNING_POLICY.version },
    depth: built.depth,
    candidates,
    eligibility: summary,
    outcome,
    curriculum: input.policy.curriculum,
    learnerEvidence: { digest: evidenceDigest(input.policy.needs), asOf: input.asOf ?? null },
  });
}

/* ------------------------------------------------------------------ */
/* EXAM_PREPARATION                                                     */
/* ------------------------------------------------------------------ */

export interface ExamPreparationSolveInput {
  policy: ExamPreparationPolicyInput;
  coverages: readonly QuestionCoverage[];
  exposure?: ExposureIndex;
  /** Whether the Student's own unreviewed cached questions may be used. Default: no. */
  allowUnreviewedInPreparation?: boolean;
}

export function solveExamPreparationBlueprint(input: ExamPreparationSolveInput): BlueprintSolution & { weighting: ExamPreparationPlan['weighting'] } {
  const built = buildExamPreparationBlueprint(input.policy);
  const objectiveIds = built.plan.targets.map((t) => t.id);
  const { candidates, summary } = eligibleSolverCandidates(
    input.coverages,
    {
      family: 'EXAM_PREPARATION',
      studentId: input.policy.studentId,
      // Exam applicability is hard: only questions of THIS exam version (and section, when one is asked for).
      examVersionId: input.policy.examVersionId,
      assessmentComponentIds: input.policy.assessmentComponentIds ?? null,
      learningObjectiveIds: objectiveIds.length > 0 ? objectiveIds : null,
      policy: { allowUnreviewedInPreparation: input.allowUnreviewedInPreparation === true },
    },
    input.exposure
  );
  const outcome = solveBlueprint(built.plan, candidates);
  const solution = buildSolution({ requirement: built.requirement, plan: built.plan, policy: { id: EXAM_PREPARATION_POLICY.id, version: EXAM_PREPARATION_POLICY.version }, candidates, eligibility: summary, outcome, curriculum: input.policy.curriculum, learnerEvidence: null });
  return { ...solution, weighting: built.weighting };
}

/* ------------------------------------------------------------------ */
/* OFFICIAL_EXAM                                                        */
/* ------------------------------------------------------------------ */

export interface OfficialSolveInput {
  policy: OfficialExamPolicyInput;
  coverages: readonly QuestionCoverage[];
  /** Slot dimension values / template identity of each reviewed item, by `<store>:<id>`. */
  extras?: ReadonlyMap<string, CandidateExtras>;
  exposure?: ExposureIndex;
  /** The reviewed-bank delivery use the form is assembled for (the existing selector's own choice). */
  use?: Extract<DeliveryUse, 'FULL_MOCK' | 'REDUCED_MOCK' | 'FULL_MOCK_CALIBRATED'>;
}

/** No learner evidence, gap or mastery value is an input of this function, nor of the policy it calls. */
export function solveOfficialBlueprint(input: OfficialSolveInput): BlueprintSolution {
  const built = buildOfficialBlueprint(input.policy);
  const { candidates, summary } = eligibleSolverCandidates(input.coverages, { family: 'OFFICIAL_EXAM', studentId: input.policy.studentId, examVersionId: input.policy.examVersionId, use: input.use ?? 'FULL_MOCK' }, input.exposure, input.extras);
  const outcome = solveBlueprint(built.plan, candidates);
  return buildSolution({ requirement: built.requirement, plan: built.plan, policy: { id: OFFICIAL_EXAM_POLICY.id, version: OFFICIAL_EXAM_POLICY.version }, candidates, eligibility: summary, outcome, learnerEvidence: null });
}

/* ------------------------------------------------------------------ */
/* Shadow comparison with the existing official selector                */
/* ------------------------------------------------------------------ */

export interface OfficialShadowComparison {
  /** Both produced a complete form, or both did not. */
  sameCompleteness: boolean;
  current: { filled: number; positions: number };
  b2: { filled: number; positions: number };
  /** Positions where both selectors chose the same item. */
  samePositions: number;
  /** Items used by one selector and not the other. */
  onlyCurrent: string[];
  onlyB2: string[];
}

/**
 * Compares the form the existing selector assembled with a B2 solution for the same positions. Read-only:
 * it reports, it replaces nothing. The delivered form stays the existing selector's.
 */
export function compareWithAssembledForm(form: AssembledForm, solution: BlueprintSolution): OfficialShadowComparison {
  const current = new Map(form.slots.filter((s) => s.approvedItemId).map((s) => [s.index, s.approvedItemId as string]));
  const b2 = new Map(solution.outcome.selected.filter((s) => s.slotIndex !== null).map((s) => [s.slotIndex as number, s.question.id]));
  const positions = form.slots.length;
  let samePositions = 0;
  for (const [index, id] of current) if (b2.get(index) === id) samePositions += 1;
  const currentIds = new Set(current.values());
  const b2Ids = new Set(b2.values());
  return {
    sameCompleteness: (current.size === positions) === (solution.outcome.status === 'READY'),
    current: { filled: current.size, positions },
    b2: { filled: b2.size, positions: solution.plan.mode === 'SLOTS' ? solution.plan.slots.length : 0 },
    samePositions,
    onlyCurrent: [...currentIds].filter((id) => !b2Ids.has(id)).sort(),
    onlyB2: [...b2Ids].filter((id) => !currentIds.has(id)).sort(),
  };
}
