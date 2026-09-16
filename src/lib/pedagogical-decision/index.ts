/**
 * CANON-R5 -- Controlled Canonical Engine Integration: public surface.
 *
 * This directory is the ORCHESTRATION layer between the frozen pure
 * engine (`src/lib/pedagogical-engine/`, untouched this phase) and every
 * learner-facing surface/route. It is the ONLY place that decides
 * whether the engine has next-action authority right now (the feature
 * gate) and the ONE place that turns a fresh decision into a launch
 * (session start).
 */
export { isCanonicalEngineV1Enabled } from './feature-gate';

export {
  getCanonicalPedagogicalDecision,
  CanonicalDecisionUnavailableError,
  type CanonicalDecisionResult,
  type CanonicalDecisionAdapterDiagnostics,
  type GetCanonicalPedagogicalDecisionParams,
} from './canonical-decision.service';

export { resolveV1ActivityLaunchReadiness, type V1ActivityLaunchReadiness, type V1ActivityNotReadyReason } from './activity-launch-readiness';

export {
  resolveCanonicalLaunch,
  resolveV1PracticeEligibility,
  resolveAuthorizedItemCount,
  type CanonicalLearningSession,
  type CanonicalLaunchStatus,
  type V1PracticeEligibility,
} from './canonical-session-launch';

export { resolveConceptSubjectForStudent } from './resolve-concept-subject';

export { overrideConceptMissionViewWithCanonicalDecision } from './concept-mission-override';

export {
  verifyV1PracticeLaunchMarker,
  checkV1ActivityContractCompliance,
  V1_ACTIVITY_CONTRACT_VIOLATION,
  type V1PracticeLaunchMarker,
  type V1ContractComplianceResult,
} from './v1-practice-launch-marker';
