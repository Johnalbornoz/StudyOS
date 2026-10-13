/**
 * B2 -- LEARNING blueprint policy (pure). Translates an assessment intent + the canonical evidence needs
 * into a BlueprintRequirement (the B1 contract) and the solver plan that satisfies it.
 *
 * It optimises target coverage, evidence need, independence, difficulty, variety, recent exposure and time.
 * It reuses the canonical pedagogical policy for what an activity IS (independent or not, its difficulty
 * band, its pass bar, whether items must be novel) and never restates those numbers. It states no count:
 * `evidence.itemCount` is null and the count is the solver's result.
 *
 * Intents map onto the existing activity semantics -- no new persisted activity type:
 *   CONCEPT_PRACTICE / TOPIC_PRACTICE / CUSTOM_CONCEPT_PRACTICE / MIXED_CUMULATIVE  -> PRACTICE
 *   MASTERY_CHECK                                                                   -> PROVE
 *   AD_HOC_CONCEPT_EXAM (a Student's own partial exam over concepts they chose)     -> PROVE
 *       Same activity as a mastery check: independent, no assistance, novel items. It is its own intent
 *       so that the frozen assessment and the evidence it produces carry that provenance explicitly.
 *       It is a LEARNING assessment: never an official paper, a mock or an institutional examination.
 *   RETENTION_CHECK                                                                 -> RETENTION_CHECK
 *   DIAGNOSTIC                                                                      -> one direct look at every concept
 */
import { CANONICAL_POLICY } from '@/lib/pedagogical-engine/policy';
import { BlueprintRequirementSchema, BLUEPRINT_CONTRACT_VERSION, type BlueprintRequirement, type BlueprintRequirementInput } from '@/lib/assessment-foundation/blueprint-contract';
import type { CurriculumScope, CurriculumScopeRef } from '@/lib/curriculum/curriculum-scope';
import { conceptsOfNode, scopeContainsConcept } from '@/lib/curriculum/curriculum-scope';
import type { StudentAssessmentContext } from '@/lib/assessment-foundation/student-assessment-context';
import { canonicalConceptIdForAssessment } from '@/lib/catalog/concept-identity';
import { targetKey } from '../solver/candidate';
import type { TargetPlan, TargetRequirement } from '../solver/plan';
import type { EvidenceNeed } from './evidence-requirement';
import { DEPTH_PRESETS, depthRequirementFor, PRACTICE_DEPTH_POLICY_VERSION, type PracticeDepth } from './practice-depth';
import { requestedDifficultyRange, type RequestedDifficultyBand } from '@/lib/exam-core/question-bank/requested-difficulty';

export const LEARNING_INTENTS = ['CONCEPT_PRACTICE', 'TOPIC_PRACTICE', 'CUSTOM_CONCEPT_PRACTICE', 'DIAGNOSTIC', 'MASTERY_CHECK', 'RETENTION_CHECK', 'MIXED_CUMULATIVE', 'AD_HOC_CONCEPT_EXAM'] as const;
export type LearningIntent = (typeof LEARNING_INTENTS)[number];

export const LEARNING_POLICY = { id: 'b2-learning', version: '1' } as const;

interface ActivitySemantics {
  /** The existing activity the intent maps onto. */
  activityType: 'PRACTICE' | 'PROVE' | 'RETENTION_CHECK' | 'DIAGNOSTIC_CHECK';
  independence: boolean;
  difficulty: { min: number; max: number } | null;
  minimumScorePercent: number | null;
  /** Canonical novelty rule of the activity: recently seen items are excluded outright. */
  noveltyRequired: boolean;
}

