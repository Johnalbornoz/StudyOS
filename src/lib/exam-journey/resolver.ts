/**
 * Student Exam Journey V2 -- J2: THE journey resolver (pure, deterministic).
 *
 *   resolveStudentExamJourney(facts) -> { phase, state, blockers,
 *     recommendedNextAction, readinessStatus, mockStatus, predictionStatus,
 *     resolutionReasons }
 *
 * State is derived from facts (design §B.1): nothing here is persisted, no
 * clock is read (`facts.asOf` is the evaluation day), no database is touched.
 * One resolver for every Student: there is no entry-path flag -- institution,
 * independent-exam and longitudinal Students differ only in their facts (P11).
 *
 * The resolver never fabricates availability:
 *   - Blueprint not ready                  -> BLUEPRINT_INCOMPLETE
 *   - Blueprint ready, bank cannot run it  -> CONTENT_UNAVAILABLE (per mode)
 *   - no prediction model (O-02 NO_MODEL)  -> PREDICTION_MODEL_UNAVAILABLE
 *   - model, evidence insufficient         -> PREDICTION_NOT_READY
 * Academic rules (what the exam is, what can run) come from the facts the
 * catalogue / Exam Core computed; the resolver only adds journey pacing from
 * the versioned journey policy (O-01). Low readiness never blocks a mock (O-04).
 */
import { atLeast } from '@/lib/exam-core/catalog/readiness';
import { calendarDaysUntil } from '@/lib/experience/goal';
import { JOURNEY_POLICY_V1, preparationWindowDays, type JourneyPolicy } from './policy';
import {
  STATE_PHASE,
  type ExamInstanceFact,
  type EstimateSource,
  type JourneyBlocker,
  type JourneyState,
  type LearnerFacts,
  type LearnerResolution,
  type MockGuidanceCode,
  type MockStatus,
  type NextActionKind,
  type PredictionStatus,
  type ReadinessStatus,
  type ReasonCode,
  type ResolutionReason,
  type StudentExamJourneyFacts,
  type StudentExamJourneyResolution,
} from './types';

export const JOURNEY_RESOLVER_VERSION = 'student-exam-journey-resolver-v1';

/** O-03: precedence of component estimates (higher wins). */
const ESTIMATE_PRECEDENCE: Record<EstimateSource, number> = { STUDENT_ESTIMATE: 1, TEACHER_ESTIMATE: 2, TEACHER_MARKED: 3, MODERATED: 4 };

const day = (iso: string) => iso.slice(0, 10);
const share = (part: number, whole: number) => (whole > 0 ? part / whole : null);

// ------------------------------------------------------------------ learner layer

export function resolveLearner(learner: LearnerFacts): { learner: LearnerResolution; reasons: ResolutionReason[] } {
  const institutionProgrammes = learner.institution.classProgrammes.filter((c) => c.programmeId);
  if (learner.institution.activeEnrollments > 0 && institutionProgrammes.length > 0) {
    // P1: the institution already told us -- the Student is never asked again.
    return {
      learner: { state: 'ACADEMIC_PATH_DEFINED', contextSource: 'INSTITUTION', requiresAcademicInput: false },
      reasons: [{ code: 'ACADEMIC_CONTEXT_FROM_INSTITUTION', detail: { classes: learner.institution.activeEnrollments, programmes: new Set(institutionProgrammes.map((c) => c.programmeId)).size } }],
    };
  }
  if (learner.academicProfile?.complete) {
    return { learner: { state: 'ACADEMIC_PATH_DEFINED', contextSource: 'STUDENT', requiresAcademicInput: false }, reasons: [{ code: 'ACADEMIC_CONTEXT_FROM_STUDENT' }] };
  }
  if (learner.examTargetCount > 0) {
    // Path B: the exam target is the first academic object; no school curriculum is required.
    return { learner: { state: 'EXAM_ONLY_PROFILE', contextSource: null, requiresAcademicInput: false }, reasons: [{ code: 'EXAM_TARGET_IS_FIRST_ACADEMIC_OBJECT' }] };
  }
  return { learner: { state: 'NO_ACADEMIC_PROFILE', contextSource: null, requiresAcademicInput: true }, reasons: [{ code: 'NO_ACADEMIC_CONTEXT' }] };
}

