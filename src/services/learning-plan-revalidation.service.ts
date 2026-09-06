/**
 * Phase 8 -- Step 8E1: pre-launch revalidation.
 *
 * A persisted plan item's `intended_activity_type` is a HINT, never an
 * authority. Before it launches, Phase 8 re-asks Phase 4 live for the
 * item's concept and defers to it. A stale hint is never forced.
 *
 * Outcomes:
 *   STILL_VALID       Phase 4's live decision matches the item -> launch it
 *   REPLACE           same concept, Phase 4 now wants a different activity -> launch Phase 4's
 *   SUPERSEDE         a curriculum bootstrap item now has a real Phase 4 need -> launch Phase 4's
 *   COMPLETE_ALREADY  canonical evidence already covers it -> nothing to launch
 *   NO_LONGER_NEEDED  Phase 4 has no decision for the concept (e.g. VALIDATED) -> nothing to launch
 *
 * Read-only except that it hands the CANONICAL live decision to
 * `startLearningSession`. It never writes plan state (the maintenance
 * roll / an explicit rebuild reconciles item status).
 */
import { db, type DbExecutor } from '@/lib/db';
import { getBestLearningDecisionForConcept } from '@/services/adaptive-teaching.service';
import { getLearningDecisions } from '@/services/adaptive-learning-orchestrator.service';
import { startLearningSession, type LearningSession } from '@/services/learning-session-engine.service';
import { getLearningPlanItem } from '@/services/learning-plan-read.service';
import { bootstrapNotStartedLearningDecision } from '@/lib/curriculum-progression-bootstrap';
import type { LearningPlanItemRow } from '@/lib/learning-plan-state';
import type { LearningDecision } from '@/lib/adaptive-learning-policy';

export type RevalidationOutcome = 'STILL_VALID' | 'REPLACE' | 'SUPERSEDE' | 'COMPLETE_ALREADY' | 'NO_LONGER_NEEDED';

export interface RevalidationResult {
  outcome: RevalidationOutcome;
  item: LearningPlanItemRow | null;
  /** The canonical decision to launch (STILL_VALID / REPLACE / SUPERSEDE); null otherwise. */
  decision: LearningDecision | null;
  /** The executable launch target for `decision`; null when there is nothing to launch. */
  launch: LearningSession | null;
}

async function conceptHasEvidenceSince(client: DbExecutor, studentId: string, conceptId: string, sinceIsoDate: string): Promise<boolean> {
  const res = await client.query(
    `SELECT 1 FROM learning_evidence WHERE student_id = $1 AND concept_id = $2 AND timestamp::date >= $3 LIMIT 1`,
    [studentId, conceptId, sinceIsoDate],
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * @param nowIsoDate  YYYY-MM-DD "now" in the learner's timezone -- used only
 *                    for the "evidence since the scheduled date" check.
 */
export async function revalidateLearningPlanItem(
  studentId: string,
  itemId: string,
  nowIsoDate: string,
  client: DbExecutor = db,
): Promise<RevalidationResult> {
  const item = await getLearningPlanItem(studentId, itemId, client);
  if (!item) return { outcome: 'NO_LONGER_NEEDED', item: null, decision: null, launch: null };

  if (item.status === 'COMPLETED') return { outcome: 'COMPLETE_ALREADY', item, decision: null, launch: null };
  if (item.status !== 'PLANNED' && item.status !== 'READY') {
    // SUPERSEDED / EXPIRED / SKIPPED -- nothing to launch.
    return { outcome: 'NO_LONGER_NEEDED', item, decision: null, launch: null };
  }

  if (item.conceptId && (await conceptHasEvidenceSince(client, studentId, item.conceptId, item.scheduledDate))) {
    return { outcome: 'COMPLETE_ALREADY', item, decision: null, launch: null };
  }

  // Subject-level item (e.g. MOCK_EXAM): match against Phase 4's full decision set once.
  if (!item.conceptId) {
    const decisions = await getLearningDecisions(studentId);
    const match = decisions.find((d) => d.subjectId === item.subjectId && d.activityType === item.intendedActivityType);
    if (!match) return { outcome: 'NO_LONGER_NEEDED', item, decision: null, launch: null };
    const launch = await startLearningSession({ studentId, learningDecision: match });
    return { outcome: 'STILL_VALID', item, decision: match, launch };
  }

  const live = await getBestLearningDecisionForConcept(studentId, item.conceptId);

  if (live) {
    // A curriculum bootstrap item that Phase 4 now has a REAL decision
    // for -> supersede the bootstrap, launch Phase 4's decision.
    if (item.source === 'CURRICULUM_PROGRESSION' && live.priorityScore > 0) {
      const launch = await startLearningSession({ studentId, learningDecision: live });
      return { outcome: 'SUPERSEDE', item, decision: live, launch };
    }
    const outcome: RevalidationOutcome = live.activityType === item.intendedActivityType ? 'STILL_VALID' : 'REPLACE';
    const launch = await startLearningSession({ studentId, learningDecision: live });
    return { outcome, item, decision: live, launch };
  }

  // No live Phase 4 decision. A curriculum-progression item can still
  // launch via the canonical NOT_STARTED bootstrap (PRACTICE); anything
  // else Phase 4 no longer wants.
  if (item.source === 'CURRICULUM_PROGRESSION') {
    const bootstrap = bootstrapNotStartedLearningDecision({ studentId, subjectId: item.subjectId, conceptId: item.conceptId });
    const launch = await startLearningSession({ studentId, learningDecision: bootstrap });
    return { outcome: 'STILL_VALID', item, decision: bootstrap, launch };
  }
  return { outcome: 'NO_LONGER_NEEDED', item, decision: null, launch: null };
}
