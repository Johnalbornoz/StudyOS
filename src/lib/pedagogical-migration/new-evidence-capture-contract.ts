/**
 * CANON-R4 Parts 22-28 -- NEW v1 EVIDENCE CAPTURE CONTRACT.
 *
 * These types document exactly what a FUTURE write path must capture
 * for each stage once v1 cutover is active. They are a DATA CONTRACT
 * ONLY -- nothing in this file is wired into any generation route,
 * session route, or DB write path in this phase (Part 45: "Only modify
 * generation/session contracts if strictly necessary to make them
 * CAPABLE of producing v1 evidence later... Feature/config gating is
 * preferred"). This session's own judgment: no existing route needs to
 * change AT ALL to become capable later -- capability is fully
 * achievable by introducing this additive, unwired contract now and
 * wiring a real write path to it in a future, separately-reviewed
 * cutover phase. Touching the question-generation service, the quiz
 * submission route, or any session route in THIS phase would risk
 * exactly the performance/cache/routing/UX firewalls this phase must
 * not cross.
 *
 * Every field maps directly onto the frozen engine's own
 * `RawEvidenceItem` contract (`src/lib/pedagogical-engine/types.ts`) --
 * this file adds nothing the engine doesn't already need; it only
 * specifies where a REAL future capture path must source each field
 * from.
 */
import type { TransferChallengeDepth } from '@/lib/pedagogical-engine';
import { V1_POLICY_VERSION } from './types';

interface V1EvidenceCaptureCommon {
  policyVersion: typeof V1_POLICY_VERSION;
  studentId: string;
  conceptId: string;
  timestamp: string;
  difficulty: number;
}

/** Part 22 -- LEARN. No canonical item-count authority exists (matches the frozen engine's own `ActivityContract.itemCount: null` for LEARN) -- a future capture path records whatever count the comprehension check actually used, for audit, without the engine requiring a specific number. */
export interface V1LearnCheckCapture extends V1EvidenceCaptureCommon {
  activityType: 'LEARN_CHECK';
  scorePercent: number;
  itemCount: number;
  correctCount: number;
  /** LEARN permits assistance -- captured for audit, never gates qualification (the engine's own `qualifyEvidence` never checks independence for LEARN). */
  assistanceType: string;
  hintsUsed: number;
}

/** Part 23 -- PRACTICE (2-3 items). */
export interface V1PracticeCapture extends V1EvidenceCaptureCommon {
  activityType: 'PRACTICE';
  scorePercent: number;
  itemCount: number;
  correctCount: number;
  assistanceType: string;
  hintsUsed: number;
  /** Only when an authoritative, per-attempt misconception link exists -- never inferred from score alone. */
  hasCriticalMisconception?: boolean;
}

/** Part 24 -- PROVE (exactly 10 items, independent). */
export interface V1ProveCapture extends V1EvidenceCaptureCommon {
  activityType: 'PROVE';
  itemCount: 10;
  correctCount: number;
  scorePercent: number;
  independent: true;
  evidenceContract: 'PROVE_NO_HINTS_NO_TUTOR_NO_WORKED_EXAMPLES';
  hasCriticalMisconception?: boolean;
}

/** Part 25 -- RETENTION (exactly 10 novel items, independent, linked to its qualifying Prove). */
export interface V1RetentionCapture extends V1EvidenceCaptureCommon {
  activityType: 'RETENTION_CHECK';
  itemCount: 10;
  correctCount: number;
  scorePercent: number;
  independent: true;
  novel: true;
  /** Traceability only -- the frozen engine itself re-derives eligibility from the evidence ledger's own qualifying Prove timestamp; this is not a second source of truth. */
  qualifyingProveEvidenceId?: string;
  nextEligibleAtWhenAdministered?: string;
}

/** Part 26/28 -- TRANSFER (exactly 3 structured challenges, explicit per-challenge breakdown -- CANON-R3's own "never fabricate a 3-challenge breakdown" finding is the reason this shape exists at all). */
export interface V1TransferChallengeCapture {
  depth: TransferChallengeDepth;
  scorePercent: number;
  reasoningProvided?: boolean;
}

export interface V1TransferCapture extends V1EvidenceCaptureCommon {
  activityType: 'TRANSFER';
  independent: true;
  challenges: [V1TransferChallengeCapture, V1TransferChallengeCapture, V1TransferChallengeCapture];
  overallScorePercent: number;
  transferFoundationalFailureIndicated?: boolean;
  hasCriticalMisconception?: boolean;
}

export type V1EvidenceCapture = V1LearnCheckCapture | V1PracticeCapture | V1ProveCapture | V1RetentionCapture | V1TransferCapture;