// ------------------------------------------------------------------ helpers over facts

/** Numbered mocks: MOCK mode, completed, SCORED, at or above the minimum fidelity, oldest first. CHALLENGE never counts. */
export function scoredMocks(instances: ExamInstanceFact[], policy: JourneyPolicy = JOURNEY_POLICY_V1): ExamInstanceFact[] {
  const fidelityOk = (f: ExamInstanceFact['fidelity']) => (policy.minimumMockFidelity === 'FULL' ? f === 'FULL' : f === 'FULL' || f === 'REDUCED');
  return instances
    .filter((i) => i.mode === 'MOCK' && i.status === 'COMPLETED' && i.result === 'SCORED' && i.completedAt && fidelityOk(i.fidelity))
    .sort((a, b) => a.completedAt!.localeCompare(b.completedAt!) || a.instanceRef.localeCompare(b.instanceRef));
}

function readinessStatus(facts: StudentExamJourneyFacts, reasons: ResolutionReason[]): ReadinessStatus {
  const l = facts.learning;
  if (!l) {
    reasons.push({ code: 'LEARNING_EVIDENCE_UNAVAILABLE' });
    return { status: 'NOT_AVAILABLE', mappedRequirements: 0, evidenceCoverage: null, readyShare: null };
  }
  if (l.mappedRequirements === 0) {
    reasons.push({ code: 'NO_MAPPED_REQUIREMENTS' });
    return { status: 'NOT_AVAILABLE', mappedRequirements: 0, evidenceCoverage: null, readyShare: null };
  }
  const evidenceCoverage = share(l.mappedWithEvidence, l.mappedRequirements);
  return {
    status: l.mappedWithEvidence === 0 ? 'INSUFFICIENT_EVIDENCE' : 'AVAILABLE',
    mappedRequirements: l.mappedRequirements,
    evidenceCoverage,
    readyShare: l.weightedReadyShare,
  };
}

function predictionStatus(facts: StudentExamJourneyFacts, mocks: ExamInstanceFact[], institutionLinked: boolean, reasons: ResolutionReason[]): PredictionStatus {
  const p = facts.prediction;
  const base = { modelClass: p.modelClass, basisMocks: mocks.length, missingComponentIds: [] as string[], official: false as const };
  if (p.modelClass === 'NO_MODEL') {
    reasons.push({ code: 'NO_PREDICTION_MODEL' });
    return { ...base, status: 'PREDICTION_MODEL_UNAVAILABLE' };
  }
  reasons.push({ code: p.modelClass === 'OFFICIAL_OR_KNOWN_MODEL' ? 'PREDICTION_MODEL_OFFICIAL_OR_KNOWN' : 'PREDICTION_MODEL_HISTORICAL_ESTIMATE' });
  if (mocks.length === 0) {
    reasons.push({ code: 'NO_SCORED_MOCK' });
    return { ...base, status: 'PREDICTION_NOT_READY' };
  }
  const simulated = p.components.filter((c) => c.simulated).map((c) => c.componentId);
  const coveredByOneMock = simulated.length === 0 || mocks.some((m) => simulated.every((id) => m.coveredComponentIds.includes(id)));
  if (!coveredByOneMock) {
    reasons.push({ code: 'MOCK_COMPONENT_COVERAGE_INCOMPLETE', detail: { simulatedComponents: simulated.length } });
    return { ...base, status: 'PREDICTION_NOT_READY' };
  }
  // O-03: the highest-precedence estimate counts. An institution-linked Student's own
  // estimate is a what-if scenario only: it never completes the projection.
  const nonSimulated = p.components.filter((c) => !c.simulated).map((c) => c.componentId);
  const missing: string[] = [];
  for (const componentId of nonSimulated) {
    const best = p.estimates.filter((e) => e.componentId === componentId).sort((a, b) => ESTIMATE_PRECEDENCE[b.source] - ESTIMATE_PRECEDENCE[a.source])[0];
    if (!best) missing.push(componentId);
    else if (best.source === 'STUDENT_ESTIMATE' && institutionLinked) {
      missing.push(componentId);
      reasons.push({ code: 'STUDENT_ESTIMATE_SCENARIO_ONLY', detail: { componentId } });
    }
  }
  const out = { ...base, missingComponentIds: missing };
  if (mocks.length === 1) return { ...out, status: 'EARLY_AVAILABLE' };
  if (missing.length > 0) return { ...out, status: 'COMPONENTS_REQUIRED' };
  return { ...out, status: nonSimulated.length > 0 ? 'FULL_AVAILABLE' : 'UPDATED_AVAILABLE' };
}

