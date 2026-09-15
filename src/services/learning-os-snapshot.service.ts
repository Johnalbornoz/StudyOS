/**
 * Phase 3E -- Learning OS read/snapshot boundary. NOT a decision maker:
 * this file calls getLearningDecisions ONCE per render and hands the
 * exact same decisions to Phase 3D's existing PURE execution policy
 * (buildDailyLearningPlan/selectExecutableNextAction) -- it never
 * scores, ranks, or reorders anything itself. Product surfaces (Today,
 * Learning Debt) consume this snapshot instead of independently calling
 * Phase 3C/3D or re-deriving a recommendation.
 *
 * This is also the concrete protection against the known
 * side-effecting reads inside Phase 3C's signal loader (getActiveDebts/
 * getUpcomingForStudent): one snapshot per server render means those
 * reads happen once, not once per section/component. No polling, no
 * multi-minute cache -- a fresh render always calls getLearningDecisions
 * again, so new evidence is reflected on the very next meaningful
 * request (see docs/architecture, Phase 3E "closed loop").
 */

import { db } from '@/lib/db';
import { getLearningDecisions } from './adaptive-learning-orchestrator.service';
import {
  buildDailyLearningPlan,
  selectExecutableNextAction,
  type DailyLearningPlan,
  type LearningPlanItem,
} from '@/lib/learning-execution-policy';
import type { LearningDecision } from '@/lib/adaptive-learning-policy';
import { getTwinMemorySignal } from './memory-read.service';
import { getConceptKnowledgeState, getActiveMasteryPolicy } from './knowledge-state.service';
import { isZeroGapPracticeMismatch } from '@/lib/lx/evidence-sufficiency-contract';
import {
  isCanonicalEngineV1Enabled,
  getCanonicalPedagogicalDecision,
  resolveCanonicalLaunch,
  CanonicalDecisionUnavailableError,
  type CanonicalLearningSession,
} from '@/lib/pedagogical-decision';

/** The SAME three LearningState values deriveLearnerJourneyStage's own REINFORCE rule keys off -- never inferred from mastery/understanding alone (LX-9R8 PART A2). */
const REINFORCE_LEARNING_STATES = new Set(['MISCONCEPTION_BLOCKED', 'PREREQUISITE_BLOCKED', 'NEEDS_REPAIR']);

export interface ConceptDisplayInfo {
  label: string;
  canonicalId: string;
  subjectName: string;
}

export interface LearningOSSnapshot {
  studentId: string;
  generatedAt: string;
  decisions: LearningDecision[];
  dailyPlan: DailyLearningPlan;
  nextExecutableItem: LearningPlanItem | null;
  /**
   * LX-9R5 PART A/B/D: whether `nextExecutableItem` is a genuine
   * RETENTION obligation that isn't due yet -- computed ONCE here (the
   * one canonical snapshot boundary Today AND My Path already share) so
   * every consumer agrees without adding its own memory read. `false`
   * whenever `nextExecutableItem` is null or its `activityType` is
   * anything other than a not-yet-due retention obligation. Keyed off
   * `learningState === 'RETENTION_RISK'` (deriveLearnerJourneyStage's
   * own rule for journey stage RETAIN) -- by construction this is
   * never simultaneously MISCONCEPTION_BLOCKED/PREREQUISITE_BLOCKED/
   * NEEDS_REPAIR, so a genuine REINFORCE-justified action (Part D's
   * explicit exception) can never be suppressed by this flag.
   */
  nextExecutableItemWaiting: boolean;
  /** The canonical next-eligible-review date, verbatim from Phase 6 memory, when `nextExecutableItemWaiting` is true and a date exists. `null` otherwise. */
  nextExecutableItemNextEligibleAt: string | null;
  /**
   * LX-9R8 PART A1/A5: true when `nextExecutableItem` is a PRACTICE/
   * REVIEW decision whose canonical evidence gap is already 0, with no
   * REINFORCE-justified reason (misconception/prerequisite/repair) to
   * keep practicing -- `selectActivityType`'s qualitative fallthrough
   * (masteryState/understandingScore) never checked the quantitative
   * evidence count. Computed ONCE here (the same shared snapshot
   * boundary `nextExecutableItemWaiting` already uses) so Today can
   * never offer this CTA.
   */
  nextExecutableItemZeroGapBlocked: boolean;
  /**
   * CANON-R5 Part 9 -- when the feature gate is on and `nextExecutableItem`
   * exists, a FRESH canonical decision for that one concept (never for
   * the whole ranked list -- the ranking itself is Phase 3C/3D's, not
   * the engine's, per Part 9's own framing: "the concept shown" is still
   * legacy-selected, only "the action" for it must be canonical). `null`
   * when the gate is off, there is no `nextExecutableItem`, or the
   * canonical read itself failed (Part 28: a failed canonical read never
   * silently reverts Today to trusting the legacy activityType/waiting
   * flags below as if they were still authoritative for THIS item --
   * callers must treat `canonicalOverride === null` under a truthy gate
   * as "unknown," never as "legacy is fine").
   */
  canonicalOverride: CanonicalLearningSession | null;
  /** True only when the gate is on AND the canonical override read failed for `nextExecutableItem` -- see `canonicalOverride`'s own doc comment. */
  canonicalOverrideReadFailed: boolean;
  /** Presentation-only: concept id -> display label/subject name. Never a priority field, never used for ordering. */
  conceptLabels: Map<string, ConceptDisplayInfo>;
}

