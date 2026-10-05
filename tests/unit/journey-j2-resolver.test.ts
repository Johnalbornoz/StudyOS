/**
 * Student Exam Journey V2 -- J2 resolver: the 10 required cases, the full
 * mock / projection / closing sequence, and the invariants the design requires
 * (never fabricate availability, blockers orthogonal to states, O-02/O-03/O-04,
 * one engine, determinism, no clock).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveStudentExamJourney, scoredMocks } from '@/lib/exam-journey/resolver';
import { JOURNEY_POLICY_V1, preparationWindowDays } from '@/lib/exam-journey/policy';
import { JOURNEY_PHASES, LEARNER_STATES, PHASE_STATES, STATE_PHASE } from '@/lib/exam-journey/types';
import type {
  BlueprintReadinessFacts,
  ContentReadinessFacts,
  ExamInstanceFact,
  ExamTargetFacts,
  LearnerFacts,
  LearningEvidenceFacts,
  StudentExamJourneyFacts,
  StudentExamJourneyResolution,
} from '@/lib/exam-journey/types';
import { decideStudentOnboardingGate } from '@/lib/student/onboarding-gate';

const ROOT = join(__dirname, '..', '..');
const AS_OF = '2026-10-05';

// ------------------------------------------------------------------ fixture builders
const independent = (over: Partial<LearnerFacts> = {}): LearnerFacts => ({
  academicProfile: null,
  institution: { activeEnrollments: 0, classProgrammes: [], assignedObjectiveKeys: [] },
  subjectCount: 0,
  examTargetCount: 1,
  ...over,
});
const institutionStudent = (over: Partial<LearnerFacts> = {}): LearnerFacts =>
  independent({
    institution: { activeEnrollments: 2, classProgrammes: [{ classId: 'class-math', programmeId: 'prog-ib', academicSubjectId: 'subj-math-aa-hl' }, { classId: 'class-phys', programmeId: 'prog-ib', academicSubjectId: null }], assignedObjectiveKeys: [] },
    subjectCount: 2,
    ...over,
  });
const target = (over: Partial<ExamTargetFacts> = {}): ExamTargetFacts => ({
  examTargetId: 'target-1',
  objectiveKey: 'objective.under.test',
  framework: 'ANY',
  objectiveKind: 'EXAM',
  examDefinitionId: 'def-1',
  level: null,
  examDate: '2026-12-05',
  sessionCode: null,
  status: 'ACTIVE',
  source: 'STUDENT',
  confirmation: 'CONFIRMED',
  satConfirmed: false,
  optedInEarly: false,
  previousResult: null,
  actualResult: null,
  ...over,
});
const BLUEPRINT_READY: BlueprintReadinessFacts = { readiness: 'REDUCED_MOCK_READY', structureVisible: true, publishedVersion: true, versionValidity: 'UNVERIFIED', programmePlan: false, institutionalRelease: 'NOT_APPLICABLE' };
const CONTENT_READY: ContentReadinessFacts = { practice: true, diagnostic: true, reducedMock: true, fullMock: false, learningBridge: true, unavailable: [{ capability: 'FULL_MOCK', reason: 'REDUCED_ONLY' }], reducedMockLengthCoveragePercent: 40 };
const learning = (over: Partial<LearningEvidenceFacts> = {}): LearningEvidenceFacts => ({
  mappedRequirements: 10,
  mappedWithEvidence: 0,
  counts: { ALREADY_STRONG: 0, NEEDS_CONFIRMATION: 0, NEEDS_REINFORCEMENT: 0, NO_EVIDENCE: 10, NOT_YET_MAPPED: 0 },
  weightedReadyShare: 0,
  topRecommendation: null,
  lastMappedLearningEvidenceAt: null,
  ...over,
});
let seq = 0;
const instance = (over: Partial<ExamInstanceFact> = {}): ExamInstanceFact => ({
  instanceRef: `inst-${++seq}`,
  mode: 'PRACTICE',
  purpose: null,
  status: 'COMPLETED',
  timingMode: 'UNTIMED',
  componentScoped: false,
  fidelity: null,
  completedAt: '2026-09-20T10:00:00.000Z',
  result: 'SCORED',
  coveredComponentIds: ['p1', 'p2'],
  ...over,
});
const diagnostic = (at = '2026-09-10T10:00:00.000Z') => instance({ purpose: 'DIAGNOSTIC', completedAt: at });
const mock = (at: string, over: Partial<ExamInstanceFact> = {}) => instance({ mode: 'MOCK', timingMode: 'OFFICIAL_SIMULATION_TIMED', fidelity: 'REDUCED', completedAt: at, ...over });
const facts = (over: Partial<StudentExamJourneyFacts> = {}): StudentExamJourneyFacts => ({
  asOf: AS_OF,
  learner: independent(),
  target: target(),
  blueprint: BLUEPRINT_READY,
  content: CONTENT_READY,
  learning: learning(),
  exam: { instances: [], openAttempt: false },
  prediction: { modelClass: 'NO_MODEL', components: [], estimates: [] },
  ...over,
});
const resolve = (f: StudentExamJourneyFacts) => resolveStudentExamJourney(f);
const codes = (r: StudentExamJourneyResolution) => r.blockers.map((b) => `${b.code}:${b.scope}`);
const reasons = (r: StudentExamJourneyResolution) => r.resolutionReasons.map((x) => x.code);
const MODEL_COMPONENTS = [{ componentId: 'p1', simulated: true }, { componentId: 'p2', simulated: true }, { componentId: 'ia', simulated: false }];

// ------------------------------------------------------------------ taxonomy
describe('taxonomy: the 7 design phases, every design state mapped once', () => {
  it('7 phases; 22 target states + 3 learner states, each mapped to exactly one phase', () => {
    expect(JOURNEY_PHASES).toEqual(['NONE', 'HORIZON', 'ACTIVATION', 'PREPARATION', 'SIMULATION', 'PROJECTION', 'CLOSING']);
    const targetStates = Object.values(PHASE_STATES).flat();
    expect(new Set(targetStates).size).toBe(22);
    expect(Object.keys(STATE_PHASE).length).toBe(25);
    // the brief's 24 states are all present
    for (const s of ['NO_ACADEMIC_PROFILE', 'ACADEMIC_PATH_DEFINED', 'NO_EXAM_TARGET', 'FUTURE_EXAM_IDENTIFIED', 'EXAM_PREPARATION_NOT_DUE', 'FOUNDATION_BUILDING', 'EXAM_READINESS_AVAILABLE', 'DIAGNOSTIC_DUE', 'PREPARATION_ACTIVE', 'PRACTICE_ACTIVE', 'PAPER_TRAINING', 'MOCK_AVAILABLE', 'MOCK_1_COMPLETED', 'EARLY_PREDICTION_AVAILABLE', 'REINFORCEMENT_ACTIVE', 'MOCK_2_AVAILABLE', 'MOCK_2_COMPLETED', 'UPDATED_PREDICTION_AVAILABLE', 'ADDITIONAL_COMPONENTS_REQUIRED', 'FULL_PREDICTION_AVAILABLE', 'FINAL_PREPARATION', 'EXAM_READY', 'EXAM_COMPLETED', 'RESULT_RECORDED']) {
      expect(STATE_PHASE).toHaveProperty(s);
    }
    for (const s of LEARNER_STATES) expect(STATE_PHASE[s]).toBe('NONE');
  });
});

// ------------------------------------------------------------------ the 10 required cases
describe('Case 1 -- institution Student, curriculum assigned, no exam preparation yet', () => {
  it('academic context is recognised from the institution, without asking the Student again', () => {
    const r = resolve(facts({ learner: institutionStudent({ examTargetCount: 0 }), target: null, blueprint: null, content: null, learning: null }));
    expect(r.learner).toEqual({ state: 'ACADEMIC_PATH_DEFINED', contextSource: 'INSTITUTION', requiresAcademicInput: false });
    expect(reasons(r)).toContain('ACADEMIC_CONTEXT_FROM_INSTITUTION');
    expect(r.phase).toBe('NONE');
    expect(r.state).toBe('NO_EXAM_TARGET');
    expect(r.recommendedNextAction.kind).toBe('CONTINUE_LEARNING');
    expect(r.mockStatus.status).toBe('NOT_APPLICABLE');
  });

  it('even with no self-declared profile at all (the institution knows enough)', () => {
    const r = resolve(facts({ learner: institutionStudent({ academicProfile: null, examTargetCount: 0, subjectCount: 0 }), target: null }));
    expect(r.learner.requiresAcademicInput).toBe(false);
  });

  it('an institution assignment not yet taken up as a preparation is a target (no id), never a forced activity', () => {
    const r = resolve(facts({ learner: institutionStudent({ examTargetCount: 0 }), target: target({ examTargetId: null, source: 'INSTITUTION_ASSIGNMENT', confirmation: 'ASSIGNED', examDate: null }) }));
    expect(r.phase).toBe('HORIZON');
    expect(reasons(r)).toEqual(expect.arrayContaining(['TARGET_ASSIGNED_BY_INSTITUTION', 'TARGET_NOT_YET_A_PREPARATION']));
    expect(codes(r)).toContain('EXAM_DATE_UNKNOWN:TARGET');
    expect(r.recommendedNextAction.kind).toBe('SET_EXAM_DATE');
  });
});

describe('Case 2 -- institution IB Student, future exam far from the date', () => {
  const far = (over: Partial<StudentExamJourneyFacts> = {}) =>
    facts({ learner: institutionStudent(), target: target({ source: 'INSTITUTION', confirmation: 'ASSIGNED', examDate: '2029-05-01' }), ...over });

  it('foundation / future-exam state: HORIZON, learning first, no exam CTA', () => {
    const r = resolve(far());
    expect(r.phase).toBe('HORIZON');
    expect(r.state).toBe('EXAM_PREPARATION_NOT_DUE');
    expect(r.recommendedNextAction.kind).toBe('CONTINUE_LEARNING');
    expect(reasons(r)).toContain('WINDOW_NOT_OPEN');
    expect(r.mockStatus.status).not.toBe('RECOMMENDED');
  });

  it('recent learning on the target concepts -> FOUNDATION_BUILDING', () => {
    const r = resolve(far({ learning: learning({ lastMappedLearningEvidenceAt: '2026-09-28T12:00:00.000Z' }) }));
    expect(r.state).toBe('FOUNDATION_BUILDING');
    expect(r.phase).toBe('HORIZON');
  });
});

describe('Case 3 -- institution IB DP Year 2, active target, no mock yet', () => {
  const dp2 = (readyShare: number) =>
    facts({
      learner: institutionStudent(),
      target: target({ source: 'INSTITUTION', confirmation: 'ASSIGNED', examDate: '2027-05-03' }),
      learning: learning({ mappedWithEvidence: 7, weightedReadyShare: readyShare, counts: { ALREADY_STRONG: 2, NEEDS_CONFIRMATION: 1, NEEDS_REINFORCEMENT: 4, NO_EVIDENCE: 3, NOT_YET_MAPPED: 0 } }),
      exam: { instances: [diagnostic(), instance()], openAttempt: false },
    });

  it('preparation active; the mock is startable but not yet recommended', () => {
    const r = resolve(dp2(0.3));
    expect(r.phase).toBe('PREPARATION');
    expect(r.state).toBe('PRACTICE_ACTIVE');
    expect(reasons(r)).toContain('WINDOW_OPEN_BY_ENGAGEMENT');
    expect(r.mockStatus).toMatchObject({ status: 'AVAILABLE_NOT_RECOMMENDED', startable: true, nextMockNumber: 1, guidance: ['READINESS_BELOW_GUIDANCE'] });
  });

  it('Mock 1 is next as soon as it is recommended', () => {
    const r = resolve(dp2(0.5));
    expect(r.state).toBe('MOCK_AVAILABLE');
    expect(r.phase).toBe('SIMULATION');
    expect(r.recommendedNextAction).toMatchObject({ kind: 'TAKE_MOCK', mockNumber: 1 });
    expect(r.mockStatus).toMatchObject({ status: 'RECOMMENDED', startable: true, fidelity: 'REDUCED' });
    expect(reasons(r)).toContain('MOCK_REDUCED_FORM_ONLY');
  });
});

describe('Case 4 -- independent PAA Student, no subjects, valid PAA target (certifies J0)', () => {
  const paa = facts({ target: target({ framework: 'PAA', objectiveKey: 'paa', examDate: '2026-12-05' }) });

  it('the gate lets the Student into Exam Prep with zero subjects and no school profile', () => {
    expect(decideStudentOnboardingGate('/dashboard/exam-prep', { accountStatus: 'ACTIVE', roles: ['STUDENT'], storedWorkspace: 'STUDENT', profile: null, subjectCount: 0, examTargetCount: 1 })).toBeNull();
  });

  it('the resolver places the journey without institution, curriculum or subjects', () => {
    const r = resolve(paa);
    expect(r.learner).toEqual({ state: 'EXAM_ONLY_PROFILE', contextSource: null, requiresAcademicInput: false });
    expect(r.phase).toBe('ACTIVATION');
    expect(r.state).toBe('DIAGNOSTIC_DUE');
    expect(r.recommendedNextAction.kind).toBe('START_DIAGNOSTIC');
    expect(r.predictionStatus.status).toBe('PREDICTION_MODEL_UNAVAILABLE');
  });
});

describe('Case 5 -- independent ICFES / Saber 11 retake with a previous result', () => {
  it('resolves without any institution; the previous result is a fact, never a projection', () => {
    const r = resolve(facts({ target: target({ framework: 'SABER11', objectiveKey: 'saber11', examDate: '2027-03-07', previousResult: { scale: 'SABER11_GLOBAL', value: '285' } }) }));
    expect(r.learner.state).toBe('EXAM_ONLY_PROFILE');
    expect(r.learner.contextSource).toBeNull();
    expect(reasons(r)).toEqual(expect.arrayContaining(['PREVIOUS_RESULT_RECORDED', 'WINDOW_OPEN_BY_DATE']));
    expect(r.state).toBe('DIAGNOSTIC_DUE');
    expect(r.predictionStatus).toMatchObject({ status: 'PREDICTION_MODEL_UNAVAILABLE', official: false });
    expect(codes(r).some((c) => c.endsWith(':PREDICTION'))).toBe(false);
  });
});

describe('Case 6 -- independent longitudinal learner with a curriculum, no immediate exam', () => {
  it('learning continues; Exam Prep is never forced', () => {
    const learner = independent({ academicProfile: { complete: true, countryCode: 'MX', gradeLevel: 7, programmeId: 'prog-sep', academicSubjects: [] }, subjectCount: 3, examTargetCount: 0 });
    const r = resolve(facts({ learner, target: null, blueprint: null, content: null, learning: null }));
    expect(r.learner).toEqual({ state: 'ACADEMIC_PATH_DEFINED', contextSource: 'STUDENT', requiresAcademicInput: false });
    expect(r.state).toBe('NO_EXAM_TARGET');
    expect(r.recommendedNextAction.kind).toBe('CONTINUE_LEARNING');
    const gate = { accountStatus: 'ACTIVE', roles: ['STUDENT' as const], storedWorkspace: 'STUDENT' as const, profile: { profileCompleted: true, countryOfStudy: 'mx', schoolYear: '7', curriculumType: 'national', ibProgramme: null, ibYear: null, academicYear: '2026' }, subjectCount: 3, examTargetCount: 0 };
    expect(decideStudentOnboardingGate('/dashboard/today', gate)).toBeNull();
  });
});

describe('Case 7 -- Mock 1 completed, prediction model exists', () => {
  it('early prediction available (never official); missing IA explained by a blocker', () => {
    const r = resolve(
      facts({
        exam: { instances: [diagnostic(), mock('2026-10-01T10:00:00.000Z')], openAttempt: false },
        prediction: { modelClass: 'HISTORICAL_ESTIMATE', components: MODEL_COMPONENTS, estimates: [] },
      })
    );
    expect(r.state).toBe('EARLY_PREDICTION_AVAILABLE');
    expect(r.phase).toBe('SIMULATION');
    expect(r.predictionStatus).toMatchObject({ status: 'EARLY_AVAILABLE', modelClass: 'HISTORICAL_ESTIMATE', basisMocks: 1, missingComponentIds: ['ia'], official: false });
    expect(codes(r)).toContain('REQUIRED_COMPONENT_MISSING:PREDICTION');
    expect(r.recommendedNextAction.kind).toBe('REVIEW_PROJECTION');
  });
});

describe('Case 8 -- Mock 1 completed, prediction model missing', () => {
  it('PREDICTION_MODEL_UNAVAILABLE; no projection invented', () => {
    const r = resolve(facts({ exam: { instances: [diagnostic(), mock('2026-10-01T10:00:00.000Z')], openAttempt: false } }));
    expect(r.state).toBe('MOCK_1_COMPLETED');
    expect(r.predictionStatus).toMatchObject({ status: 'PREDICTION_MODEL_UNAVAILABLE', modelClass: 'NO_MODEL', official: false });
    expect(codes(r)).toContain('PREDICTION_MODEL_UNAVAILABLE:PREDICTION');
    expect(r.recommendedNextAction.kind).toBe('REVIEW_MOCK_RESULT');
    expect(JSON.stringify(r)).not.toMatch(/"grade"|projectedGrade/);
  });
});

describe('Case 9 -- Blueprint valid, insufficient bank', () => {
  it('CONTENT_UNAVAILABLE per mode, never BLUEPRINT_INCOMPLETE, nothing offered as runnable', () => {
    const r = resolve(
      facts({
        blueprint: { ...BLUEPRINT_READY, readiness: 'STRUCTURE_READY' },
        content: { practice: false, diagnostic: false, reducedMock: false, fullMock: false, learningBridge: true, unavailable: [{ capability: 'PRACTICE', reason: 'BANK_IN_PROGRESS' }, { capability: 'DIAGNOSTIC', reason: 'BANK_IN_PROGRESS' }, { capability: 'REDUCED_MOCK', reason: 'BANK_IN_PROGRESS' }], reducedMockLengthCoveragePercent: null },
      })
    );
    expect(r.state).toBe('EXAM_READINESS_AVAILABLE');
    expect(codes(r)).toEqual(expect.arrayContaining(['CONTENT_UNAVAILABLE:PRACTICE', 'CONTENT_UNAVAILABLE:DIAGNOSTIC', 'CONTENT_UNAVAILABLE:MOCK']));
    expect(codes(r).some((c) => c.startsWith('BLUEPRINT_INCOMPLETE'))).toBe(false);
    expect(r.mockStatus).toMatchObject({ status: 'UNAVAILABLE', startable: false });
    expect(reasons(r)).toContain('CONTENT_BANK_IN_PROGRESS');
    expect(r.recommendedNextAction.kind).toBe('CONTINUE_LEARNING');
  });

  it('Blueprint NOT ready -> BLUEPRINT_INCOMPLETE (and no content blocker blamed on the bank)', () => {
    const r = resolve(facts({ blueprint: { ...BLUEPRINT_READY, readiness: 'CATALOG_ONLY', structureVisible: false, publishedVersion: false }, content: { ...CONTENT_READY, practice: false, diagnostic: false, reducedMock: false, learningBridge: false } }));
    expect(codes(r)).toContain('BLUEPRINT_INCOMPLETE:STRUCTURE');
    expect(codes(r).some((c) => c.startsWith('CONTENT_UNAVAILABLE'))).toBe(false);
    expect(r.phase).toBe('HORIZON');
    expect(r.mockStatus.startable).toBe(false);
    expect(r.recommendedNextAction.kind).toBe('NOTIFY_WHEN_AVAILABLE');
  });
});

describe('Case 10 -- low readiness with a valid mock available (O-04)', () => {
  it('recommended or not by the rules, but never hard-blocked by readiness alone', () => {
    // exam in 61 days: outside the time override, so readiness guidance applies
    const r = resolve(facts({ learning: learning({ mappedWithEvidence: 1, weightedReadyShare: 0.05 }) }));
    expect(r.state).toBe('DIAGNOSTIC_DUE');
    expect(r.mockStatus).toMatchObject({ status: 'AVAILABLE_NOT_RECOMMENDED', startable: true });
    expect(r.mockStatus.guidance).toEqual(expect.arrayContaining(['DIAGNOSTIC_OR_EVIDENCE_PENDING', 'READINESS_BELOW_GUIDANCE']));
    expect(r.blockers.some((b) => b.scope === 'MOCK')).toBe(false);
  });

  it('time overrides readiness: exam in 6 weeks + diagnostic done -> Mock 1 recommended despite low readiness', () => {
    const r = resolve(facts({ target: target({ examDate: '2026-11-16' }), learning: learning({ mappedWithEvidence: 6, weightedReadyShare: 0.1 }), exam: { instances: [diagnostic()], openAttempt: false } }));
    expect(r.state).toBe('MOCK_AVAILABLE');
    expect(reasons(r)).toContain('MOCK_TIME_OVERRIDE');
  });
});

// ------------------------------------------------------------------ sequence beyond Mock 1
describe('reinforcement -> Mock 2 -> projection (O-02, O-03)', () => {
  const base = (instances: ExamInstanceFact[], over: Partial<StudentExamJourneyFacts> = {}) =>
    facts({ learning: learning({ mappedWithEvidence: 8, weightedReadyShare: 0.6 }), exam: { instances: [diagnostic(), ...instances], openAttempt: false }, ...over });

  it('activity after Mock 1 -> REINFORCEMENT_ACTIVE; 14+ days later -> MOCK_2_AVAILABLE', () => {
    const recent = resolve(base([mock('2026-09-30T10:00:00.000Z'), instance({ completedAt: '2026-10-02T10:00:00.000Z' })]));
    expect(recent.state).toBe('REINFORCEMENT_ACTIVE');
    expect(recent.mockStatus.guidance).toContain('TOO_SOON_AFTER_LAST_MOCK');
    const later = resolve(base([mock('2026-09-15T10:00:00.000Z'), instance({ completedAt: '2026-09-25T10:00:00.000Z' })]));
    expect(later.state).toBe('MOCK_2_AVAILABLE');
    expect(later.recommendedNextAction).toMatchObject({ kind: 'TAKE_MOCK', mockNumber: 2 });
  });

  it('no model after Mock 2 -> MOCK_2_COMPLETED, prediction unavailable', () => {
    const r = resolve(base([mock('2026-09-01T10:00:00.000Z'), mock('2026-10-03T10:00:00.000Z')]));
    expect(r.state).toBe('MOCK_2_COMPLETED');
    expect(r.mockStatus.completedMocks).toBe(2);
  });

  it('model + IA missing -> ADDITIONAL_COMPONENTS_REQUIRED; an independent Student is asked for the estimate', () => {
    const r = resolve(base([mock('2026-09-01T10:00:00.000Z'), mock('2026-10-03T10:00:00.000Z')], { prediction: { modelClass: 'OFFICIAL_OR_KNOWN_MODEL', components: MODEL_COMPONENTS, estimates: [] } }));
    expect(r.state).toBe('ADDITIONAL_COMPONENTS_REQUIRED');
    expect(r.phase).toBe('PROJECTION');
    expect(r.recommendedNextAction.kind).toBe('ENTER_COMPONENT_ESTIMATE');
  });

  it('O-03: an institution Student\'s own IA estimate is a what-if only; a teacher estimate completes the projection', () => {
    const inst = { learner: institutionStudent(), target: target({ source: 'INSTITUTION' as const, confirmation: 'ASSIGNED' as const }) };
    const mocks2 = [mock('2026-09-01T10:00:00.000Z'), mock('2026-10-03T10:00:00.000Z')];
    const own = resolve(base(mocks2, { ...inst, prediction: { modelClass: 'OFFICIAL_OR_KNOWN_MODEL', components: MODEL_COMPONENTS, estimates: [{ componentId: 'ia', source: 'STUDENT_ESTIMATE' }] } }));
    expect(own.state).toBe('ADDITIONAL_COMPONENTS_REQUIRED');
    expect(reasons(own)).toEqual(expect.arrayContaining(['STUDENT_ESTIMATE_SCENARIO_ONLY', 'TEACHER_COMPONENT_INPUT_PENDING']));
    expect(own.recommendedNextAction.kind).not.toBe('ENTER_COMPONENT_ESTIMATE');
    const teacher = resolve(base(mocks2, { ...inst, prediction: { modelClass: 'OFFICIAL_OR_KNOWN_MODEL', components: MODEL_COMPONENTS, estimates: [{ componentId: 'ia', source: 'STUDENT_ESTIMATE' }, { componentId: 'ia', source: 'TEACHER_ESTIMATE' }] } }));
    expect(teacher.state).toBe('FULL_PREDICTION_AVAILABLE');
    expect(teacher.predictionStatus).toMatchObject({ status: 'FULL_AVAILABLE', official: false, missingComponentIds: [] });
  });

  it('an independent Student\'s own estimate completes the projection (labelled by its source upstream)', () => {
    const r = resolve(base([mock('2026-09-01T10:00:00.000Z'), mock('2026-10-03T10:00:00.000Z')], { prediction: { modelClass: 'HISTORICAL_ESTIMATE', components: MODEL_COMPONENTS, estimates: [{ componentId: 'ia', source: 'STUDENT_ESTIMATE' }] } }));
    expect(r.state).toBe('FULL_PREDICTION_AVAILABLE');
  });

  it('a mock that does not cover the simulated components cannot ground a projection', () => {
    const r = resolve(base([mock('2026-10-01T10:00:00.000Z', { coveredComponentIds: ['p1'] })], { prediction: { modelClass: 'OFFICIAL_OR_KNOWN_MODEL', components: MODEL_COMPONENTS, estimates: [] } }));
    expect(r.predictionStatus.status).toBe('PREDICTION_NOT_READY');
    expect(codes(r)).toContain('PREDICTION_NOT_READY:PREDICTION');
    expect(reasons(r)).toContain('MOCK_COMPONENT_COVERAGE_INCOMPLETE');
  });

  it('only scored MOCK forms count: CHALLENGE, invalidated, unscored and in-progress mocks do not', () => {
    const list = [
      mock('2026-09-01T10:00:00.000Z', { mode: 'CHALLENGE' }),
      mock('2026-09-02T10:00:00.000Z', { result: 'INVALIDATED' }),
      mock('2026-09-03T10:00:00.000Z', { result: 'NO_SCORING_POLICY' }),
      mock('2026-09-04T10:00:00.000Z', { status: 'IN_PROGRESS', completedAt: null, result: null }),
      mock('2026-09-05T10:00:00.000Z', { status: 'DELETED' }),
    ];
    expect(scoredMocks(list)).toHaveLength(0);
  });
});

// ------------------------------------------------------------------ closing + other states
describe('closing, confirmation, open attempts, programme plans', () => {
  it('final window, exam-ready window (no more mocks), exam passed, result recorded', () => {
    expect(resolve(facts({ target: target({ examDate: '2026-10-20' }) })).state).toBe('FINAL_PREPARATION');
    const ready = resolve(facts({ target: target({ examDate: '2026-10-07' }), exam: { instances: [diagnostic()], openAttempt: false } }));
    expect(ready.state).toBe('EXAM_READY');
    expect(ready.mockStatus.guidance).toContain('EXAM_TOO_CLOSE');
    const passed = resolve(facts({ target: target({ examDate: '2026-10-01' }) }));
    expect(passed.state).toBe('EXAM_COMPLETED');
    expect(passed.recommendedNextAction.kind).toBe('CONFIRM_EXAM_SAT');
    expect(resolve(facts({ target: target({ examDate: '2026-10-01', satConfirmed: true }) })).recommendedNextAction.kind).toBe('RECORD_RESULT');
    const done = resolve(facts({ target: target({ examDate: '2026-10-01', actualResult: { scale: 'X', value: '6', source: 'STUDENT_REPORTED' } }) }));
    expect(done.state).toBe('RESULT_RECORDED');
    expect(done.phase).toBe('CLOSING');
  });

  it('an unconfirmed (suggested) target stays a future milestone until the Student confirms', () => {
    const r = resolve(facts({ target: target({ confirmation: 'SUGGESTED' }) }));
    expect(r.state).toBe('FUTURE_EXAM_IDENTIFIED');
    expect(codes(r)).toContain('TARGET_EXAM_UNCONFIRMED:TARGET');
    expect(r.recommendedNextAction.kind).toBe('CONFIRM_TARGET');
  });

  it('an open attempt is resumed first and is the only thing that makes a valid mock unstartable', () => {
    const r = resolve(facts({ exam: { instances: [diagnostic()], openAttempt: true } }));
    expect(r.recommendedNextAction.kind).toBe('RESUME_ATTEMPT');
    expect(r.mockStatus.startable).toBe(false);
    expect(codes(r)).toContain('ATTEMPT_IN_PROGRESS:MOCK');
  });

  it('a programme container (AICE Diploma) is planned by subject, never practised as one exam', () => {
    const r = resolve(facts({ blueprint: { ...BLUEPRINT_READY, readiness: 'STRUCTURE_READY', programmePlan: true }, content: { practice: false, diagnostic: false, reducedMock: false, fullMock: false, learningBridge: false, unavailable: [], reducedMockLengthCoveragePercent: null } }));
    expect(r.state).toBe('EXAM_READINESS_AVAILABLE');
    expect(r.recommendedNextAction.kind).toBe('PLAN_PROGRAMME');
    expect(r.mockStatus.status).toBe('NOT_APPLICABLE');
    expect(codes(r).some((c) => c.startsWith('CONTENT_UNAVAILABLE') || c.startsWith('BLUEPRINT_INCOMPLETE'))).toBe(false);
  });

  it('institutional release pending and invalid versions are hard blocks for the mock', () => {
    const pending = resolve(facts({ blueprint: { ...BLUEPRINT_READY, institutionalRelease: 'PENDING' }, exam: { instances: [diagnostic()], openAttempt: false } }));
    expect(codes(pending)).toContain('INSTITUTIONAL_RELEASE_REQUIRED:MOCK');
    expect(pending.mockStatus.startable).toBe(false);
    const invalid = resolve(facts({ blueprint: { ...BLUEPRINT_READY, versionValidity: 'INVALID' } }));
    expect(codes(invalid)).toContain('BLUEPRINT_VERSION_INVALID:TARGET');
    expect(invalid.mockStatus.startable).toBe(false);
    expect(invalid.phase).toBe('HORIZON');
  });
});

// ------------------------------------------------------------------ invariants over a fact matrix
describe('invariants (fact matrix)', () => {
  const matrix: StudentExamJourneyFacts[] = [];
  const blueprints: Array<BlueprintReadinessFacts | null> = [null, BLUEPRINT_READY, { ...BLUEPRINT_READY, readiness: 'CATALOG_ONLY', structureVisible: false, publishedVersion: false }, { ...BLUEPRINT_READY, readiness: 'STRUCTURE_READY' }, { ...BLUEPRINT_READY, institutionalRelease: 'PENDING' }];
  const contents: Array<ContentReadinessFacts | null> = [null, CONTENT_READY, { ...CONTENT_READY, reducedMock: false }, { ...CONTENT_READY, practice: false, diagnostic: false, reducedMock: false }];
  const dates = [null, '2026-10-06', '2026-10-20', '2026-12-01', '2027-05-03', '2029-05-01', '2026-09-01'];
  const histories: ExamInstanceFact[][] = [[], [diagnostic()], [diagnostic(), instance()], [diagnostic(), mock('2026-09-01T10:00:00.000Z')], [diagnostic(), mock('2026-09-01T10:00:00.000Z'), mock('2026-10-01T10:00:00.000Z')]];
  const models = [
    { modelClass: 'NO_MODEL' as const, components: [], estimates: [] },
    { modelClass: 'HISTORICAL_ESTIMATE' as const, components: MODEL_COMPONENTS, estimates: [] },
  ];
  for (const blueprint of blueprints) for (const content of contents) for (const examDate of dates) for (const instances of histories) for (const prediction of models) for (const openAttempt of [false, true]) {
    matrix.push(facts({ blueprint, content, target: target({ examDate }), exam: { instances, openAttempt }, prediction }));
  }

  it(`holds for all ${matrix.length} combinations`, () => {
    for (const f of matrix) {
      const r = resolve(f);
      const bc = codes(r);
      // phase is always the design phase of the state
      expect(r.phase).toBe(STATE_PHASE[r.state]);
      // never fabricate availability
      if (bc.some((c) => c.startsWith('BLUEPRINT_INCOMPLETE'))) {
        expect(['HORIZON', 'CLOSING']).toContain(r.phase);
        expect(r.mockStatus.startable).toBe(false);
        expect(bc.some((c) => c.startsWith('CONTENT_UNAVAILABLE'))).toBe(false);
      }
      if (bc.includes('CONTENT_UNAVAILABLE:MOCK')) expect(r.mockStatus.startable).toBe(false);
      if (['MOCK_AVAILABLE', 'MOCK_2_AVAILABLE'].includes(r.state)) expect(r.mockStatus.status).toBe('RECOMMENDED');
      // predictions only from a classified model + a scored mock; never official
      expect(r.predictionStatus.official).toBe(false);
      if (['EARLY_AVAILABLE', 'UPDATED_AVAILABLE', 'COMPONENTS_REQUIRED', 'FULL_AVAILABLE'].includes(r.predictionStatus.status)) {
        expect(r.predictionStatus.modelClass).not.toBe('NO_MODEL');
        expect(r.mockStatus.completedMocks).toBeGreaterThan(0);
      }
      if (['EARLY_PREDICTION_AVAILABLE', 'UPDATED_PREDICTION_AVAILABLE', 'FULL_PREDICTION_AVAILABLE', 'ADDITIONAL_COMPONENTS_REQUIRED'].includes(r.state)) {
        expect(r.predictionStatus.modelClass).not.toBe('NO_MODEL');
      }
      // O-04: a mock is unstartable only for a reason that makes it impossible
      if (!r.mockStatus.startable && r.mockStatus.status !== 'NOT_APPLICABLE') {
        expect(r.blockers.some((b) => ['MOCK', 'STRUCTURE'].includes(b.scope) || b.code === 'BLUEPRINT_VERSION_INVALID')).toBe(true);
      }
      // determinism
      expect(resolve(f)).toEqual(r);
    }
  });

  it('does not mutate its input', () => {
    const f = facts({ exam: { instances: [mock('2026-10-01T10:00:00.000Z'), diagnostic()], openAttempt: false } });
    const before = JSON.stringify(f);
    resolve(f);
    expect(JSON.stringify(f)).toBe(before);
  });
});

// ------------------------------------------------------------------ policy (O-01) + source discipline
describe('journey policy and source discipline', () => {
  it('O-01: the preparation window comes from journey policy and the evidence gap, not from the exam', () => {
    expect(preparationWindowDays(JOURNEY_POLICY_V1, null)).toBe(26 * 7);
    expect(preparationWindowDays(JOURNEY_POLICY_V1, 1)).toBe(8 * 7);
    expect(preparationWindowDays(JOURNEY_POLICY_V1, 0.5)).toBe(17 * 7);
  });

  it('pure and exam-agnostic: no clock, no DB, no exam-specific branching, no entry-path flag', () => {
    for (const file of ['src/lib/exam-journey/resolver.ts', 'src/lib/exam-journey/policy.ts', 'src/lib/exam-journey/types.ts']) {
      const src = readFileSync(join(ROOT, file), 'utf-8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(src).not.toMatch(/Date\.now\(|new Date\(/);
      expect(src).not.toMatch(/@\/lib\/db|from 'pg'/);
      expect(src).not.toMatch(/'(PAA|PISA|SABER11|IB_DP|CIE_[A-Z_]+|ICFES)'/);
      expect(src).not.toMatch(/entryPath|ENTRY_PATH/);
    }
  });

  it('O-02: the model classes are exactly the approved three', () => {
    const src = readFileSync(join(ROOT, 'src/lib/exam-journey/types.ts'), 'utf-8');
    expect(src).toMatch(/PredictionModelClass = 'OFFICIAL_OR_KNOWN_MODEL' \| 'HISTORICAL_ESTIMATE' \| 'NO_MODEL'/);
  });
});
