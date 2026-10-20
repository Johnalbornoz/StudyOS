/**
 * Student Exam Journey V2 -- the ONE serializable shadow record (pure).
 *
 * One record per exam target (or one "no target" record per Student). Every
 * field is an id of the target, a catalogue key, an enum or a small number --
 * never the Student id, a name, an email, an answer or free text. The record
 * is built field by field (nothing is spread in), so a future fact cannot leak
 * through it.
 */
import type { StudentExamJourneyResolution } from './types';
import { INSTITUTIONAL_CONTEXT_RESOLVER_VERSION, type InstitutionalContextSummary } from './institutional-context';

export const JOURNEY_SHADOW_EVENT = 'student_exam_journey_shadow';
export const JOURNEY_SHADOW_LOG_PREFIX = '[journey-shadow]';

export interface JourneyShadowRecord {
  event: typeof JOURNEY_SHADOW_EVENT;
  resolver_version: string;
  policy_version: string;
  as_of: string;
  route: string;
  exam_target_id: string | null;
  objective_key: string | null;
  learner_state: string;
  phase: string;
  state: string;
  blockers: string[];
  recommended_next_action: string;
  readiness_status: string;
  mock_status: string;
  mock_startable: boolean;
  completed_mocks: number;
  prediction_status: string;
  prediction_model_class: string;
  resolution_reasons: string[];
}

export function buildJourneyShadowRecord(resolution: StudentExamJourneyResolution, route: string): JourneyShadowRecord {
  const action = resolution.recommendedNextAction;
  return {
    event: JOURNEY_SHADOW_EVENT,
    resolver_version: resolution.resolverVersion,
    policy_version: resolution.policyVersion,
    as_of: resolution.asOf,
    route: route.slice(0, 80),
    exam_target_id: resolution.examTargetId,
    objective_key: resolution.objectiveKey,
    learner_state: resolution.learner.state,
    phase: resolution.phase,
    state: resolution.state,
    blockers: resolution.blockers.map((b) => `${b.code}:${b.scope}`),
    recommended_next_action: action.mockNumber ? `${action.kind}:${action.mockNumber}` : action.kind,
    readiness_status: resolution.readinessStatus.status,
    mock_status: resolution.mockStatus.status,
    mock_startable: resolution.mockStatus.startable,
    completed_mocks: resolution.mockStatus.completedMocks,
    prediction_status: resolution.predictionStatus.status,
    prediction_model_class: resolution.predictionStatus.modelClass,
    resolution_reasons: [...new Set(resolution.resolutionReasons.map((r) => r.code))],
  };
}

/** One single-line JSON record on stdout (captured by the platform's runtime logs). */
export function emitJourneyShadowRecord(record: JourneyShadowRecord, log: (line: string) => void = console.info): void {
  log(`${JOURNEY_SHADOW_LOG_PREFIX} ${JSON.stringify(record)}`);
}

// ------------------------------------------------------------------ J1.2: institutional context (one per Student)

export const INSTITUTION_CONTEXT_SHADOW_EVENT = 'student_institution_context_shadow';

/** Built field by field from the summary: codes, enums and counts only -- no ids, names or values. */
export interface InstitutionContextShadowRecord {
  event: typeof INSTITUTION_CONTEXT_SHADOW_EVENT;
  resolver_version: string;
  as_of: string;
  route: string;
  institution_context_status: string;
  confidence: string;
  defines_academic_path: boolean;
  missing_links: string[];
  conflicts: string[];
  provenance_summary: Record<string, number>;
}

export function buildInstitutionContextShadowRecord(summary: InstitutionalContextSummary, route: string, asOf: string): InstitutionContextShadowRecord {
  return {
    event: INSTITUTION_CONTEXT_SHADOW_EVENT,
    resolver_version: INSTITUTIONAL_CONTEXT_RESOLVER_VERSION,
    as_of: asOf,
    route: route.slice(0, 80),
    institution_context_status: summary.status,
    confidence: summary.confidence,
    defines_academic_path: summary.definesAcademicPath,
    missing_links: [...new Set(summary.missing.map((m) => `${m.code}:${m.owner}:${m.severity}`))].sort(),
    conflicts: [...new Set(summary.conflicts.map((c) => `${c.field}:${c.kind}`))].sort(),
    provenance_summary: Object.fromEntries(Object.entries(summary.provenanceSummary).sort(([a], [b]) => a.localeCompare(b))) as Record<string, number>,
  };
}

export function emitInstitutionContextShadowRecord(record: InstitutionContextShadowRecord, log: (line: string) => void = console.info): void {
  log(`${JOURNEY_SHADOW_LOG_PREFIX} ${JSON.stringify(record)}`);
}
