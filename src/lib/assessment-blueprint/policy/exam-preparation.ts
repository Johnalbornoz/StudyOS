/**
 * B2 -- EXAM_PREPARATION blueprint policy (pure). The policy B0/B1 found missing.
 *
 * Exam Preparation may adapt emphasis: it combines exam relevance, the learner's gaps, urgency and the time
 * available, and it may deliberately over-sample a weak area. It does NOT reproduce the official section
 * distribution and never claims to be a mock.
 *
 *   priority(objective) = exam importance x learner gap x urgency
 *
 * Every factor comes from a recorded fact or is neutral:
 *   - exam importance: the share of blueprint positions the official blueprint gives the objective. When
 *     the blueprint does not say, importance is NEUTRAL (and flagged) -- never inferred from how many
 *     questions the bank happens to hold.
 *   - learner gap: the published exam gaps (ExamGapCandidate): their severity, derived from exam evidence.
 *   - urgency: days to the exam, from an explicit date; unknown = neutral.
 *
 * What stays hard: every target is an objective OF THIS EXAM VERSION. A gap on an objective the exam does
 * not assess is reported and never practised here, however weak the learner is on it. Exam / curriculum /
 * licence / review eligibility is applied before the solver and no priority can bypass it.
 */
import { BlueprintRequirementSchema, BLUEPRINT_CONTRACT_VERSION, type BlueprintRequirement, type BlueprintRequirementInput } from '@/lib/assessment-foundation/blueprint-contract';
import type { ExamGapCandidate } from '@/lib/assessment-foundation/exam-gap-candidate';
import type { CurriculumScopeRef } from '@/lib/curriculum/curriculum-scope';
import { targetKey } from '../solver/candidate';
import type { TargetPlan, TargetRequirement } from '../solver/plan';

export const EXAM_PREPARATION_POLICY = { id: 'b2-exam-preparation', version: '1' } as const;

export type PreparationObjective = 'CLOSE_GAPS' | 'SECTION_PRACTICE' | 'TIMED_PREPARATION' | 'COVERAGE';

/** B2_SELECTION_POLICY: the weights. Centralised here; nothing else restates them. */
export const EXAM_PREPARATION_WEIGHTS = {
  /** Opportunities and gap weight per published gap severity. */
  gap: { HIGH: { weight: 3, opportunities: 3 }, MEDIUM: { weight: 2, opportunities: 2 }, LOW: { weight: 1, opportunities: 1 } },
  /** An exam objective with no gap, when the objective is whole-exam coverage. */
  noGap: { weight: 1, opportunities: 1 },
  /** Importance tiers from the blueprint share of the objective, relative to the largest objective. */
  importance: { high: 3, medium: 2, low: 1, unknown: 2 },
  /** Urgency from days to the exam. */
  urgency: [{ maxDays: 14, weight: 3 }, { maxDays: 45, weight: 2 }] as ReadonlyArray<{ maxDays: number; weight: number }>,
  urgencyDefault: 1,
} as const;

/** One objective of the exam version, with the weight the OFFICIAL blueprint gives it (positions), when recorded. */
export interface ExamObjectiveFacts {
  learningObjectiveId: string;
  assessmentComponentId: string | null;
  /** Blueprint positions of the objective; null = the blueprint does not state it. */
  blueprintPositions: number | null;
}

export interface ExamPreparationPolicyInput {
  studentId: string;
  examTargetId: string | null;
  examVersionId: string;
  objective: PreparationObjective;
  /** The objectives the exam version assesses: the ONLY things this assessment may target. */
  examObjectives: readonly ExamObjectiveFacts[];
  /** Published gaps of this Student for this exam target (they exist without any acceptance). */
  gaps: readonly ExamGapCandidate[];
  /** For SECTION_PRACTICE: the components to stay within. */
  assessmentComponentIds?: readonly string[];
  /** Days to the exam from an explicit `asOf`; null = no date recorded. */
  daysToExam?: number | null;
  availableMinutes?: number | null;
  curriculum?: readonly CurriculumScopeRef[];
}

export interface ExamPreparationPlan {
  requirement: BlueprintRequirement;
  plan: TargetPlan;
  /** How each target's priority was built (for the audit trail). */
  weighting: Array<{ learningObjectiveId: string; importance: number; importanceKnown: boolean; gap: number; urgency: number; priority: number; opportunities: number }>;
}

export function urgencyWeight(daysToExam: number | null | undefined): number {
  if (daysToExam === null || daysToExam === undefined || daysToExam < 0) return EXAM_PREPARATION_WEIGHTS.urgencyDefault;
  for (const tier of EXAM_PREPARATION_WEIGHTS.urgency) if (daysToExam <= tier.maxDays) return tier.weight;
  return EXAM_PREPARATION_WEIGHTS.urgencyDefault;
}

function importanceWeight(positions: number | null, largest: number): { weight: number; known: boolean } {
  const w = EXAM_PREPARATION_WEIGHTS.importance;
  if (positions === null || largest <= 0) return { weight: w.unknown, known: false };
  const share = positions / largest;
  return { weight: share >= 2 / 3 ? w.high : share >= 1 / 3 ? w.medium : w.low, known: true };
}

