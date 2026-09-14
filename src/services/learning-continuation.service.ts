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
import { getBestLearningDecisionForConcept, getTeachingIntent } from '@/services/adaptive-teaching.service';
import { getLearningDecisions } from '@/services/adaptive-learning-orchestrator.service';
import { startLearningSession, type LearningSession } from '@/services/learning-session-engine.service';
import { deriveTeachingExperience, type TeachingExperienceView } from '@/lib/lx/teaching-experience';
import type { LearningDecision } from '@/lib/adaptive-learning-policy';
import { getCurriculumEligibleConcepts } from '@/services/curriculum-eligibility-read.service';
import { bootstrapNotStartedLearningDecision, hasLiveDecisionForConcept } from '@/lib/curriculum-progression-bootstrap';
import { getConceptKnowledgeState, getActiveMasteryPolicy } from '@/services/knowledge-state.service';
import { isZeroGapPracticeMismatch } from '@/lib/lx/evidence-sufficiency-contract';

/** The SAME three LearningState values deriveLearnerJourneyStage's own REINFORCE rule keys off -- never inferred from mastery/understanding alone (LX-9R8 PART A2). */
const REINFORCE_LEARNING_STATES = new Set(['MISCONCEPTION_BLOCKED', 'PREREQUISITE_BLOCKED', 'NEEDS_REPAIR']);
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { db } from '@/lib/db';
import { getTwinMemorySignal } from '@/services/memory-read.service';
import type { ContinuationResolution } from '@/lib/lx/continuation';

export interface ResolveContinuationInput {
  studentId: string;
  conceptId: string;
  subjectId: string;
}

/**
 * LX-4P-PERF-R1C C12 -- derive the launch's Teaching Experience ONCE,
 * here, from the canonical decision this resolver already holds.
 *
 * It reuses the SAME `getTeachingIntent` + `deriveTeachingExperience`
 * the quiz page's `/api/learning/teaching-intent` call would run, and
 * the canonical `EvidenceMode` the session engine already fixed for the
 * launched activity (`LearningSession.evidenceMode` =
 * `evidenceModeForActivity(activityType)`). The client transports this
 * to the launch instead of recomputing it. Best-effort only: any
 * failure returns `null` and the client falls back to its own canonical
 * `/api/learning/teaching-intent` resolution. This never decides or
 * writes anything -- `deriveTeachingExperience` is pure presentation,
 * and every downstream evidence / permission gate is still enforced
 * server-side regardless of what the client transports.
 */
async function deriveLaunchTeachingExperience(
  studentId: string,
  decision: LearningDecision,
  session: Pick<LearningSession, 'evidenceMode'>,
): Promise<TeachingExperienceView | null> {
  try {
    const intent = await getTeachingIntent(studentId, decision);
    if (!intent) return null;
    return deriveTeachingExperience({
      supportLevel: intent.supportLevel,
      explanationDepth: intent.explanationDepth,
      evidenceMode: session.evidenceMode,
      primaryBarrier: intent.primaryBarrier,
      hasActiveMisconception: intent.misconceptionCodes.length > 0,
    });
  } catch {
    return null;
  }
}

/** LX-9 FINAL, PART U: safe, aggregate-only observability for one continuation resolution -- never learner answer/question content. */
function logContinuationResolution(conceptId: string, result: ContinuationResolution): void {
  try {
    // eslint-disable-next-line no-console
    console.log('[continuation]', JSON.stringify({
      conceptId,
      continuationResult: result.status,
      reason: result.status === 'RETURN_TO_MISSION' ? result.reason : null,
      activityType: result.status === 'LAUNCH' ? result.activityType : null,
      source: result.status === 'LAUNCH' ? result.source : null,
      waitingReason: result.status === 'WAITING' ? result.waitingReason : null,
      sessionCreated: result.status === 'LAUNCH',
    }));
  } catch { /* logging must never break continuation */ }
}

export async function resolveContinuation(input: ResolveContinuationInput): Promise<ContinuationResolution> {
  const result = await resolveContinuationInner(input);
  logContinuationResolution(input.conceptId, result);
  return result;
}

async function resolveContinuationInner(input: ResolveContinuationInput): Promise<ContinuationResolution> {
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
    // LX-9R5 PART C: a RETENTION_RISK decision whose review isn't due
    // yet is a genuine, dated, canonical WAITING outcome -- checked
    // BEFORE ever launching, so a residual activityType fallthrough
    // from the Learning Engine's own activity-selection policy (Part
    // D's own root cause) can never be launched as if it were the
    // required next action, and so this is never a silent
    // RETURN_TO_MISSION or an error either. `learningState ===
    // 'RETENTION_RISK'` is, by construction, never simultaneously
    // MISCONCEPTION_BLOCKED/PREREQUISITE_BLOCKED/NEEDS_REPAIR -- a
    // genuine REINFORCE intervention (Part D's explicit exception) is
    // therefore never suppressed by this check.
    if (phase4Decision.learningState === 'RETENTION_RISK') {
      const memorySignal = await getTwinMemorySignal(db, studentId, conceptId).catch(() => null);
      if (memorySignal?.retentionDue === false) {
        return { status: 'WAITING', waitingReason: 'RETENTION_NOT_DUE', nextEligibleAt: memorySignal.nextReviewAt };
      }
    }
    // LX-9R8 PART A1/A8: a PRACTICE/REVIEW decision whose canonical
    // evidence gap is already 0, with no REINFORCE-justified reason to
    // keep practicing, is NOT executable -- never launched. Checked
    // BEFORE startLearningSession, same discipline as the WAITING check
    // above.
    if (
      (phase4Decision.activityType === 'PRACTICE' || phase4Decision.activityType === 'REVIEW') &&
      !REINFORCE_LEARNING_STATES.has(phase4Decision.learningState)
    ) {
      const [ks, policy] = await Promise.all([
        getConceptKnowledgeState(studentId, conceptId).catch(() => null),
        getActiveMasteryPolicy().catch(() => null),
      ]);
      if (policy) {
        const zeroGapMismatch = isZeroGapPracticeMismatch({
          activityType: phase4Decision.activityType,
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
        if (zeroGapMismatch) {
          return { status: 'RETURN_TO_MISSION', reason: 'ZERO_GAP_MISMATCH' };
        }
      }
    }
    try {
      const session = await startLearningSession({ studentId, learningDecision: phase4Decision });
      if (session.launchStatus === 'READY' && session.launchTarget) {
        const teachingExperience = await deriveLaunchTeachingExperience(studentId, phase4Decision, session);
        return {
          status: 'LAUNCH',
          launchTarget: session.launchTarget,
          activityType: phase4Decision.activityType,
          source: 'PHASE_4_DECISION',
          teachingExperience,
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
            const teachingExperience = await deriveLaunchTeachingExperience(studentId, bootstrap, session);
            return {
              status: 'LAUNCH',
              launchTarget: session.launchTarget,
              activityType: bootstrap.activityType,
              source: 'CURRICULUM_FIRST_TOUCH',
              teachingExperience,
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