/** Every value is read from the canonical pedagogical policy; none is restated. */
export function activitySemanticsOf(intent: LearningIntent): ActivitySemantics {
  if (intent === 'MASTERY_CHECK' || intent === 'AD_HOC_CONCEPT_EXAM') return { activityType: 'PROVE', independence: CANONICAL_POLICY.prove.independenceRequired, difficulty: CANONICAL_POLICY.prove.difficulty, minimumScorePercent: CANONICAL_POLICY.prove.minimumScorePercent, noveltyRequired: false };
  if (intent === 'RETENTION_CHECK') return { activityType: 'RETENTION_CHECK', independence: CANONICAL_POLICY.retention.independenceRequired, difficulty: CANONICAL_POLICY.retention.difficulty, minimumScorePercent: CANONICAL_POLICY.retention.minimumScorePercent, noveltyRequired: CANONICAL_POLICY.retention.noveltyRequired };
  // A diagnostic looks, it does not train: no difficulty band is imposed and no pass bar exists.
  if (intent === 'DIAGNOSTIC') return { activityType: 'DIAGNOSTIC_CHECK', independence: true, difficulty: null, minimumScorePercent: null, noveltyRequired: false };
  return { activityType: 'PRACTICE', independence: CANONICAL_POLICY.practice.independenceRequired, difficulty: CANONICAL_POLICY.practice.difficulty, minimumScorePercent: CANONICAL_POLICY.practice.minimumScorePercent, noveltyRequired: false };
}

export type UnresolvedTarget = TargetPlan['unresolvedTargets'][number];

/**
 * Where a learning intent's questions come from (lib/assessment-supply/supply-boundary): every LEARNING and
 * INTERNAL ASSESSMENT intent -- a Student's own partial exam included -- is assembled from the Student's own
 * generated, validated items. None of them reads the Certified Exam Question Bank: that bank belongs to
 * standardized exam preparation. A Student who has never practised is served by generating the assessment
 * before it starts (learning-item-supply.service), never by borrowing exam content.
 *
 * `REVIEWED_EXAM_BANK` stays in the type: sessions frozen from it before this rule remain readable.
 */
export type LearningCandidateSource = 'LEARNING_ITEM_CACHE' | 'REVIEWED_EXAM_BANK';
export function candidateSourceOf(_intent: LearningIntent): LearningCandidateSource {
  return 'LEARNING_ITEM_CACHE';
}

/**
 * The canonical targets of a request, through the B1 identity rule only: a learner concept counts when its
 * link is CANONICAL; a TRANSITIONAL or UNRESOLVED one is reported as unresolved. No label is consulted.
 */
export function resolveLearningTargets(context: Pick<StudentAssessmentContext, 'learnerState'>, request: { canonicalConceptIds?: readonly string[]; learnerConceptIds?: readonly string[] }): { canonicalConceptIds: string[]; unresolved: UnresolvedTarget[] } {
  const ids = new Set<string>(request.canonicalConceptIds ?? []);
  const unresolved: UnresolvedTarget[] = [];
  const byLearner = new Map(context.learnerState.concepts.map((c) => [c.learnerConceptId, c]));
  for (const learnerConceptId of request.learnerConceptIds ?? []) {
    const identity = byLearner.get(learnerConceptId) ?? null;
    const canonical = canonicalConceptIdForAssessment(identity);
    if (canonical) ids.add(canonical);
    else unresolved.push({ ref: `LEARNER_CONCEPT:${learnerConceptId}`, reason: identity?.status === 'TRANSITIONAL' ? 'TRANSITIONAL_LINK' : 'UNRESOLVED_LINK' });
  }
  return { canonicalConceptIds: [...ids].sort(), unresolved };
}

/** Topic practice: the concepts of a node IN THIS structure version (membership is contextual to the scope). */
export function topicTargets(scope: CurriculumScope, nodeId: string): string[] {
  return conceptsOfNode(scope, nodeId).sort();
}

export interface LearningPolicyInput {
  studentId: string;
  intent: LearningIntent;
  depth: PracticeDepth;
  canonicalConceptIds: readonly string[];
  /** Canonical evidence need of each target concept (policy/evidence-requirement). */
  needs: readonly EvidenceNeed[];
  unresolved?: readonly UnresolvedTarget[];
  curriculum?: readonly CurriculumScopeRef[];
  /** When given, a target outside the scope is reported instead of practised. */
  scope?: CurriculumScope | null;
  /** A hard limit the Student states. Honoured only against recorded durations. */
  availableMinutes?: number | null;
  /**
   * A difficulty the Student states (question-bank/requested-difficulty). Hard: only questions recorded in that band are
   * selected; with too few of them the requirement is unmet -- it is never filled from another band.
   * null / absent = not stated: the activity's canonical band stays a preference, as before.
   */
  difficultyBand?: RequestedDifficultyBand | null;
}

