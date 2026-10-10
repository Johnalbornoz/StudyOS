/**
 * B2 -- readiness / feasibility projection (pure, read-only). What Q1 can consume.
 *
 * It answers "what could the available content support?" by running THE SAME solver the runtime selection
 * uses, in dry-run: with a generic learner who has no evidence, and with no Student, no attempt and no
 * write. Readiness and selection therefore cannot disagree about what is coverable.
 *
 * It is not a selection for anyone: `evaluateFeasibility` returns counts, classifications and solver
 * statuses -- never a list of questions to deliver. Choosing questions for a Student is `pipeline.ts`.
 *
 * Technical-demo / fixture content is excluded: only questions eligible for a STUDENT delivery are counted.
 */
import type { FormPosition } from '@/lib/exam-core/form-assembly';
import type { QuestionCoverage } from '@/lib/assessment-foundation/question-coverage';
import type { QuestionEligibilityRequest } from '@/lib/assessment-foundation/question-eligibility';
import type { AssessmentFamily } from '@/lib/assessment-foundation/families';
import { strengthOn, targetKey, type SolverCandidate, type TargetKind } from '../solver/candidate';
import { solveBlueprint } from '../solver/solve';
import type { SolveStatus, TargetPlan, UnmetCause } from '../solver/plan';
import { eligibleSolverCandidates, type CandidateExtras } from '../pipeline';
import { neutralEvidenceNeeds, type EvidenceCountPolicy } from '../policy/evidence-requirement';
import { DEPTH_PRESETS, depthRequirementFor, PRACTICE_DEPTHS, type PracticeDepth } from '../policy/practice-depth';
import { buildOfficialBlueprint } from '../policy/official-exam';

export type TargetCoverageClass = 'DIRECT' | 'SUPPORTING_ONLY' | 'DERIVED_ONLY' | 'UNCOVERED';

export interface DepthFeasibility {
  status: SolveStatus;
  /** Questions the dry run needed. A property of the result, reported for sizing -- not a list. */
  questionsNeeded: number;
  targetsUnmet: number;
  causes: Partial<Record<UnmetCause, number>>;
}

export interface FeasibilityReport {
  kind: TargetKind;
  targets: number;
  /** Questions eligible for a Student delivery in this context. */
  eligibleQuestions: number;
  rejected: Record<string, number>;
  /** Offered questions whose own coverage has no canonical concept (unmapped objective / unlinked concept). */
  unresolvedQuestions: number;
  coverage: Record<TargetCoverageClass, number>;
  coverageByTarget: Array<{ id: string; class: TargetCoverageClass; direct: number; supporting: number; derived: number }>;
  diversity: {
    difficultyLevels: number;
    difficultyUnknown: number;
    questionTypes: number;
    questionTypeUnknown: number;
  };
  /** Targets with at least twice the DIRECT questions a BALANCED practice needs: a second, non-repeating practice exists. */
  repeatSafeTargets: number;
  depth: Record<PracticeDepth, DepthFeasibility>;
  /** One DIRECT look at every target. */
  diagnostic: DepthFeasibility;
  /** Total duration is knowable only if every eligible question records one. */
  durationKnown: boolean;
}

function classify(direct: number, supporting: number, derived: number): TargetCoverageClass {
  if (direct > 0) return 'DIRECT';
  if (supporting > 0) return 'SUPPORTING_ONLY';
  if (derived > 0) return 'DERIVED_ONLY';
  return 'UNCOVERED';
}

function dryRun(plan: TargetPlan, candidates: readonly SolverCandidate[]): DepthFeasibility {
  const outcome = solveBlueprint(plan, candidates);
  const causes: Partial<Record<UnmetCause, number>> = {};
  for (const u of outcome.unmet) causes[u.cause] = (causes[u.cause] ?? 0) + 1;
  return { status: outcome.status, questionsNeeded: outcome.selected.length, targetsUnmet: new Set(outcome.unmet.map((u) => u.subject)).size, causes };
}

export interface FeasibilityInput {
  kind: TargetKind;
  /** Canonical concept ids or learning objective ids. */
  targetIds: readonly string[];
  /** Coverage of the questions on offer (typically the reviewed bank for an exam version or a curriculum scope). */
  coverages: readonly QuestionCoverage[];
  /** The generic delivery context to judge eligibility in. No real Student is involved. */
  eligibility: { family: AssessmentFamily; examVersionId?: string | null; structureVersionIds?: readonly string[] | null };
  evidencePolicy: EvidenceCountPolicy;
}

