/**
 * Phase 1E: canonical derived-metric layer (Step 21).
 * CANONICAL_DERIVED_METRIC_LAYER = 1 -- this is the only module.
 * Read-only by construction: every export below issues SELECT-only
 * queries or is a pure function over already-fetched rows. Nothing
 * here performs INSERT/UPDATE/DELETE (Step 22) or emits a
 * decision_event (Step 27).
 */
export * from './types';
export { computeHelpDependency, readHelpDependency } from './help-dependency';
export {
  computeLearningVelocity,
  readLearningVelocityForConcepts,
  readLearningVelocity,
  aggregateLearningVelocity,
} from './learning-velocity';
export { computeAggregateCalibration, readAggregateCalibration } from './calibration';
export { readPrerequisiteGaps } from './prerequisite-gaps';
export { computeTransferCoverage, readTransferCoverage } from './transfer-coverage';
export { readStudyPlanAdherence, type StudyPlanAdherenceOptions } from './study-plan-adherence';
export { computePersistence, readPersistence } from './persistence';