export interface LearningBlueprintPlan {
  /** null when no requested target has a canonical identity: there is nothing a requirement could state. */
  requirement: BlueprintRequirement | null;
  plan: TargetPlan;
  depth: PracticeDepth;
}

export function buildLearningBlueprint(input: LearningPolicyInput): LearningBlueprintPlan {
  const semantics = activitySemanticsOf(input.intent);
  const preset = DEPTH_PRESETS[input.depth];
  const requestedDifficulty = input.difficultyBand ? requestedDifficultyRange(input.difficultyBand) : null;
  const preferredDifficulty = requestedDifficulty ?? semantics.difficulty;
  const unresolved: UnresolvedTarget[] = [...(input.unresolved ?? [])];
  const needByConcept = new Map(input.needs.map((n) => [n.canonicalConceptId, n]));
  const targets: TargetRequirement[] = [];
  for (const id of [...new Set(input.canonicalConceptIds)].sort()) {
    if (input.scope && !scopeContainsConcept(input.scope, id)) {
      unresolved.push({ ref: `CONCEPT:${id}`, reason: 'NOT_IN_SCOPE' });
      continue;
    }
    const need = needByConcept.get(id);
    if (!need) throw new Error(`EVIDENCE_NEED_MISSING: ${id}`);
    const base = { targetKey: targetKey('CONCEPT', id), kind: 'CONCEPT' as const, id, priority: need.priority };
    if (input.intent === 'DIAGNOSTIC') {
      // Breadth, not depth: one DIRECT look at each concept, whatever the depth preset.
      targets.push({ ...base, opportunities: 1, directOpportunities: 1, independentDemonstrations: 0 });
      continue;
    }
    targets.push({ ...base, ...depthRequirementFor(need, input.depth, semantics.independence) });
  }

  const plan: TargetPlan = {
    mode: 'TARGETS',
    family: 'LEARNING',
    targets,
    // A concept reached only through an objective mapping (DERIVED) never satisfies a concept requirement.
    accept: { supporting: input.intent === 'DIAGNOSTIC' ? false : preset.acceptSupporting, derived: false },
    soft: {
      difficulty: preferredDifficulty ? { min: preferredDifficulty.min, max: preferredDifficulty.max, target: null } : null,
      diversity: preset.diversity,
      avoidRecent: true,
    },
    // the key exists only when a difficulty was asked for: a plan without one is exactly what it always was
    hard: { excludeRecent: semantics.noveltyRequired, maxSeconds: input.availableMinutes ? Math.round(input.availableMinutes * 60) : null, ...(requestedDifficulty ? { difficulty: requestedDifficulty } : {}) },
    unresolvedTargets: unresolved,
  };

  const requirement = targets.length === 0 ? null : BlueprintRequirementSchema.parse({
    v: BLUEPRINT_CONTRACT_VERSION,
    family: 'LEARNING',
    policy: { id: LEARNING_POLICY.id, version: `${LEARNING_POLICY.version}+${PRACTICE_DEPTH_POLICY_VERSION}:${input.depth}` },
    studentId: input.studentId,
    curriculum: [...(input.curriculum ?? [])],
    targets: { canonicalConceptIds: targets.map((t) => t.id), learningObjectiveIds: [] },
    evidence: {
      activityType: semantics.activityType,
      // No count is a policy value: the number of questions is the solver's result.
      itemCount: null,
      independence: semantics.independence,
      supportLevel: semantics.independence ? 'NONE' : 'ASSISTED',
      minimumScorePercent: semantics.minimumScorePercent,
      evidenceContract: `B2:${input.intent}:${input.depth}`,
      novelItemsRequired: semantics.noveltyRequired,
    },
    difficulty: preferredDifficulty ? { min: preferredDifficulty.min, max: preferredDifficulty.max, target: null, reasonCode: requestedDifficulty ? `STUDENT_REQUESTED_BAND:${input.difficultyBand}` : 'CANONICAL_ACTIVITY_BAND' } : null,
    diversity: { questionTypes: [], maxPerTemplate: null },
    time: input.availableMinutes ? { availableMinutes: input.availableMinutes, officialMinutes: null } : null,
    exposure: { avoidSeenByStudent: true },
  } satisfies BlueprintRequirementInput);

  return { requirement, plan, depth: input.depth };
}
