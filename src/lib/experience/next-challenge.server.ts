/**
 * UX-2 -- server-side inputs for `presentNextChallenge`.
 *
 * Reads only. The canonical launch for a concept is obtained exactly the
 * way /api/learning/session/start obtains it
 * (`getCanonicalPedagogicalDecision` -> `resolveCanonicalLaunch`), so a
 * surface can never display an activity other than the one its Start
 * button will launch. The snapshot's own `canonicalOverride` is reused for
 * the snapshot's next executable concept instead of reading it twice.
 */
import type { LearningDecision } from '@/lib/adaptive-learning-policy';
import type { LearningOSSnapshot } from '@/services/learning-os-snapshot.service';
import {
  isCanonicalEngineV1Enabled,
  getCanonicalPedagogicalDecision,
  resolveCanonicalLaunch,
  CanonicalDecisionUnavailableError,
  type CanonicalLearningSession,
} from '@/lib/pedagogical-decision';
import { presentNextChallenge, type LegacyGate, type NextChallengeView } from './next-challenge';

/** Today / My Path hero: the snapshot's next executable item, with the snapshot's own gates. */
export function presentSnapshotNextChallenge(snapshot: LearningOSSnapshot): NextChallengeView | null {
  const best = snapshot.nextExecutableItem;
  if (!best) return null;
  return presentNextChallenge({
    conceptId: best.decision.actionConceptId,
    subjectId: best.decision.subjectId,
    legacyDecision: best.decision,
    canonicalAuthority: isCanonicalEngineV1Enabled(),
    canonical: snapshot.canonicalOverride,
    legacyGate: {
      waiting: snapshot.nextExecutableItemWaiting,
      nextEligibleAt: snapshot.nextExecutableItemNextEligibleAt,
      zeroGapBlocked: snapshot.nextExecutableItemZeroGapBlocked,
    },
  });
}

async function readCanonicalLaunch(studentId: string, subjectId: string, conceptId: string): Promise<CanonicalLearningSession | null> {
  try {
    const { decision } = await getCanonicalPedagogicalDecision({ studentId, conceptId });
    return resolveCanonicalLaunch({ subjectId, conceptId, decision });
  } catch (error) {
    if (error instanceof CanonicalDecisionUnavailableError) return null;
    throw error;
  }
}

/**
 * Any other concept a surface offers a Start button for. `legacyGate` is
 * only consulted when the canonical gate is off; callers pass the SAME
 * legacy gate flags My Path already computes for that concept.
 */
export async function loadConceptNextChallenge(params: {
  studentId: string;
  subjectId: string;
  conceptId: string;
  legacyDecision: LearningDecision;
  snapshot: LearningOSSnapshot | null;
  legacyGate?: LegacyGate;
}): Promise<NextChallengeView> {
  const { studentId, subjectId, conceptId, legacyDecision, snapshot } = params;
  if (snapshot?.nextExecutableItem?.decision.actionConceptId === conceptId) {
    const fromSnapshot = presentSnapshotNextChallenge(snapshot);
    if (fromSnapshot) return fromSnapshot;
  }
  const canonicalAuthority = isCanonicalEngineV1Enabled();
  const canonical = canonicalAuthority ? await readCanonicalLaunch(studentId, subjectId, conceptId) : null;
  return presentNextChallenge({ conceptId, subjectId, legacyDecision, canonicalAuthority, canonical, legacyGate: params.legacyGate });
}
