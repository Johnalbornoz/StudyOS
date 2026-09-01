/**
 * StudyUs Digital Learning Twin -- canonical Learner Model read
 * architecture (Phase 1C). See docs/architecture/digital-learning-twin.md
 * and docs/audits/STUDYUS_PHASE_1C_CORE_LEARNER_MODEL_IMPLEMENTATION.md.
 *
 * READ ONLY -- this module and everything it imports from never
 * writes to a domain table. Four projections, one shared set of
 * sub-readers, zero new schema, zero new telemetry, zero pedagogical
 * behavior change.
 */
export { getOverview, getSubjectView, getConceptView, getDecisionContext } from './service';
export type {
  StudentId,
  LearnerModel,
  SubjectView,
  ConceptView,
  DecisionContext,
  SubjectSummary,
  ConceptSummary,
  NeedsAttentionItem,
  ProjectionOptions,
  SignalQuality,
  SignalSourceType,
  Capability,
  NotYetAvailable,
  MasterySignal,
  KnowledgeStateSignal,
  RetentionSignal,
  TransferSignal,
  MetacognitionSignal,
  IndependenceSignal,
  MisconceptionSummary,
  EvidenceSummary,
  ErrorPatternSummary,
  StateTransitionEvent,
  LanguageContext,
  AcademicContext,
  SubjectAcademicContext,
  PlanningContext,
  AssessmentPressure,
  PrerequisiteGap,
  DataQualitySummary,
} from './types';
export { notYetAvailable, available } from './types';
