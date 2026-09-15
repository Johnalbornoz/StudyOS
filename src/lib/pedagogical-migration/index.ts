/**
 * CANON-R4 / CANON-R4R1 -- Legacy Compatibility & v1 Evidence Capture:
 * public surface.
 *
 * Read-only by default. The one exception -- `applyRecognitions` -- is
 * itself guarded (Preview-only, transactional, idempotent) and NEVER
 * called from any dry-run path. Nothing here has authority over
 * learner-facing behavior or the frozen pure engine -- see
 * docs/CANON_R4_LEGACY_COMPATIBILITY_AND_V1_EVIDENCE.md and
 * docs/CANON_R4R1_PRE_V1_LEARN_BASELINE.md.
 */
export { V1_POLICY_VERSION, LEGACY_UNVERSIONED } from './types';
export { INITIAL_MIGRATION_VERSION } from './migration-version';
export type {
  EffectiveMigratedState,
  EffectiveRequirementView,
  EvidenceVersionLabel,
  LegacyRecognitionReasonCode,
  MigrationBaseline,
  MigrationCategory,
  MigrationPolicy,
  QualificationBasis,
  RequirementRecognition,
} from './types';

export { classifyEvidenceVersion, isTemporallyEligibleForV1, UNCONFIGURED_MIGRATION_POLICY } from './policy-version';
export { evaluateLegacyRecognition, type LegacyRecognitionInput } from './legacy-recognition';
export { buildPedagogicalMigrationBaseline } from './migration-baseline';
export { composeEffectiveMigratedDecision } from './effective-decision';
export { compareWithAndWithoutMigrationBaseline, type MigrationAwareComparison } from './migration-shadow-comparison';
export type {
  V1EvidenceCapture,
  V1LearnCheckCapture,
  V1PracticeCapture,
  V1ProveCapture,
  V1RetentionCapture,
  V1TransferCapture,
  V1TransferChallengeCapture,
} from './new-evidence-capture-contract';

// CANON-R4R1 additions.
export { isPreexistingLearnerConcept, loadPreexistingLearnerConceptPairs, type PreexistingLearnerConceptPair } from './preexisting-learner-concept';
export { toEngineRecognizedRequirements } from './to-engine-recognized-requirements';
export {
  loadRecognizedRequirementsForEngine,
  applyRecognitions,
  type ApplyRecognitionsResult,
} from './recognition-persistence-adapter';
