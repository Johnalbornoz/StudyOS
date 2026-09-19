/**
 * F12 -- Institution Intelligence: the single central read service
 * (task section 9). UI/route code must import from here, never compose
 * its own raw joins against institutions/classes/learning_evidence/
 * readiness_snapshots/etc. directly.
 */
export { InstitutionIntelligenceAccessDeniedError, requireInstitutionAccess, requireClassInInstitution, requireLearnerInInstitution } from './authorization';
export { getActiveAnalyticsPolicy, applyCohortSuppression, NoActiveAnalyticsPolicyError, type AnalyticsPolicyRules, type AnalyticsPolicyVersion, type SuppressibleAggregate } from './policy.service';
export { getInstitutionOverview, getInstitutionGrades, getInstitutionClasses, getInstitutionTeachers, type InstitutionOverview, type InstitutionGrade, type InstitutionClassSummary, type InstitutionTeacherSummary } from './roster.service';
export { getInstitutionLearnerSummary, getClassLearningSummary, getLearnerDrillDown, type LearningSummary, type LearnerDrillDownSummary, type StateDistribution } from './learning.service';
export { getInstitutionCoverage, type InstitutionCoverageSummary } from './coverage.service';
export { getInstitutionReadiness, type InstitutionReadinessSummary } from './readiness.service';
export { getInstitutionDiagnosticSummary, type DiagnosticSummary, type GapType } from './diagnostics.service';
export { getInstitutionInterventionSummary, getTeacherOperationalSummary, type InstitutionInterventionSummary, type TeacherOperationalSummary, type InterventionType } from './interventions.service';
export { getInstitutionAttentionAreas, type AttentionArea, type AttentionReasonCode } from './attention.service';
export type { AnalyticsScope, AnalyticsScopeType, TimeWindow, MetricEnvelope, PaginationParams, PaginatedResult } from './types';