export interface LearningOSSnapshotOptions {
  availableMinutes?: number;
  now?: Date;
  preferredLanguage?: string;
}

const DEFAULT_AVAILABLE_MINUTES = 30;

/**
 * Batch, read-only concept/subject label lookup -- the one additional
 * query a product render needs beyond getLearningDecisions itself (pure
 * presentation data, not a second decision source). Never a duplicate
 * of getActiveDebts/getUpcomingForStudent; never side-effecting.
 */
export async function loadConceptLabels(conceptIds: string[], preferredLanguage: string): Promise<Map<string, ConceptDisplayInfo>> {
  const distinctIds = [...new Set(conceptIds)];
  const labels = new Map<string, ConceptDisplayInfo>();
  if (distinctIds.length === 0) return labels;

  const result = await db.query(
    `SELECT c.id, c.canonical_id, COALESCE(cl.label, c.canonical_id) AS label, s.name AS subject_name
     FROM concepts c
     JOIN subjects s ON s.id = c.subject_id
     LEFT JOIN LATERAL (
       SELECT label FROM concept_localizations WHERE concept_id = c.id ORDER BY (language = $2) DESC LIMIT 1
     ) cl ON true
     WHERE c.id = ANY($1)`,
    [distinctIds, preferredLanguage]
  );
  for (const row of result.rows) {
    labels.set(row.id, { label: row.label, canonicalId: row.canonical_id, subjectName: row.subject_name });
  }
  return labels;
}

/**
 * One Learning OS snapshot for one product render: exactly one
 * getLearningDecisions call, Phase 3D's existing pure functions applied
 * to those exact decisions, plus one batch label lookup for display.
 * Computed fresh every call -- no cache, so it stays correct in
 * serverless environments and always reflects the latest Knowledge
 * State.
 */
export async function getLearningOSSnapshot(studentId: string, options: LearningOSSnapshotOptions = {}): Promise<LearningOSSnapshot> {
  const preferredLanguage = options.preferredLanguage ?? 'en';
  const decisions = await getLearningDecisions(studentId, preferredLanguage);

  const now = options.now ?? new Date();
  const availableMinutes = options.availableMinutes ?? DEFAULT_AVAILABLE_MINUTES;
  const dailyPlan = buildDailyLearningPlan(studentId, decisions, { availableMinutes, now });
  const nextExecutableItem = selectExecutableNextAction(dailyPlan);

  let nextExecutableItemWaiting = false;
  let nextExecutableItemNextEligibleAt: string | null = null;
  if (nextExecutableItem && nextExecutableItem.decision.learningState === 'RETENTION_RISK') {
    const memorySignal = await getTwinMemorySignal(db, studentId, nextExecutableItem.decision.actionConceptId, now).catch(() => null);
    if (memorySignal?.retentionDue === false) {
      nextExecutableItemWaiting = true;
      nextExecutableItemNextEligibleAt = memorySignal.nextReviewAt;
    }
  }

  let nextExecutableItemZeroGapBlocked = false;
  if (
    nextExecutableItem &&
    (nextExecutableItem.decision.activityType === 'PRACTICE' || nextExecutableItem.decision.activityType === 'REVIEW') &&
    !REINFORCE_LEARNING_STATES.has(nextExecutableItem.decision.learningState)
  ) {
    const [ks, policy] = await Promise.all([
      getConceptKnowledgeState(studentId, nextExecutableItem.decision.actionConceptId).catch(() => null),
      getActiveMasteryPolicy().catch(() => null),
    ]);
    if (policy) {
      nextExecutableItemZeroGapBlocked = isZeroGapPracticeMismatch({
        activityType: nextExecutableItem.decision.activityType,
        hasReinforceIntervention: false,
        currentSufficiency: ks
          ? {
              evidenceCount: ks.evidenceCount,
              independentEvidenceCount: ks.independentEvidenceCount,
              passed: ks.evidenceCount >= policy.minimumEvidenceCount && ks.independentEvidenceCount >= policy.minimumIndependentEvidenceCount,
            }
          : null,
        masteryPolicy: policy,
      });
    }
  }

  const conceptIds = decisions.flatMap((d) => [d.actionConceptId, ...d.targetConceptIds]);
  const conceptLabels = await loadConceptLabels(conceptIds, preferredLanguage);

  let canonicalOverride: CanonicalLearningSession | null = null;
  let canonicalOverrideReadFailed = false;
  if (nextExecutableItem && isCanonicalEngineV1Enabled()) {
    try {
      const { decision } = await getCanonicalPedagogicalDecision({
        studentId,
        conceptId: nextExecutableItem.decision.actionConceptId,
        now: now.toISOString(),
      });
      canonicalOverride = resolveCanonicalLaunch({
        subjectId: nextExecutableItem.decision.subjectId,
        conceptId: nextExecutableItem.decision.actionConceptId,
        decision,
      });
    } catch (error) {
      canonicalOverrideReadFailed = true;
      if (!(error instanceof CanonicalDecisionUnavailableError)) throw error;
    }
  }

  return {
    studentId,
    generatedAt: now.toISOString(),
    decisions,
    dailyPlan,
    nextExecutableItem,
    nextExecutableItemWaiting,
    nextExecutableItemNextEligibleAt,
    nextExecutableItemZeroGapBlocked,
    canonicalOverride,
    canonicalOverrideReadFailed,
    conceptLabels,
  };
}