const SEVERITY_RANK = { HIGH: 3, MEDIUM: 2, LOW: 1 } as const;

export function buildExamPreparationBlueprint(input: ExamPreparationPolicyInput): ExamPreparationPlan {
  const components = input.assessmentComponentIds && input.assessmentComponentIds.length > 0 ? new Set(input.assessmentComponentIds) : null;
  const examObjectives = [...input.examObjectives].sort((a, b) => a.learningObjectiveId.localeCompare(b.learningObjectiveId));
  const inExam = new Map(examObjectives.map((o) => [o.learningObjectiveId, o]));
  const largest = Math.max(0, ...examObjectives.map((o) => o.blueprintPositions ?? 0));
  const urgency = urgencyWeight(input.daysToExam);

  // The worst published gap per objective. A gap outside this exam is reported, never targeted.
  const gapByObjective = new Map<string, ExamGapCandidate>();
  const unresolved: TargetPlan['unresolvedTargets'] = [];
  for (const g of [...input.gaps].sort((a, b) => (a.learningObjectiveId ?? '').localeCompare(b.learningObjectiveId ?? '') || a.canonicalConceptId.localeCompare(b.canonicalConceptId))) {
    if (!g.learningObjectiveId || !inExam.has(g.learningObjectiveId)) {
      unresolved.push({ ref: g.learningObjectiveId ? `OBJECTIVE:${g.learningObjectiveId}` : `CONCEPT:${g.canonicalConceptId}`, reason: 'NOT_EXAM_RELEVANT' });
      continue;
    }
    const prior = gapByObjective.get(g.learningObjectiveId);
    if (!prior || SEVERITY_RANK[g.severity] > SEVERITY_RANK[prior.severity]) gapByObjective.set(g.learningObjectiveId, g);
  }

  const targets: TargetRequirement[] = [];
  const weighting: ExamPreparationPlan['weighting'] = [];
  for (const o of examObjectives) {
    if (components && !(o.assessmentComponentId && components.has(o.assessmentComponentId))) continue;
    const gap = gapByObjective.get(o.learningObjectiveId) ?? null;
    // Without a gap an objective is practised only when the stated objective is coverage of the exam / a section.
    if (!gap && input.objective === 'CLOSE_GAPS') continue;
    const g = gap ? EXAM_PREPARATION_WEIGHTS.gap[gap.severity] : EXAM_PREPARATION_WEIGHTS.noGap;
    const importance = importanceWeight(o.blueprintPositions, largest);
    const priority = importance.weight * g.weight * urgency;
    targets.push({
      targetKey: targetKey('OBJECTIVE', o.learningObjectiveId),
      kind: 'OBJECTIVE',
      id: o.learningObjectiveId,
      priority,
      opportunities: g.opportunities,
      // An exam item is anchored on its own objective: that is the only coverage that counts for an objective.
      directOpportunities: g.opportunities,
      independentDemonstrations: 0,
    });
    weighting.push({ learningObjectiveId: o.learningObjectiveId, importance: importance.weight, importanceKnown: importance.known, gap: g.weight, urgency, priority, opportunities: g.opportunities });
  }
  const seenRefs = new Set<string>();
  const unresolvedTargets = unresolved.filter((u) => (seenRefs.has(u.ref) ? false : (seenRefs.add(u.ref), true)));

  const plan: TargetPlan = {
    mode: 'TARGETS',
    family: 'EXAM_PREPARATION',
    targets,
    accept: { supporting: false, derived: false },
    // Exam items carry the exam's own difficulty: no learning band is imposed on preparation.
    soft: { difficulty: null, diversity: { questionTypes: 2, difficultyLevels: 2 }, avoidRecent: true },
    hard: { excludeRecent: false, maxSeconds: input.availableMinutes ? Math.round(input.availableMinutes * 60) : null },
    unresolvedTargets,
  };

  const gapObjectiveIds = [...gapByObjective.keys()].sort();
  const requirement = BlueprintRequirementSchema.parse({
    v: BLUEPRINT_CONTRACT_VERSION,
    family: 'EXAM_PREPARATION',
    policy: { id: EXAM_PREPARATION_POLICY.id, version: EXAM_PREPARATION_POLICY.version },
    studentId: input.studentId,
    curriculum: [...(input.curriculum ?? [])],
    exam: { examTargetId: input.examTargetId, examVersionId: input.examVersionId, assessmentComponentIds: components ? [...components].sort() : [] },
    targets: { canonicalConceptIds: [], learningObjectiveIds: targets.map((t) => t.id) },
    time: input.availableMinutes ? { availableMinutes: input.availableMinutes, officialMinutes: null } : null,
    exposure: { avoidSeenByStudent: true },
    emphasis: {
      objective: input.objective,
      gapConceptIds: [...new Set([...gapByObjective.values()].map((g) => g.canonicalConceptId))].sort(),
      gapObjectiveIds,
      mayDeviateFromOfficialDistribution: true,
    },
  } satisfies BlueprintRequirementInput);

  return { requirement, plan, weighting };
}
