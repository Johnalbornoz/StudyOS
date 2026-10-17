/**
 * Overnight 2026-10-16 -- subject Test ("Prueba por materia") / Mock ("Simulacro por materia") operator rules:
 * the pure lifecycle module, the sizing contract it uses, and source / contract checks on the service and routes.
 * The real-database run is scripts/operations/subject-assessment-scenario.ts.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  answerCountsAt, blueprintMatches, buildSchedule, buildSubjectReport, conceptNeedsReinforcement, endOfLocalDateUtc, feedbackPolicyFor,
  isValidTimeZone, lifecycleState, localDateIn, localMidnightUtc, readSetup, recommendedMockDurationMinutes, remainingSeconds,
  resolveStudentTimezone, sessionExpiresAt, splitByLevels, startTiming, studentTimingFor, validateExplicitPlan, DIFFICULTY_BAND_LEVELS,
  SUBJECT_SUBMIT_GRACE_SECONDS, STUDENT_MAX_ATTEMPTS, MOCK_DURATION_RULE,
} from '@/lib/subject-assessment/lifecycle';
import { planGroupAssessment, planSubjectMock, planSubjectTest, subjectAssessmentPassed } from '@/lib/subject-assessment/sizing';
import { nominalResponseSeconds } from '@/lib/assessment-foundation/nominal-response-time';
import { MESSAGES } from '@/lib/i18n/messages';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const SERVICE = src('src/services/subject-assessment.service.ts');
const ROUTE = src('src/app/api/quizzes/generate-and-take/route.ts');
const PAGE = src('src/app/dashboard/quiz/page.tsx');
const POLICY = { minimumUnderstanding: 80, minimumEvidenceCount: 3 };
const KS_OK = { masteryState: 'VALIDATED_MASTERY', understandingScore: 92, activeMisconceptionCount: 0, criticalMisconceptionCount: 0, evidenceCount: 10, validationReadiness: 'READY' };

describe('Knowledge State -> needsReinforcement (documented mapping)', () => {
  it('no KS row = insufficient evidence -> need', () => {
    expect(conceptNeedsReinforcement(null, POLICY)).toEqual({ needsReinforcement: true, reasons: ['NO_KNOWLEDGE_STATE'] });
  });
  it('a clean VALIDATED_MASTERY concept needs no reinforcement', () => {
    expect(conceptNeedsReinforcement(KS_OK, POLICY).needsReinforcement).toBe(false);
  });
  it.each([
    [{ masteryState: 'DEVELOPING' }, 'IN_PROCESS'],
    [{ masteryState: 'LEARNING' }, 'IN_PROCESS'],
    [{ masteryState: 'AT_RISK' }, 'AT_RISK'],
    [{ masteryState: 'INTERVENTION_REQUIRED' }, 'AT_RISK'],
    [{ masteryState: 'PROVISIONAL_MASTERY' }, 'VALIDATION_NEEDED'],
    [{ validationReadiness: 'INSUFFICIENT_EVIDENCE' }, 'INSUFFICIENT_EVIDENCE'],
    [{ evidenceCount: 1 }, 'INSUFFICIENT_EVIDENCE'],
    [{ activeMisconceptionCount: 1 }, 'ACTIVE_MISCONCEPTION'],
    [{ criticalMisconceptionCount: 1 }, 'ACTIVE_MISCONCEPTION'],
    [{ understandingScore: 70 }, 'UNDERSTANDING_BELOW_POLICY'],
  ])('%o -> %s', (patch, reason) => {
    const r = conceptNeedsReinforcement({ ...KS_OK, ...patch }, POLICY);
    expect(r.needsReinforcement).toBe(true);
    expect(r.reasons).toContain(reason);
  });
});

describe('counts (sizing.ts, the one count authority)', () => {
  it('adaptive Test: 1 per concept, 2 with need, min 4, every selected concept present, max 50', () => {
    const t = planSubjectTest([{ conceptId: 'a', needsReinforcement: false }, { conceptId: 'b', needsReinforcement: true }, { conceptId: 'c', needsReinforcement: true }]);
    expect(t).toMatchObject({ questionCount: 5, distribution: { a: 1, b: 2, c: 2 } });
    expect(planSubjectTest([{ conceptId: 'a', needsReinforcement: false }]).questionCount).toBe(4);
    const fifty = planSubjectTest(Array.from({ length: 50 }, (_, i) => ({ conceptId: `c${i}`, needsReinforcement: true })));
    expect(fifty.questionCount).toBe(50);
    expect(Object.values(fifty.distribution).every((n) => n >= 1)).toBe(true);
    expect(planSubjectTest(Array.from({ length: 51 }, (_, i) => ({ conceptId: `c${i}`, needsReinforcement: false }))).uncovered).toHaveLength(1);
  });
  it('Mock table: 1=5, 2-5 cap 10, 6-10 cap 20, 11-15 cap 30, all subject cap 50, uniform', () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `c${i}`);
    expect(planSubjectMock(ids(1), false).questionCount).toBe(5);
    expect(planSubjectMock(ids(5), false).questionCount).toBe(10);
    expect(planSubjectMock(ids(10), false).questionCount).toBe(20);
    expect(planSubjectMock(ids(15), false).questionCount).toBe(30);
    const all = planSubjectMock(ids(40), true);
    expect(all).toMatchObject({ questionCount: 50, band: 'ALL_SUBJECT' });
    const v = Object.values(all.distribution);
    expect(Math.max(...v) - Math.min(...v)).toBeLessThanOrEqual(1);
    expect(Object.keys(all.distribution)).toHaveLength(40);
  });
  it('pass >= 80 inclusive', () => {
    expect(subjectAssessmentPassed(80)).toBe(true);
    expect(subjectAssessmentPassed(79.9)).toBe(false);
  });
});

describe('explicit (TEACHER) plans and difficulty bands', () => {
  it('a group plan validates; a plan that drops a concept, mis-sums or exceeds 50 does not', () => {
    const g = planGroupAssessment('MOCK', ['a', 'b', 'c'], false);
    expect(validateExplicitPlan(g, ['a', 'b', 'c'])).toEqual({ ok: true });
    expect(validateExplicitPlan({ ...g, distribution: { a: 2, b: 2 }, questionCount: 4 }, ['a', 'b', 'c'])).toMatchObject({ ok: false, error: 'PLAN_CONCEPT_UNCOVERED' });
    expect(validateExplicitPlan({ ...g, questionCount: 7 }, ['a', 'b', 'c'])).toMatchObject({ ok: false, error: 'PLAN_DISTRIBUTION_SUM_MISMATCH' });
    expect(validateExplicitPlan({ questionCount: 51, distribution: { a: 51 }, rule: 'x' }, ['a'])).toMatchObject({ ok: false, error: 'PLAN_COUNT_OUT_OF_RANGE' });
    expect(validateExplicitPlan({ questionCount: 2, distribution: { a: 1, z: 1 }, rule: 'x' }, ['a'])).toMatchObject({ ok: false, error: 'PLAN_CONCEPT_NOT_SELECTED' });
  });
  it('bands map to generator levels; MIXED rotates; the split is exact', () => {
    expect(DIFFICULTY_BAND_LEVELS).toEqual({ LOW: [2], MEDIUM: [3], HIGH: [4], MIXED: [2, 3, 4] });
    expect(splitByLevels(5, [2, 3, 4])).toEqual([{ level: 2, count: 2 }, { level: 3, count: 2 }, { level: 4, count: 1 }]);
    expect(splitByLevels(1, [2, 3, 4])).toEqual([{ level: 2, count: 1 }]);
    expect(splitByLevels(3, [3]).reduce((a, x) => a + x.count, 0)).toBe(3);
  });
});

describe('timezone and schedule (SELF_SCHEDULED_EXPIRY_TIME = end of the selected local date)', () => {
  it('end of a local date is the next local midnight, DST-safe', () => {
    expect(endOfLocalDateUtc('2026-10-17', 'America/Bogota').toISOString()).toBe('2026-10-18T05:00:00.000Z');
    expect(endOfLocalDateUtc('2026-10-17', 'UTC').toISOString()).toBe('2026-10-18T00:00:00.000Z');
    // Madrid leaves summer time on 2026-10-25: that day is 25 h long
    expect(endOfLocalDateUtc('2026-10-24', 'Europe/Madrid').toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expect(endOfLocalDateUtc('2026-10-25', 'Europe/Madrid').toISOString()).toBe('2026-10-25T23:00:00.000Z');
    expect(localMidnightUtc('2026-10-25', 'Europe/Madrid').toISOString()).toBe('2026-10-24T22:00:00.000Z');
  });
  it('local date of an instant', () => {
    expect(localDateIn('America/Bogota', new Date('2026-10-18T03:00:00Z'))).toBe('2026-10-17');
    expect(localDateIn('Asia/Tokyo', new Date('2026-10-17T16:00:00Z'))).toBe('2026-10-18');
  });
  it('timezone authority: student_availability first, the browser only as an assumption, else UTC (assumed)', () => {
    expect(resolveStudentTimezone('America/Bogota', 'Europe/Madrid')).toEqual({ timezone: 'America/Bogota', source: 'STUDENT_AVAILABILITY' });
    expect(resolveStudentTimezone(null, 'Europe/Madrid')).toEqual({ timezone: 'Europe/Madrid', source: 'BROWSER_ASSUMED' });
    expect(resolveStudentTimezone('Not/AZone', undefined)).toEqual({ timezone: 'UTC', source: 'DEFAULT_UTC_ASSUMED' });
    expect(isValidTimeZone('America/Bogota')).toBe(true);
    expect(isValidTimeZone('x')).toBe(false);
  });
  it('a scheduled date today or later is accepted with its frozen expiry; a past date is refused', () => {
    const now = new Date('2026-10-17T15:00:00Z');
    expect(buildSchedule({ mode: 'NOW' }, 'UTC', now)).toEqual({ ok: true, schedule: { mode: 'NOW' } });
    expect(buildSchedule({ mode: 'SCHEDULED', date: '2026-10-17' }, 'America/Bogota', now)).toEqual({ ok: true, schedule: { mode: 'SCHEDULED', date: '2026-10-17', timezone: 'America/Bogota', expiresAt: '2026-10-18T05:00:00.000Z' } });
    expect(buildSchedule({ mode: 'SCHEDULED', date: '2026-10-16' }, 'America/Bogota', now)).toEqual({ ok: false, error: 'SCHEDULE_DATE_IN_PAST' });
    expect(buildSchedule({ mode: 'SCHEDULED', date: '17/10/2026' }, 'UTC', now)).toEqual({ ok: false, error: 'SCHEDULE_DATE_INVALID' });
  });
});

describe('timing: Mock always timed (NOMINAL_RESPONSE_TIME_SUM), Student Test untimed, wall clock', () => {
  it('duration = sum of nominal seconds of the frozen items, rounded UP to minutes', () => {
    const items = [{ type: 'multiple_choice', difficulty: 3 }, { type: 'short_answer', difficulty: 4 }, { type: 'true_false', difficulty: 1 }];
    const sum = (nominalResponseSeconds('multiple_choice', 3) ?? 0) + (nominalResponseSeconds('short_answer', 4) ?? 0) + (nominalResponseSeconds('true_false', 1) ?? 0);
    expect(recommendedMockDurationMinutes(items)).toEqual({ minutes: Math.ceil(sum / 60), totalSeconds: sum, unplannedItems: 0, rule: MOCK_DURATION_RULE });
    expect(MOCK_DURATION_RULE).toBe('NOMINAL_RESPONSE_TIME_SUM');
    // an out-of-scale generated difficulty is clamped to 1-5 before the lookup, never silently zero
    expect(recommendedMockDurationMinutes([{ type: 'multiple_choice', difficulty: 7 }]).totalSeconds).toBe(nominalResponseSeconds('multiple_choice', 5));
    expect(recommendedMockDurationMinutes([{ type: null, difficulty: 3 }]).unplannedItems).toBe(1);
  });
  it('Student timing: Mock timed with the recommendation; Test untimed', () => {
    expect(studentTimingFor('MOCK', [{ type: 'multiple_choice', difficulty: 3 }])).toEqual({ timed: true, durationMinutes: 1, durationRule: 'NOMINAL_RESPONSE_TIME_SUM' });
    expect(studentTimingFor('TEST', [{ type: 'multiple_choice', difficulty: 3 }])).toEqual({ timed: false, durationMinutes: null });
  });
  it('the deadline is startedAt + duration; remaining time is the true wall-clock rest; answers count only up to the deadline', () => {
    const t = startTiming({ timed: true, durationMinutes: 10 }, new Date('2026-10-17T10:00:00Z'));
    expect(t.deadlineAt).toBe('2026-10-17T10:10:00.000Z');
    expect(remainingSeconds(t, new Date('2026-10-17T10:07:30Z'))).toBe(150); // e.g. after a reconnect: no pause
    expect(remainingSeconds(t, new Date('2026-10-17T10:11:00Z'))).toBe(0);
    expect(answerCountsAt(t, new Date('2026-10-17T10:09:59Z'))).toBe(true);
    expect(answerCountsAt(t, new Date('2026-10-17T10:10:01Z'))).toBe(false);
    expect(answerCountsAt({ timed: false, durationMinutes: null, startedAt: 'x' }, new Date())).toBe(true);
  });
  it('own expiry (never the 45-min creation TTL): scheduled = end of date; timed = deadline + grace; untimed = inactivity window', () => {
    const now = new Date('2026-10-17T10:00:00Z');
    const sched = { schedule: { mode: 'SCHEDULED' as const, date: '2026-10-18', timezone: 'UTC', expiresAt: '2026-10-19T00:00:00.000Z' }, timing: { timed: false, durationMinutes: null } };
    expect(sessionExpiresAt(sched, 'UTC', now).toISOString()).toBe('2026-10-19T00:00:00.000Z');
    const timed = { schedule: { mode: 'NOW' as const }, timing: startTiming({ timed: true, durationMinutes: 90 }, now) };
    expect(sessionExpiresAt(timed, 'UTC', now).getTime()).toBe(now.getTime() + 90 * 60_000 + SUBJECT_SUBMIT_GRACE_SECONDS * 1000);
    const untimed = { schedule: { mode: 'NOW' as const }, timing: startTiming({ timed: false, durationMinutes: null }, now) };
    expect(sessionExpiresAt(untimed, 'UTC', new Date('2026-10-17T10:30:00Z')).toISOString()).toBe('2026-10-17T11:15:00.000Z');
  });
});

describe('lifecycle states', () => {
  const now = new Date('2026-10-17T12:00:00Z');
  const later = new Date('2026-10-18T00:00:00Z');
  const sched = { schedule: { mode: 'SCHEDULED' as const, date: '2026-10-17', timezone: 'UTC', expiresAt: later.toISOString() }, timing: { timed: false, durationMinutes: null } };
  it('scheduled -> not started until started (early start allowed), then active', () => {
    expect(lifecycleState(sched, 'active', later, now)).toBe('SCHEDULED_NOT_STARTED');
    expect(lifecycleState({ ...sched, timing: startTiming(sched.timing, now) }, 'active', later, now)).toBe('ACTIVE');
  });
  it('not taken on its date -> EXPIRED', () => {
    expect(lifecycleState(sched, 'active', later, new Date('2026-10-18T00:00:01Z'))).toBe('EXPIRED');
  });
  it('a timed attempt past its deadline is TIME_UP (to be auto-submitted), even after its session expiry', () => {
    const t = { schedule: { mode: 'NOW' as const }, timing: startTiming({ timed: true, durationMinutes: 5 }, now) };
    expect(lifecycleState(t, 'active', new Date(now.getTime() + 7 * 60_000), new Date(now.getTime() + 6 * 60_000))).toBe('TIME_UP');
    expect(lifecycleState(t, 'active', new Date(now.getTime() + 7 * 60_000), new Date(now.getTime() + 60 * 60_000))).toBe('TIME_UP');
  });
  it('completed is final (one attempt)', () => {
    expect(lifecycleState(sched, 'completed', later, now)).toBe('COMPLETED');
    expect(STUDENT_MAX_ATTEMPTS).toBe(1);
  });
});

describe('final report: UNANSWERED in the denominator, per concept, pass, concepts to reinforce', () => {
  it('14 correct, 2 wrong, 4 unanswered of 20 = 70% (operator example), not passed', () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ questionIndex: i, conceptId: i < 10 ? 'a' : 'b', correct: i < 14 ? true : i < 16 ? false : null, score: i < 14 ? 1 : i < 16 ? 0 : null }));
    const r = buildSubjectReport(items);
    expect(r).toMatchObject({ total: 20, correct: 14, incorrect: 2, unanswered: 4, scorePercent: 70, passed: false });
    expect(r.perConcept.find((c) => c.conceptId === 'a')).toMatchObject({ scorePercent: 100, passed: true });
    expect(r.perConcept.find((c) => c.conceptId === 'b')).toMatchObject({ correct: 4, incorrect: 2, unanswered: 4, scorePercent: 40, passed: false });
    expect(r.conceptsToReinforce).toEqual(['b']);
  });
  it('blueprint must equal the plan exactly', () => {
    expect(blueprintMatches({ a: 2, b: 1 }, { a: 2, b: 1 })).toBe(true);
    expect(blueprintMatches({ a: 2, b: 1 }, { a: 3 })).toBe(false);
  });
  it('feedback policy per kind', () => {
    expect(feedbackPolicyFor('TEST')).toBe('TEST_CORRECTNESS_ONLY');
    expect(feedbackPolicyFor('MOCK')).toBe('MOCK_NONE');
  });
  it('legacy (pre-v2) frozen setups are read as legacy -- never reinterpreted', () => {
    expect(readSetup({ kind: 'SUBJECT_MOCK_EXAM', scheduledDate: '2026-10-17', recommendedDate: null })).toBeNull();
    expect(readSetup({ version: 'subject-assessment-v2', kind: 'SUBJECT_MOCK_EXAM' })).not.toBeNull();
  });
});

describe('service and route contract (source)', () => {
  it('exports createSubjectAssessmentSession with both origins, explicit plan, band, schedule, timing, assignment, attempt, novelty', () => {
    expect(SERVICE).toMatch(/export async function createSubjectAssessmentSession\(/);
    for (const field of ['studentId: string', "kind: 'TEST' | 'MOCK'", "origin: 'STUDENT' | 'TEACHER'", 'conceptIds: string[]', 'plan?: { questionCount: number; distribution: Record<string, number>; rule: string }', "difficultyBand?: 'LOW' | 'MEDIUM' | 'HIGH' | 'MIXED'", 'timing: { timed: boolean; durationMinutes: number | null }', 'assignmentId?: string', 'attemptNumber?: number', 'avoidFingerprints?: string[]']) {
      expect(SERVICE).toContain(field);
    }
    expect(SERVICE).toMatch(/if \(params\.origin === 'TEACHER' && \(!params\.plan \|\| !params\.difficultyBand\)\) return fail\(400, 'PLAN_REQUIRED'/);
  });
  it('generation honours the exact distribution and fails honestly (no ceil-per-concept, no shrink)', () => {
    expect(SERVICE).not.toMatch(/perConceptCap/);
    expect(SERVICE).toMatch(/GENERATION_INSUFFICIENT/);
    expect(SERVICE).toMatch(/blueprintMatches\(plan\.distribution, blueprint\)/);
    expect(SERVICE).toMatch(/reusedItems: generated\.reused/);
  });
  it('evidence: per-concept scorePercent, origin, assignmentId, explicit mock; never Exam Readiness', () => {
    expect(SERVICE).toMatch(/scorePercent: pc\.scorePercent,\n\s+sampleSize: pc\.total/);
    expect(SERVICE).toMatch(/origin: setup\.origin,/);
    expect(SERVICE).toMatch(/assignmentId: setup\.assignmentId/);
    expect(SERVICE).toMatch(/explicitlyMock: setup\.kind === 'SUBJECT_MOCK_EXAM'/);
    expect(SERVICE).not.toMatch(/exam-readiness|calculateExamReadiness|exam_readiness/);
  });
  it('the route: subject modes go to the service before any count logic; submissions of v2 sessions too', () => {
    const create = ROUTE.indexOf('return await handleSubjectAssessmentCreate(validated)');
    const counts = ROUTE.indexOf('let maxQuestions =');
    expect(create).toBeGreaterThan(0);
    expect(create).toBeLessThan(counts);
    expect(ROUTE).toMatch(/isSubjectAssessmentSession\(validated\.quizId\)/);
    expect(ROUTE).toMatch(/origin: 'STUDENT'/);
    expect(ROUTE).not.toMatch(/MORE_CONCEPTS_THAN_QUESTIONS|QUESTION_COUNT_REQUIRED/);
  });
  it('the Test answer route returns only { saved, correct }; the assisted /check route is unchanged for assessment modes', () => {
    expect(SERVICE).toMatch(/return \{ ok: true, data: \{ saved: true, correct: recorded\?\.grade\?\.correct \?\? grade\.correct \} \}/);
    expect(SERVICE).toMatch(/if \(setup\.feedbackPolicy === 'MOCK_NONE'\) \{[\s\S]*?return \{ ok: true, data: \{ saved: true \} \};/);
    expect(src('src/app/api/quizzes/session/[quizId]/check/route.ts')).toMatch(/if \(session\.evidenceMode !== 'PRACTICE'\) \{\n\s+return NextResponse\.json\(\{ error: 'FEEDBACK_DEFERRED' \}/);
  });
  it('a not-started scheduled assessment never restricts the Tutor (and a schema without the column fails closed, not open)', () => {
    const qp = src('src/services/quiz-persistence.service.ts');
    expect(qp).toMatch(/NOT_STARTED_SUBJECT_ASSESSMENT_PREDICATE/);
    expect(qp).toMatch(/if \(e\?\.code === '42703'\) return db\.query\(listSql\(false\), \[studentId\]\)/);
  });
  it('the 45-minute TTL constant is unchanged for every other mode', () => {
    expect(src('src/services/quiz-persistence.service.ts')).toMatch(/export const QUIZ_SESSION_TTL_MINUTES = 45;/);
  });
  it('UI: no count control, DO NOW / SCHEDULE, preview from the server plan, timer, verdict only, final feedback, create a new one', () => {
    expect(PAGE).toMatch(/\(sid: string, languageOverride\?: Locale\) => allowsTopicSelection\n\s+\/\/ Overnight 2026-10-16 subject Test \/ Mock: never a count/);
    expect(PAGE).toMatch(/data-testid="subject-do-now"/);
    expect(PAGE).toMatch(/\/api\/subject-assessments\/preview/);
    expect(PAGE).toMatch(/data-testid="subject-timer"/);
    expect(PAGE).toMatch(/data-testid="subject-test-verdict"/);
    expect(PAGE).toMatch(/data-testid="subject-results"/);
    expect(PAGE).toMatch(/data-testid="subject-create-new"/);
    expect(src('src/app/dashboard/subjects/[id]/page.tsx')).toMatch(/<SubjectAssessmentsList /);
  });
  it('every new key exists in all 5 locales; the removed count / recommended-date keys are gone', () => {
    const keys = Object.keys(MESSAGES.es).filter((k) => k.startsWith('quiz.subject.') || k.startsWith('quiz.subjectSetup.'));
    expect(keys.length).toBeGreaterThan(40);
    for (const [loc, m] of Object.entries(MESSAGES)) for (const k of keys) expect((m as Record<string, string>)[k], `${loc} ${k}`).toBeTruthy();
    for (const gone of ['quiz.subjectSetup.recommendedDate', 'quiz.subjectSetup.recommendedNotAvailable', 'quiz.subjectSetup.questionCountLabel']) expect((MESSAGES.es as Record<string, string>)[gone]).toBeUndefined();
    expect((MESSAGES.es as Record<string, string>)['quiz.modeCumulative']).toBe('Prueba por materia');
    expect((MESSAGES.es as Record<string, string>)['quiz.modeExamSim']).toBe('Simulacro por materia');
  });
});