// ------------------------------------------------------------------ the resolver

export function resolveStudentExamJourney(facts: StudentExamJourneyFacts, policy: JourneyPolicy = JOURNEY_POLICY_V1): StudentExamJourneyResolution {
  const reasons: ResolutionReason[] = [];
  const blockers: JourneyBlocker[] = [];
  const { learner, reasons: learnerReasons } = resolveLearner(facts.learner);
  reasons.push(...learnerReasons);

  const out = (state: JourneyState, action: { kind: NextActionKind; mockNumber?: number; reasonCode: ReasonCode }, statuses: Pick<StudentExamJourneyResolution, 'readinessStatus' | 'mockStatus' | 'predictionStatus'>): StudentExamJourneyResolution => ({
    resolverVersion: JOURNEY_RESOLVER_VERSION,
    policyVersion: policy.version,
    asOf: facts.asOf,
    examTargetId: facts.target?.examTargetId ?? null,
    objectiveKey: facts.target?.objectiveKey ?? null,
    learner,
    phase: STATE_PHASE[state],
    state,
    blockers,
    recommendedNextAction: action,
    ...statuses,
    resolutionReasons: reasons,
  });

  const target = facts.target;
  const notApplicable = {
    readinessStatus: { status: 'NOT_AVAILABLE', mappedRequirements: 0, evidenceCoverage: null, readyShare: null } as ReadinessStatus,
    mockStatus: { status: 'NOT_APPLICABLE', startable: false, fidelity: null, completedMocks: 0, nextMockNumber: null, guidance: [] } as MockStatus,
    predictionStatus: { status: 'NOT_APPLICABLE', modelClass: facts.prediction.modelClass, basisMocks: 0, missingComponentIds: [], official: false } as PredictionStatus,
  };
  // ---------------------------------------------------------------- NONE: no target -> learning, never forced into Exam Prep
  if (!target || target.status === 'ARCHIVED') {
    reasons.push({ code: target ? 'TARGET_ARCHIVED' : 'NO_EXAM_TARGET' });
    return out('NO_EXAM_TARGET', { kind: 'CONTINUE_LEARNING', reasonCode: target ? 'TARGET_ARCHIVED' : 'NO_EXAM_TARGET' }, notApplicable);
  }

  // ---------------------------------------------------------------- facts -> derived facts
  const bp = facts.blueprint;
  const ct = facts.content;
  const instances = facts.exam.instances.filter((i) => i.status !== 'DELETED' && i.status !== 'ARCHIVED');
  const mocks = scoredMocks(instances, policy);
  const lastMock = mocks[mocks.length - 1] ?? null;
  const diagnosticDone = instances.some((i) => i.purpose === 'DIAGNOSTIC' && i.status === 'COMPLETED');
  const engaged = instances.some((i) => i.status === 'IN_PROGRESS' || i.status === 'COMPLETED');
  const daysToExam = target.examDate ? calendarDaysUntil(day(target.examDate), facts.asOf) : null;
  const institutionLinked = target.source === 'INSTITUTION' || target.source === 'INSTITUTION_ASSIGNMENT' || target.confirmation === 'ASSIGNED';

  if (target.confirmation === 'ASSIGNED') reasons.push({ code: 'TARGET_ASSIGNED_BY_INSTITUTION' });
  if (target.examTargetId === null) reasons.push({ code: 'TARGET_NOT_YET_A_PREPARATION' });
  if (target.previousResult) reasons.push({ code: 'PREVIOUS_RESULT_RECORDED', detail: { scale: target.previousResult.scale } });

  // ---------------------------------------------------------------- blockers (impossibility only)
  const unconfirmed = target.confirmation === 'SUGGESTED' || target.confirmation === 'NOT_CONFIRMED';
  if (unconfirmed) {
    blockers.push({ code: 'TARGET_EXAM_UNCONFIRMED', scope: 'TARGET' });
    reasons.push({ code: 'TARGET_UNCONFIRMED' });
  }
  if (daysToExam === null) {
    blockers.push({ code: 'EXAM_DATE_UNKNOWN', scope: 'TARGET' });
    reasons.push({ code: 'EXAM_DATE_UNKNOWN' });
  }
  const programmePlan = !!bp?.programmePlan;
  // Programme containers (AICE Diploma) carry no exam version of their own: their subjects do.
  const blueprintIncomplete = !bp || !atLeast(bp.readiness, 'STRUCTURE_READY') || !bp.structureVisible || (!bp.publishedVersion && !programmePlan);
  if (blueprintIncomplete) {
    blockers.push({ code: 'BLUEPRINT_INCOMPLETE', scope: 'STRUCTURE', detail: { readiness: bp?.readiness ?? null, publishedVersion: bp?.publishedVersion ?? false } });
    reasons.push({ code: 'BLUEPRINT_NOT_CONFIGURED' });
  }
  const versionInvalid = bp?.versionValidity === 'INVALID';
  if (versionInvalid) blockers.push({ code: 'BLUEPRINT_VERSION_INVALID', scope: 'TARGET' });
  if (bp?.versionValidity === 'UNVERIFIED') reasons.push({ code: 'BLUEPRINT_VERSION_UNVERIFIED' });
  if (programmePlan) reasons.push({ code: 'PROGRAMME_PLANNED_BY_SUBJECT' });

  const reasonFor = (capability: string) => ct?.unavailable.find((u) => u.capability === capability)?.reason ?? null;
  // Content gaps are reported only when the Blueprint itself is ready (otherwise the cause is the Blueprint).
  const canPractice = !blueprintIncomplete && !versionInvalid && !programmePlan && !!ct?.practice;
  const canDiagnose = !blueprintIncomplete && !versionInvalid && !programmePlan && !!ct?.diagnostic;
  const mockFormExists = !!ct && (ct.fullMock || ct.reducedMock);
  if (!blueprintIncomplete && !programmePlan && !ct) {
    // Unknown content is unavailable content: nothing is offered as runnable on missing facts.
    for (const scope of ['PRACTICE', 'DIAGNOSTIC', 'MOCK'] as const) blockers.push({ code: 'CONTENT_UNAVAILABLE', scope, detail: { reason: 'CONTENT_FACTS_UNAVAILABLE' } });
  }
  if (!blueprintIncomplete && !programmePlan && ct) {
    if (!ct.practice) blockers.push({ code: 'CONTENT_UNAVAILABLE', scope: 'PRACTICE', detail: { reason: reasonFor('PRACTICE') } });
    if (!ct.diagnostic) blockers.push({ code: 'CONTENT_UNAVAILABLE', scope: 'DIAGNOSTIC', detail: { reason: reasonFor('DIAGNOSTIC') } });
    if (!mockFormExists) blockers.push({ code: 'CONTENT_UNAVAILABLE', scope: 'MOCK', detail: { reason: reasonFor('REDUCED_MOCK') } });
    const contentReason = reasonFor('PRACTICE');
    if (contentReason === 'STRUCTURE_ONLY') reasons.push({ code: 'CONTENT_STRUCTURE_ONLY' });
    if (contentReason === 'BANK_IN_PROGRESS') reasons.push({ code: 'CONTENT_BANK_IN_PROGRESS' });
    if (!ct.learningBridge) blockers.push({ code: 'NO_CONCEPT_MAPPINGS', scope: 'LEARNING_BRIDGE' });
  }
  const releasePending = bp?.institutionalRelease === 'PENDING';
  if (releasePending) blockers.push({ code: 'INSTITUTIONAL_RELEASE_REQUIRED', scope: 'MOCK' });
  if (facts.exam.openAttempt) {
    blockers.push({ code: 'ATTEMPT_IN_PROGRESS', scope: 'MOCK' });
    reasons.push({ code: 'OPEN_ATTEMPT' });
  }

  // ---------------------------------------------------------------- statuses
  const readiness = readinessStatus(facts, reasons);
  const prediction = predictionStatus(facts, mocks, institutionLinked, reasons);

  const mockExecutable = !blueprintIncomplete && !versionInvalid && !programmePlan && !releasePending && mockFormExists;
  const fidelity: MockStatus['fidelity'] = ct?.fullMock ? 'FULL' : ct?.reducedMock ? 'REDUCED' : null;
  if (mockExecutable && fidelity === 'REDUCED') reasons.push({ code: 'MOCK_REDUCED_FORM_ONLY', detail: { lengthCoveragePercent: ct?.reducedMockLengthCoveragePercent ?? null } });

  // Mock guidance (O-04: recommendation, not lock).
  const guidance: MockGuidanceCode[] = [];
  const evidenceCoverage = readiness.evidenceCoverage ?? 0;
  const priorEvidenceSufficient = evidenceCoverage >= 1 - policy.diagnosticUnknownShare;
  if (mocks.length === 0) {
    if (!diagnosticDone && !priorEvidenceSufficient) guidance.push('DIAGNOSTIC_OR_EVIDENCE_PENDING');
    const timeOverride = daysToExam !== null && daysToExam <= policy.mockTimeOverrideDays;
    if (!timeOverride && (readiness.readyShare ?? 0) < policy.mockMinReadyShare) guidance.push('READINESS_BELOW_GUIDANCE');
    if (timeOverride) reasons.push({ code: 'MOCK_TIME_OVERRIDE', detail: { daysToExam } });
  } else {
    const daysSinceLast = calendarDaysUntil(facts.asOf, day(lastMock!.completedAt!));
    const activitySince = hadActivitySince(facts, instances, lastMock!);
    const timeOverride = daysToExam !== null && daysToExam <= policy.nextMockTimeOverrideDays;
    if (!timeOverride && daysSinceLast < policy.nextMockMinDaysSinceLast) guidance.push('TOO_SOON_AFTER_LAST_MOCK');
    if (!timeOverride && !activitySince) guidance.push('NO_ACTIVITY_SINCE_LAST_MOCK');
    if (timeOverride) reasons.push({ code: 'MOCK_TIME_OVERRIDE', detail: { daysToExam } });
  }
  if (daysToExam !== null && daysToExam < policy.lastMockMinDaysBeforeExam) guidance.push('EXAM_TOO_CLOSE');
  const mockInProgress = instances.some((i) => i.mode === 'MOCK' && i.status === 'IN_PROGRESS');
  const mockStatus: MockStatus = {
    status: programmePlan ? 'NOT_APPLICABLE' : !mockExecutable ? 'UNAVAILABLE' : mockInProgress ? 'IN_PROGRESS' : guidance.length === 0 ? 'RECOMMENDED' : 'AVAILABLE_NOT_RECOMMENDED',
    startable: mockExecutable && !facts.exam.openAttempt,
    fidelity: mockExecutable ? fidelity : null,
    completedMocks: mocks.length,
    nextMockNumber: mockExecutable ? mocks.length + 1 : null,
    guidance: mockExecutable ? guidance : [],
  };
  if (mockExecutable) reasons.push({ code: guidance.length === 0 ? 'MOCK_GUIDANCE_MET' : 'MOCK_GUIDANCE_NOT_MET', detail: { guidance: guidance.join(',') || null } });
  const statuses = { readinessStatus: readiness, mockStatus, predictionStatus: prediction };

  // Prediction blockers only once mocks are part of the journey (otherwise every early target would carry them).
  if (mocks.length > 0) {
    if (prediction.status === 'PREDICTION_MODEL_UNAVAILABLE') blockers.push({ code: 'PREDICTION_MODEL_UNAVAILABLE', scope: 'PREDICTION' });
    if (prediction.status === 'PREDICTION_NOT_READY') blockers.push({ code: 'PREDICTION_NOT_READY', scope: 'PREDICTION' });
    if (prediction.missingComponentIds.length > 0) blockers.push({ code: 'REQUIRED_COMPONENT_MISSING', scope: 'PREDICTION', detail: { components: prediction.missingComponentIds.length } });
  }

  const resume = facts.exam.openAttempt ? ({ kind: 'RESUME_ATTEMPT', reasonCode: 'OPEN_ATTEMPT' } as const) : null;

  // ---------------------------------------------------------------- CLOSING / unconfirmed (date-driven, highest precedence)
  if (target.actualResult) {
    reasons.push({ code: 'ACTUAL_RESULT_RECORDED', detail: { source: target.actualResult.source } });
    return out('RESULT_RECORDED', { kind: 'REVIEW_RESULT', reasonCode: 'ACTUAL_RESULT_RECORDED' }, statuses);
  }
  if (unconfirmed) return out('FUTURE_EXAM_IDENTIFIED', { kind: 'CONFIRM_TARGET', reasonCode: 'TARGET_UNCONFIRMED' }, statuses);
  if ((daysToExam !== null && daysToExam < 0) || target.status === 'COMPLETED') {
    reasons.push({ code: 'EXAM_DATE_PASSED' });
    const sat = target.satConfirmed || target.status === 'COMPLETED';
    if (!sat) reasons.push({ code: 'EXAM_SAT_NOT_CONFIRMED' });
    return out('EXAM_COMPLETED', sat ? { kind: 'RECORD_RESULT', reasonCode: 'EXAM_DATE_PASSED' } : { kind: 'CONFIRM_EXAM_SAT', reasonCode: 'EXAM_SAT_NOT_CONFIRMED' }, statuses);
  }
  if (daysToExam !== null && daysToExam <= policy.readyWindowDays) {
    reasons.push({ code: 'READY_WINDOW', detail: { daysToExam } });
    return out('EXAM_READY', resume ?? { kind: 'EXAM_DAY_LOGISTICS', reasonCode: 'READY_WINDOW' }, statuses);
  }
  if (daysToExam !== null && daysToExam <= policy.finalWindowDays) {
    reasons.push({ code: 'FINAL_WINDOW', detail: { daysToExam } });
    return out('FINAL_PREPARATION', resume ?? { kind: 'FINAL_REVIEW', reasonCode: 'FINAL_WINDOW' }, statuses);
  }

  // ---------------------------------------------------------------- HORIZON: window (O-01) / Blueprint not ready
  const windowDays = preparationWindowDays(policy, readiness.readyShare);
  const openByDate = daysToExam !== null && daysToExam <= windowDays;
  const windowOpen = openByDate || engaged || target.optedInEarly;
  if (openByDate) reasons.push({ code: 'WINDOW_OPEN_BY_DATE', detail: { daysToExam, windowDays } });
  else if (engaged) reasons.push({ code: 'WINDOW_OPEN_BY_ENGAGEMENT' });
  else if (target.optedInEarly) reasons.push({ code: 'WINDOW_OPEN_BY_OPT_IN' });
  else reasons.push({ code: 'WINDOW_NOT_OPEN', detail: { daysToExam, windowDays } });

  if (!windowOpen || blueprintIncomplete || versionInvalid) {
    const last = facts.learning?.lastMappedLearningEvidenceAt ?? null;
    const recent = last !== null && calendarDaysUntil(facts.asOf, day(last)) <= policy.foundationRecencyDays;
    reasons.push({ code: recent ? 'RECENT_LEARNING_ON_TARGET_CONCEPTS' : 'NO_RECENT_LEARNING_ON_TARGET_CONCEPTS' });
    const state: JourneyState = recent ? 'FOUNDATION_BUILDING' : 'EXAM_PREPARATION_NOT_DUE';
    if (resume) return out(state, resume, statuses);
    if (daysToExam === null) return out(state, { kind: 'SET_EXAM_DATE', reasonCode: 'EXAM_DATE_UNKNOWN' }, statuses);
    if (blueprintIncomplete && !ct?.learningBridge && facts.learner.subjectCount === 0) return out(state, { kind: 'NOTIFY_WHEN_AVAILABLE', reasonCode: 'BLUEPRINT_NOT_CONFIGURED' }, statuses);
    return out(state, { kind: 'CONTINUE_LEARNING', reasonCode: blueprintIncomplete ? 'BLUEPRINT_NOT_CONFIGURED' : 'WINDOW_NOT_OPEN' }, statuses);
  }

  // ---------------------------------------------------------------- ACTIVATION
  if (programmePlan) return out('EXAM_READINESS_AVAILABLE', resume ?? { kind: 'PLAN_PROGRAMME', reasonCode: 'PROGRAMME_PLANNED_BY_SUBJECT' }, statuses);

  if (mocks.length === 0) {
    if (!canPractice && !canDiagnose) {
      // Structure only / bank in preparation: activation without inventing activities.
      const kind: NextActionKind = ct?.learningBridge ? 'CONTINUE_LEARNING' : bp?.structureVisible ? 'REVIEW_STRUCTURE' : 'NOTIFY_WHEN_AVAILABLE';
      return out('EXAM_READINESS_AVAILABLE', resume ?? { kind, reasonCode: reasonFor('PRACTICE') === 'BANK_IN_PROGRESS' ? 'CONTENT_BANK_IN_PROGRESS' : 'CONTENT_STRUCTURE_ONLY' }, statuses);
    }
    if (diagnosticDone) reasons.push({ code: 'DIAGNOSTIC_COMPLETED' });
    if (!diagnosticDone && priorEvidenceSufficient) reasons.push({ code: 'PRIOR_EVIDENCE_SUFFICIENT', detail: { evidenceCoverage } });
    if (canDiagnose && !diagnosticDone && !priorEvidenceSufficient) {
      reasons.push({ code: 'EVIDENCE_BELOW_DIAGNOSTIC_THRESHOLD', detail: { evidenceCoverage } });
      return out('DIAGNOSTIC_DUE', resume ?? { kind: 'START_DIAGNOSTIC', reasonCode: 'EVIDENCE_BELOW_DIAGNOSTIC_THRESHOLD' }, statuses);
    }
    // ---------------------------------------------------------------- PREPARATION (+ Mock 1 when recommended)
    if (mockStatus.status === 'RECOMMENDED') return out('MOCK_AVAILABLE', resume ?? { kind: 'TAKE_MOCK', mockNumber: 1, reasonCode: 'MOCK_GUIDANCE_MET' }, statuses);
    const completedPractice = instances.filter((i) => i.mode === 'PRACTICE' && i.purpose === null && i.status === 'COMPLETED');
    const paperTraining = completedPractice.some((i) => i.componentScoped && i.timingMode !== 'UNTIMED');
    if (paperTraining) {
      reasons.push({ code: 'PAPER_TRAINING_COMPLETED' });
      return out('PAPER_TRAINING', resume ?? { kind: 'PAPER_TRAINING', reasonCode: 'PAPER_TRAINING_COMPLETED' }, statuses);
    }
    const state: JourneyState = completedPractice.length > 0 ? 'PRACTICE_ACTIVE' : 'PREPARATION_ACTIVE';
    if (completedPractice.length > 0) reasons.push({ code: 'PRACTICE_COMPLETED', detail: { count: completedPractice.length } });
    const top = facts.learning?.topRecommendation ?? null;
    if (top && top.band === 'HIGH' && (top.action === 'CONTINUE_CONCEPT' || top.action === 'ADD_TO_PLAN')) {
      reasons.push({ code: 'HIGH_PRIORITY_GAP' });
      return out(state, resume ?? { kind: 'REINFORCE_CONCEPT', reasonCode: 'HIGH_PRIORITY_GAP' }, statuses);
    }
    return out(state, resume ?? (canPractice ? { kind: 'PRACTICE', reasonCode: diagnosticDone ? 'DIAGNOSTIC_COMPLETED' : 'PRIOR_EVIDENCE_SUFFICIENT' } : { kind: 'CONTINUE_LEARNING', reasonCode: 'CONTENT_STRUCTURE_ONLY' }), statuses);
  }

  // ---------------------------------------------------------------- SIMULATION / PROJECTION (n >= 1 scored mocks)
  reasons.push({ code: 'MOCK_COMPLETED', detail: { completedMocks: mocks.length } });
  const activitySince = hadActivitySince(facts, instances, lastMock!);
  if (activitySince) reasons.push({ code: 'ACTIVITY_SINCE_LAST_MOCK' });
  if (mocks.length === 1 && mockStatus.status === 'RECOMMENDED') {
    reasons.push({ code: 'NEXT_MOCK_GUIDANCE_MET' });
    return out('MOCK_2_AVAILABLE', resume ?? { kind: 'TAKE_MOCK', mockNumber: 2, reasonCode: 'NEXT_MOCK_GUIDANCE_MET' }, statuses);
  }
  if (mocks.length === 1) {
    if (activitySince) return out('REINFORCEMENT_ACTIVE', resume ?? { kind: 'REINFORCE_GAPS', reasonCode: 'ACTIVITY_SINCE_LAST_MOCK' }, statuses);
    if (prediction.status === 'EARLY_AVAILABLE') return out('EARLY_PREDICTION_AVAILABLE', resume ?? { kind: 'REVIEW_PROJECTION', reasonCode: 'MOCK_COMPLETED' }, statuses);
    return out('MOCK_1_COMPLETED', resume ?? { kind: 'REVIEW_MOCK_RESULT', reasonCode: 'MOCK_COMPLETED' }, statuses);
  }
  // n >= 2
  const nextMock = mockStatus.status === 'RECOMMENDED' ? ({ kind: 'TAKE_MOCK', mockNumber: mocks.length + 1, reasonCode: 'NEXT_MOCK_GUIDANCE_MET' } as const) : null;
  if (prediction.status === 'COMPONENTS_REQUIRED') {
    if (!institutionLinked) return out('ADDITIONAL_COMPONENTS_REQUIRED', resume ?? { kind: 'ENTER_COMPONENT_ESTIMATE', reasonCode: 'MOCK_COMPLETED' }, statuses);
    reasons.push({ code: 'TEACHER_COMPONENT_INPUT_PENDING' });
    return out('ADDITIONAL_COMPONENTS_REQUIRED', resume ?? nextMock ?? { kind: 'REINFORCE_GAPS', reasonCode: 'TEACHER_COMPONENT_INPUT_PENDING' }, statuses);
  }
  if (prediction.status === 'FULL_AVAILABLE') return out('FULL_PREDICTION_AVAILABLE', resume ?? nextMock ?? { kind: 'REINFORCE_GAPS', reasonCode: 'MOCK_COMPLETED' }, statuses);
  if (prediction.status === 'UPDATED_AVAILABLE') {
    if (!activitySince) return out('UPDATED_PREDICTION_AVAILABLE', resume ?? { kind: 'REVIEW_PROJECTION', reasonCode: 'MOCK_COMPLETED' }, statuses);
    return out('REINFORCEMENT_ACTIVE', resume ?? nextMock ?? { kind: 'REINFORCE_GAPS', reasonCode: 'ACTIVITY_SINCE_LAST_MOCK' }, statuses);
  }
  if (activitySince) return out('REINFORCEMENT_ACTIVE', resume ?? nextMock ?? { kind: 'REINFORCE_GAPS', reasonCode: 'ACTIVITY_SINCE_LAST_MOCK' }, statuses);
  return out('MOCK_2_COMPLETED', resume ?? { kind: 'REVIEW_MOCK_RESULT', reasonCode: 'MOCK_COMPLETED' }, statuses);
}

/** Preparation activity after the last mock: a completed non-mock instance, or learning on the target's concepts. */
function hadActivitySince(facts: StudentExamJourneyFacts, instances: ExamInstanceFact[], lastMock: ExamInstanceFact): boolean {
  const since = lastMock.completedAt!;
  if (instances.some((i) => i.mode !== 'MOCK' && i.status === 'COMPLETED' && i.completedAt !== null && i.completedAt > since)) return true;
  const learning = facts.learning?.lastMappedLearningEvidenceAt ?? null;
  return learning !== null && learning > since;
}
