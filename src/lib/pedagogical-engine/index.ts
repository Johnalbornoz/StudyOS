/**
 * CANON-R2 -- Canonical Learning State Machine v1.0: public surface.
 *
 * This is the ONLY file other code should import from. Nothing outside
 * this directory reaches into `engine.ts` / `policy.ts` /
 * `evidence-qualification.ts` / `activity-contract.ts` directly -- see
 * docs/CANON_R2_PEDAGOGICAL_ENGINE_V1.md's MODULE DEPENDENCY RULES.
 *
 * Zero imports from React, Next.js, Vercel, any AI/provider SDK, or any
 * DB client -- verified by tests/unit/canon-r2-pedagogical-engine.test.ts's
 * own Engine Isolation source audit. This module is not wired into any
 * existing route, service, or component in this phase (see the report's
 * INTEGRATION PLAN section) -- it is a new, independently-testable unit
 * that existing systems may adopt in a future, separately-reviewed step.
 */
export { CANONICAL_POLICY, POLICY_VERSION } from './policy';
export type { CanonicalPolicy, DifficultyRange } from './policy';

export { qualifyEvidence } from './evidence-qualification';
export type { EvidenceQualificationVerdict, QualificationContext } from './evidence-qualification';

export { buildActivityContract } from './activity-contract';

export {
  resolveLearnDifficulty,
  resolvePracticeDifficulty,
  resolveProveDifficulty,
  resolveReinforceDifficulty,
  resolveRetentionDifficulty,
  resolveTransferDifficulty,
} from './difficulty-policy';
export type { DifficultyResolution } from './difficulty-policy';

export { evaluateCanonicalLearningState, rebuildConceptCanonicalState, STAGE_ORDER } from './engine';

export type {
  ActionState,
  ActivityContract,
  CanonicalPedagogicalDecision,
  DifficultyDecision,
  DifficultyReasonCode,
  EvidenceQualificationReasonCode,
  EvidenceQualificationResult,
  NextCanonicalAction,
  PedagogicalActivityType,
  PedagogicalEngineInput,
  PedagogicalStage,
  QualifiedEvidenceSummary,
  RawEvidenceItem,
  RecognitionRejectionReason,
  RecognizedRequirement,
  RecognizedRequirementBasis,
  RequirementResult,
  RequirementStatus,
  RollbackCase,
  RollbackDecision,
  SatisfactionBasis,
  TransferChallengeDepth,
  TransferFailureDiagnostic,
  WaitingReason,
} from './types';
