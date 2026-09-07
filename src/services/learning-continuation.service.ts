/**
 * LX-5E -- LEARNING CONTINUATION RESOLVER (read/orchestration boundary).
 *
 * ONE boundary. When an activity (or Learn) finishes, it re-reads
 * canonical learning truth and asks the CANONICAL authority what should
 * happen next for this concept:
 *
 *   1. Phase 4 -- `getBestLearningDecisionForConcept` (the same call
 *      Concept Mission's NOW and `/api/learning/session/start` use).
 *   2. If Phase 4 has nothing AND the concept is a NOT_STARTED,
 *      curriculum-eligible concept -- Phase 8's canonical first-touch
 *      `bootstrapNotStartedLearningDecision` (activityType PRACTICE,
 *      priorityScore 0). This is NOT a local "Practice after Learn"
 *      rule -- it is Phase 8's already-canonical NOT_STARTED entry
 *      decision, only ever used when Phase 4 emits none
 *      (`hasLiveDecisionForConcept`).
 *   3. Otherwise -- no canonical next action; return to Concept Mission.
 *
 * The chosen decision is launched through the existing
 * `startLearningSession` (quiz / remediation / transfer / verification
 * URL resolution). This module NEVER ranks, NEVER picks an ActivityType
 * itself, NEVER writes evidence, NEVER creates a second recommendation
 * engine.
 */
import { getBestLearningDecisionForConcept } from '@/services/adaptive-teaching.service';
import { getLearningDecisions } from '@/services/adaptive-learning-orchestrator.service';
import { startLearningSession } from '@/services/learning-session-engine.service';
import { getCurriculumEligibleConcepts } from '@/services/curriculum-eligibility-read.service';
import { bootstrapNotStartedLearningDecision, hasLiveDecisionForConcept } from '@/lib/curriculum-progression-bootstrap';
import { getConceptKnowledgeState } from '@/services/knowledge-state.service';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import type { ContinuationResolution } from '@/lib/lx/continuation';

export interface ResolveContinuationInput {
  studentId: string;
  conceptId: string;
  subjectId: string;
}

export async function resolveContinuation(input: ResolveContinuationInput): Promise<ContinuationResolution> {
  const { studentId, conceptId, subjectId } = input;

  // --- 1. Phase 4 canonical decision for this concept ---
  let phase4Decisions: Awaited<ReturnType<typeof getLearningDecisions>> = [];
  let phase4Decision: Awaited<ReturnType<typeof getBestLearningDecisionForConcept>> = null;
  try {
    const preferredLanguage = await getInterfaceLanguage(studentId);
    phase4Decisions = await getLearningDecisions(studentId, preferredLanguage);
    phase4Decision = phase4Decisions.find((d) => d.actionConceptId === conceptId) ?? null;
  } catch {
    return { status: 'RETURN_TO_MISSION', reason: 'RESOLVE_FAILED' };
  }

  if (phase4Decision) {
    try {
      const session = await startLearningSession({ studentId, learningDecision: phase4Decision });
      if (session.launchStatus === 'READY' && session.launchTarget) {
        return {
          status: 'LAUNCH',
          launchTarget: session.launchTarget,
          activityType: phase4Decision.activityType,
          source: 'PHASE_4_DECISION',
        };
      }
      return { status: 'RETURN_TO_MISSION', reason: 'DECISION_UNAVAILABLE' };
    } catch {
      return { status: 'RETURN_TO_MISSION', reason: 'RESOLVE_FAILED' };
    }
  }

  // --- 2. Phase 8 canonical NOT_STARTED first-touch (only when Phase 4 has none) ---
  try {
    if (!hasLiveDecisionForConcept(phase4Decisions, conceptId)) {
      const ks = await getConceptKnowledgeState(studentId, conceptId).catch(() => null);
      const isNotStarted = ks == null || ks.masteryState === 'UNKNOWN';
      if (isNotStarted) {
        const eligible = await getCurriculumEligibleConcepts(studentId).catch(() => []);
        if (eligible.some((e) => e.conceptId === conceptId)) {
          const bootstrap = bootstrapNotStartedLearningDecision({ studentId, subjectId, conceptId });
          const session = await startLearningSession({ studentId, learningDecision: bootstrap });
          if (session.launchStatus === 'READY' && session.launchTarget) {
            return {
              status: 'LAUNCH',
              launchTarget: session.launchTarget,
              activityType: bootstrap.activityType,
              source: 'CURRICULUM_FIRST_TOUCH',
            };
          }
        }
      }
    }
  } catch {
    return { status: 'RETURN_TO_MISSION', reason: 'RESOLVE_FAILED' };
  }

  // --- 3. No canonical next action ---
  return { status: 'RETURN_TO_MISSION', reason: 'NO_CANONICAL_ACTION' };
}