/** Generic, static feasibility of a target set against a pool of questions. Selects nothing for anyone. */
export function evaluateFeasibility(input: FeasibilityInput): FeasibilityReport {
  const targetIds = [...new Set(input.targetIds)].sort();
  const request: QuestionEligibilityRequest = {
    family: input.eligibility.family,
    // A readiness projection has no Student: per-student cached questions can never be counted as bank readiness.
    studentId: '',
    examVersionId: input.eligibility.examVersionId ?? null,
    structureVersionIds: input.eligibility.structureVersionIds ?? null,
  };
  const { candidates, summary } = eligibleSolverCandidates(input.coverages, request);
  const keys = targetIds.map((id) => ({ id, key: targetKey(input.kind, id) }));

  const coverageByTarget = keys.map(({ id, key }) => {
    let direct = 0;
    let supporting = 0;
    let derived = 0;
    for (const c of candidates) {
      const s = strengthOn(c, key);
      if (s === 'DIRECT') direct += 1;
      else if (s === 'SUPPORTING') supporting += 1;
      else if (s === 'DERIVED') derived += 1;
    }
    return { id, class: classify(direct, supporting, derived), direct, supporting, derived };
  });
  const coverage: Record<TargetCoverageClass, number> = { DIRECT: 0, SUPPORTING_ONLY: 0, DERIVED_ONLY: 0, UNCOVERED: 0 };
  for (const t of coverageByTarget) coverage[t.class] += 1;

  // The same generic learner for every depth: no evidence at all (the canonical deficits are the policy minimums).
  const needs = neutralEvidenceNeeds(targetIds, input.evidencePolicy);
  const planFor = (depth: PracticeDepth | 'DIAGNOSTIC'): TargetPlan => ({
    mode: 'TARGETS',
    family: input.eligibility.family,
    targets: needs.map((n) => ({
      targetKey: targetKey(input.kind, n.canonicalConceptId),
      kind: input.kind,
      id: n.canonicalConceptId,
      priority: n.priority,
      ...(depth === 'DIAGNOSTIC' ? { opportunities: 1, directOpportunities: 1, independentDemonstrations: 0 } : depthRequirementFor(n, depth, false)),
    })),
    accept: { supporting: depth === 'DIAGNOSTIC' ? false : DEPTH_PRESETS[depth].acceptSupporting, derived: false },
    soft: { difficulty: null, diversity: depth === 'DIAGNOSTIC' ? { questionTypes: 1, difficultyLevels: 1 } : DEPTH_PRESETS[depth].diversity, avoidRecent: false },
    hard: { excludeRecent: false, maxSeconds: null },
    unresolvedTargets: [],
  });
  const depth = Object.fromEntries(PRACTICE_DEPTHS.map((d) => [d, dryRun(planFor(d), candidates)])) as Record<PracticeDepth, DepthFeasibility>;

  const balanced = new Map(planFor('BALANCED').targets.map((t) => [t.id, Math.max(1, t.directOpportunities)]));
  return {
    kind: input.kind,
    targets: targetIds.length,
    eligibleQuestions: summary.eligible,
    rejected: summary.rejected,
    unresolvedQuestions: input.coverages.filter((c) => c.conceptResolution.status !== 'RESOLVED').length,
    coverage,
    coverageByTarget,
    diversity: {
      difficultyLevels: new Set(candidates.map((c) => c.difficulty).filter((x): x is number => x !== null)).size,
      difficultyUnknown: candidates.filter((c) => c.difficulty === null).length,
      questionTypes: new Set(candidates.map((c) => c.questionType).filter((x): x is string => !!x)).size,
      questionTypeUnknown: candidates.filter((c) => !c.questionType).length,
    },
    repeatSafeTargets: coverageByTarget.filter((t) => t.direct >= 2 * (balanced.get(t.id) ?? 1)).length,
    depth,
    diagnostic: dryRun(planFor('DIAGNOSTIC'), candidates),
    durationKnown: candidates.length > 0 && candidates.every((c) => c.estimatedSeconds !== null),
  };
}

export interface OfficialSlotFeasibility {
  positions: number;
  eligibleQuestions: number;
  status: SolveStatus;
  /** Positions no eligible reviewed item fits. */
  unfillablePositions: number[];
  rejected: Record<string, number>;
}

/** Can the official blueprint's positions be filled with eligible reviewed content? Fills nothing for anyone. */
export function evaluateOfficialSlotFeasibility(input: { examVersionId: string; positions: readonly FormPosition[]; coverages: readonly QuestionCoverage[]; extras?: ReadonlyMap<string, CandidateExtras>; use?: 'FULL_MOCK' | 'REDUCED_MOCK' }): OfficialSlotFeasibility {
  const { plan } = buildOfficialBlueprint({ studentId: 'readiness', examTargetId: null, examVersionId: input.examVersionId, blueprintId: null, positions: input.positions });
  const { candidates, summary } = eligibleSolverCandidates(input.coverages, { family: 'OFFICIAL_EXAM', studentId: '', examVersionId: input.examVersionId, use: input.use ?? 'FULL_MOCK' }, new Map(), input.extras);
  const outcome = solveBlueprint(plan, candidates);
  return { positions: plan.slots.length, eligibleQuestions: summary.eligible, status: outcome.status, unfillablePositions: outcome.unmet.map((u) => Number(u.subject.replace('SLOT:', ''))).sort((a, b) => a - b), rejected: summary.rejected };
}
