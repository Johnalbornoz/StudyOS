/**
 * CANON-R3 Part 17 -- runs the FROZEN Pedagogical Engine v1 (unmodified
 * this phase -- see docs/CANON_R3_SHADOW_INTEGRATION.md's ENGINE FREEZE
 * VERIFICATION) against the adapted evidence snapshot and normalizes its
 * decision into the comparator's `NewCanonicalSnapshot` shape. No engine
 * behavior is touched here -- this is a thin, one-way read of the
 * engine's own already-complete output contract (CANON-R2R1).
 */
import { evaluateCanonicalLearningState, type RawEvidenceItem } from '@/lib/pedagogical-engine';
import type { NewCanonicalSnapshot } from './types';

export function buildNewCanonicalSnapshot(params: {
  conceptId: string;
  studentId: string;
  evidence: RawEvidenceItem[];
  activeCriticalMisconception: boolean;
  now: string;
}): NewCanonicalSnapshot {
  const decision = evaluateCanonicalLearningState(params);
  return {
    stage: decision.stage,
    actionState: decision.actionState,
    nextCanonicalAction: decision.nextCanonicalAction,
    progressPercent: decision.journeyProgressPercent,
    policyVersion: decision.policyVersion,
    canonicalRevision: decision.canonicalRevision,
  };
}
