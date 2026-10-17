/**
 * Overnight 2026-10-16 -- teacher-assigned subject Test / Mock: the pure assignment rules (window, 21:00 close in the
 * institution's timezone, attempts, last completed wins, resume / close-after-exit, feedback release, group plan).
 */
import { describe, it, expect } from 'vitest';
import {
  buildAssignmentWindow, zonedWallTimeToUtc, windowPhase, windowDays, decideAttemptAction, latestCompletedAttempt, effectiveAssignmentStatus,
  attemptContinuable, sessionAlive, crossStudentSharedFingerprints, feedbackReleaseFor, planForLearner, plansEquivalent, validateTiming,
  resultDistribution, aggregateGroup, UI_DIFFICULTY_TO_BAND, LIVENESS_WINDOW_SECONDS, type AttemptSummary,
} from '@/lib/teacher/subject-assessment-assignment.rules';
import { rankReuseCandidates } from '@/lib/subject-assessment/lifecycle';
import { planGroupAssessment } from '@/lib/subject-assessment/sizing';
import { buildGroupConfig, recommendedDurationForPlan } from '@/lib/teacher/subject-assessment-assignment.service';

const T0 = new Date('2026-10-17T12:00:00Z');

describe('window (rule U)', () => {
  it('closes 21:00 of endDate in the institution timezone and opens 00:00 of startDate', () => {
    const w = buildAssignmentWindow({ startDate: '2026-10-17', endDate: '2026-10-19' }, 'America/Bogota', T0);
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    expect(w.window.opensAt).toBe('2026-10-17T05:00:00.000Z');
    expect(w.window.closesAt).toBe('2026-10-20T02:00:00.000Z');
    expect(w.window.timezone).toBe('America/Bogota');
    expect(w.window.timezoneSource).toBe('INSTITUTION');
  });

  it('a same-day window is that single day, until 21:00', () => {
    const w = buildAssignmentWindow({ startDate: '2026-10-17', endDate: '2026-10-17' }, 'Europe/Madrid', new Date('2026-10-17T06:00:00Z'));
    if (!w.ok) throw new Error(w.error);
    expect(windowDays(w.window)).toEqual(['2026-10-17']);
    expect(w.window.closesAt).toBe('2026-10-17T19:00:00.000Z'); // Madrid CEST = UTC+2
    expect(windowPhase(w.window, new Date('2026-10-17T18:59:59Z'))).toBe('OPEN');
    expect(windowPhase(w.window, new Date('2026-10-17T19:00:00Z'))).toBe('CLOSED');
    expect(windowPhase(w.window, new Date('2026-10-16T21:59:59Z'))).toBe('NOT_OPEN');
  });

  it('a multi-day window is available on every calendar day, inclusive', () => {
    const w = buildAssignmentWindow({ startDate: '2026-10-30', endDate: '2026-11-02' }, 'America/Mexico_City', new Date('2026-10-01T00:00:00Z'));
    if (!w.ok) throw new Error(w.error);
    expect(windowDays(w.window)).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  });

  it('DST-safe: 21:00 local is computed with the offset in force on that day (Intl), never a fixed offset', () => {
    // New York: EDT (UTC-4) until 1 Nov 2026, EST (UTC-5) after
    expect(zonedWallTimeToUtc('2026-10-31', 21, 0, 'America/New_York').toISOString()).toBe('2026-11-01T01:00:00.000Z');
    expect(zonedWallTimeToUtc('2026-11-01', 21, 0, 'America/New_York').toISOString()).toBe('2026-11-02T02:00:00.000Z');
    // Madrid: CEST until 25 Oct 2026
    expect(zonedWallTimeToUtc('2026-10-24', 21, 0, 'Europe/Madrid').toISOString()).toBe('2026-10-24T19:00:00.000Z');
    expect(zonedWallTimeToUtc('2026-10-25', 21, 0, 'Europe/Madrid').toISOString()).toBe('2026-10-25T20:00:00.000Z');
    // midnight opening on a DST day (Sao Paulo has no DST in 2026; Santiago changes in spring)
    expect(zonedWallTimeToUtc('2026-10-25', 0, 0, 'Europe/Madrid').toISOString()).toBe('2026-10-24T22:00:00.000Z');
  });

  it('TIMEZONE_AUTHORITY_BLOCKER when the institution has no (valid) timezone -- never a default', () => {
    expect(buildAssignmentWindow({ startDate: '2026-10-17', endDate: '2026-10-17' }, null, T0)).toEqual({ ok: false, error: 'TIMEZONE_AUTHORITY_BLOCKER' });
    expect(buildAssignmentWindow({ startDate: '2026-10-17', endDate: '2026-10-17' }, 'Mars/Olympus', T0)).toEqual({ ok: false, error: 'TIMEZONE_AUTHORITY_BLOCKER' });
  });

  it('refuses invalid dates, an end before the start, and a window already closed', () => {
    expect(buildAssignmentWindow({ startDate: '2026-13-01', endDate: '2026-10-17' }, 'UTC', T0)).toEqual({ ok: false, error: 'WINDOW_DATES_INVALID' });
    expect(buildAssignmentWindow({ startDate: '2026-10-18', endDate: '2026-10-17' }, 'UTC', T0)).toEqual({ ok: false, error: 'WINDOW_END_BEFORE_START' });
    expect(buildAssignmentWindow({ startDate: '2026-10-16', endDate: '2026-10-16' }, 'UTC', T0)).toEqual({ ok: false, error: 'WINDOW_ALREADY_CLOSED' });
    // today before 21:00 is still valid
    expect(buildAssignmentWindow({ startDate: '2026-10-17', endDate: '2026-10-17' }, 'UTC', T0).ok).toBe(true);
  });
});

const win = { opensAt: '2026-10-17T05:00:00.000Z', closesAt: '2026-10-18T02:00:00.000Z' };
const done = (n: number, score: number, at: string): AttemptSummary => ({ attemptNumber: n, quizId: `q${n}`, state: 'COMPLETED', startedAt: at, completedAt: at, scorePercent: score, passed: score >= 80 });
const active = (n: number, lastActivityAt: string | null): AttemptSummary => ({ attemptNumber: n, quizId: `q${n}`, state: 'ACTIVE', startedAt: '2026-10-17T20:00:00Z', completedAt: null, scorePercent: null, passed: null, lastActivityAt });

describe('attempts (rules S, T, V)', () => {
  it('starts attempt 1, then n+1 while attempts remain; none is required', () => {
    expect(decideAttemptAction({ cancelled: false, window: win, maxAttempts: 2, attempts: [], now: T0 })).toEqual({ action: 'START', attemptNumber: 1 });
    expect(decideAttemptAction({ cancelled: false, window: win, maxAttempts: 2, attempts: [done(1, 40, '2026-10-17T10:00:00Z')], now: T0 })).toEqual({ action: 'START', attemptNumber: 2 });
    expect(decideAttemptAction({ cancelled: false, window: win, maxAttempts: 2, attempts: [done(1, 40, 'x'), done(2, 50, 'y')], now: T0 })).toEqual({ action: 'NONE', reason: 'ATTEMPTS_EXHAUSTED' });
  });

  it('retry after a pass is allowed', () => {
    expect(decideAttemptAction({ cancelled: false, window: win, maxAttempts: 3, attempts: [done(1, 100, '2026-10-17T10:00:00Z')], now: T0 })).toEqual({ action: 'START', attemptNumber: 2 });
  });

  it('the result is the LAST COMPLETED attempt -- a lower later score wins, not the best, not the average', () => {
    const a = [done(1, 100, '2026-10-17T10:00:00Z'), done(2, 50, '2026-10-17T11:00:00Z')];
    expect(latestCompletedAttempt(a)?.attemptNumber).toBe(2);
    expect(latestCompletedAttempt(a)?.scorePercent).toBe(50);
    expect(latestCompletedAttempt([...a, active(3, null)])?.attemptNumber).toBe(2);
    expect(latestCompletedAttempt([active(1, null)])).toBeNull();
  });

  it('resume before the close: the active attempt is resumed (no extra attempt), even after a long disconnect', () => {
    const d = decideAttemptAction({ cancelled: false, window: win, maxAttempts: 1, attempts: [active(1, '2026-10-17T08:00:00Z')], now: T0 });
    expect(d).toEqual({ action: 'RESUME', quizId: 'q1', attemptNumber: 1 });
  });

  it('after the close: a live session continues (may finish after 21:00); a left one cannot be resumed', () => {
    const after = new Date('2026-10-18T02:05:00Z');
    expect(decideAttemptAction({ cancelled: false, window: win, maxAttempts: 2, attempts: [active(1, '2026-10-18T02:04:30Z')], now: after })).toEqual({ action: 'RESUME', quizId: 'q1', attemptNumber: 1 });
    expect(decideAttemptAction({ cancelled: false, window: win, maxAttempts: 2, attempts: [active(1, '2026-10-18T01:59:00Z')], now: after })).toEqual({ action: 'NONE', reason: 'WINDOW_CLOSED_AFTER_EXIT' });
    expect(attemptContinuable(new Date(win.closesAt), new Date('2026-10-18T01:00:00Z'), new Date('2026-10-18T01:30:00Z'))).toEqual({ ok: true });
    expect(sessionAlive(new Date(after.getTime() - LIVENESS_WINDOW_SECONDS * 1000), after)).toBe(true);
    expect(sessionAlive(new Date(after.getTime() - LIVENESS_WINDOW_SECONDS * 1000 - 1), after)).toBe(false);
  });

  it('no new attempt after the close, nor before the opening; a cancelled assignment offers nothing', () => {
    expect(decideAttemptAction({ cancelled: false, window: win, maxAttempts: 3, attempts: [done(1, 40, 'x')], now: new Date('2026-10-18T02:00:00Z') })).toEqual({ action: 'NONE', reason: 'WINDOW_CLOSED' });
    expect(decideAttemptAction({ cancelled: false, window: win, maxAttempts: 3, attempts: [], now: new Date('2026-10-17T04:59:59Z') })).toEqual({ action: 'NONE', reason: 'NOT_OPEN_YET' });
    expect(decideAttemptAction({ cancelled: true, window: win, maxAttempts: 3, attempts: [], now: T0 })).toEqual({ action: 'NONE', reason: 'CANCELLED' });
  });

  it('effective status: ASSIGNED / IN_PROGRESS while retries remain / COMPLETED (exhausted or closed with a result) / EXPIRED (closed, no result)', () => {
    const s = (attempts: AttemptSummary[], now = T0, max = 2) => effectiveAssignmentStatus({ storedStatus: 'ASSIGNED', window: win, maxAttempts: max, attempts, now });
    expect(s([])).toBe('ASSIGNED');
    expect(s([active(1, null)])).toBe('IN_PROGRESS');
    expect(s([done(1, 90, 'x')])).toBe('IN_PROGRESS');
    expect(s([done(1, 90, 'x'), done(2, 60, 'y')])).toBe('COMPLETED');
    expect(s([done(1, 90, 'x')], new Date('2026-10-18T03:00:00Z'))).toBe('COMPLETED');
    expect(s([], new Date('2026-10-18T03:00:00Z'))).toBe('EXPIRED');
    expect(effectiveAssignmentStatus({ storedStatus: 'CANCELLED', window: win, maxAttempts: 1, attempts: [], now: T0 })).toBe('CANCELLED');
  });
});

describe('retry diversity -- controlled reuse order (rule T)', () => {
  it('own least-recently-used first, then the group\'s items, the previous attempt last', () => {
    const ranked = rankReuseCandidates(
      [{ fingerprint: 'prev' }, { fingerprint: 'group' }, { fingerprint: 'own-new' }, { fingerprint: 'own-old' }],
      { previousAttempt: new Set(['prev']), group: new Set(['group']), lastServedMs: new Map([['prev', 300], ['own-new', 200], ['own-old', 100]]) },
    );
    expect(ranked.map((r) => r.fingerprint)).toEqual(['own-old', 'own-new', 'group', 'prev']);
    expect(ranked.map((r) => r.source)).toEqual(['OWN_LEAST_RECENTLY_USED', 'OWN_LEAST_RECENTLY_USED', 'ASSIGNMENT_GROUP', 'PREVIOUS_ATTEMPT']);
  });
});

describe('feedback release (rule AB)', () => {
  it('shared items are the fingerprints served to two DIFFERENT students (own repeats do not count)', () => {
    expect(crossStudentSharedFingerprints([{ studentId: 'a', fingerprints: ['x', 'y'] }, { studentId: 'a', fingerprints: ['x'] }, { studentId: 'b', fingerprints: ['z'] }]).size).toBe(0);
    expect([...crossStudentSharedFingerprints([{ studentId: 'a', fingerprints: ['x', 'y'] }, { studentId: 'b', fingerprints: ['y'] }])]).toEqual(['y']);
  });
  it('diverse -> FULL now; shared -> SCORE_ONLY until the close; after the close -> FULL', () => {
    expect(feedbackReleaseFor({ sharedItemCount: 0, closesAt: win.closesAt, now: T0 })).toEqual({ level: 'FULL', reason: 'VERSIONS_DIVERSE' });
    expect(feedbackReleaseFor({ sharedItemCount: 2, closesAt: win.closesAt, now: T0 })).toEqual({ level: 'SCORE_ONLY', reason: 'SHARED_ITEMS_HELD_UNTIL_CLOSE', releaseAt: win.closesAt });
    expect(feedbackReleaseFor({ sharedItemCount: 2, closesAt: win.closesAt, now: new Date(win.closesAt) })).toEqual({ level: 'FULL', reason: 'WINDOW_CLOSED' });
  });
});

describe('group plan equivalence (rule N) and teacher inputs (rule M)', () => {
  const eligible = ['c1', 'c2', 'c3', 'c4'];
  const draft = { classId: 'k', kind: 'TEST' as const, conceptIds: ['c3', 'c1'], difficulty: 'INTERMEDIO' as const, startDate: '2026-10-17', endDate: '2026-10-18', maxAttempts: 3, timing: { timed: false, durationMinutes: null } };

  it('the plan is planGroupAssessment over the subject order -- never per-student, never the click order', () => {
    const r = buildGroupConfig(draft, { subjectId: 's', eligible, timezone: 'America/Bogota' }, T0);
    if (!r.ok) throw new Error(r.error);
    expect(r.config.conceptIds).toEqual(['c1', 'c3']);
    expect(r.config.plan).toEqual((({ questionCount, distribution, rule }) => ({ questionCount, distribution, rule }))(planGroupAssessment('TEST', ['c1', 'c3'], false)));
    expect(r.config.difficultyBand).toBe('MEDIUM');
    expect(r.config.allSubject).toBe(false);
  });

  it('the same plan re-keyed per learner keeps identical counts', () => {
    const plan = planGroupAssessment('MOCK', ['c1', 'c2', 'c3'], false);
    const a = planForLearner(plan, { c1: 'a1', c2: 'a2', c3: 'a3' });
    const b = planForLearner(plan, { c1: 'b1', c2: 'b2', c3: 'b3' });
    if (!a.ok || !b.ok) throw new Error('mapping');
    expect(plansEquivalent(a.plan, b.plan)).toBe(true);
    expect(a.plan.distribution).toEqual({ a1: 2, a2: 2, a3: 2 });
    expect(planForLearner(plan, { c1: 'a1' })).toEqual({ ok: false, missing: ['c2', 'c3'] });
  });

  it('difficulty labels map onto the existing governed bands only', () => {
    expect(UI_DIFFICULTY_TO_BAND).toEqual({ BASICO: 'LOW', INTERMEDIO: 'MEDIUM', AVANZADO: 'HIGH', MIXTO: 'MIXED' });
  });

  it('refuses: no concept, a concept outside the class subject, bad attempts, an untimed mock, a bad duration, no timezone', () => {
    const ctx = { subjectId: 's', eligible, timezone: 'UTC' };
    expect(buildGroupConfig({ ...draft, conceptIds: [] }, ctx, T0)).toEqual({ ok: false, error: 'NO_CONCEPTS_SELECTED' });
    expect(buildGroupConfig({ ...draft, conceptIds: ['zz'] }, ctx, T0)).toEqual({ ok: false, error: 'CONCEPT_NOT_IN_CLASS_SUBJECT' });
    expect(buildGroupConfig({ ...draft, maxAttempts: 0 }, ctx, T0)).toEqual({ ok: false, error: 'MAX_ATTEMPTS_INVALID' });
    expect(buildGroupConfig({ ...draft, kind: 'MOCK' }, ctx, T0)).toEqual({ ok: false, error: 'MOCK_MUST_BE_TIMED' });
    expect(buildGroupConfig({ ...draft, timing: { timed: true, durationMinutes: 0 } }, ctx, T0)).toEqual({ ok: false, error: 'DURATION_INVALID' });
    expect(buildGroupConfig(draft, { ...ctx, timezone: null }, T0)).toEqual({ ok: false, error: 'TIMEZONE_AUTHORITY_BLOCKER' });
    expect(validateTiming('TEST', { timed: false, durationMinutes: null })).toEqual({ ok: true });
  });

  it('MOCK: StudyUs recommended duration (nominal sum over the planned items) is the default; a teacher value is frozen as adjusted', () => {
    const rec = recommendedDurationForPlan(6, 'MEDIUM');
    expect(rec.minutes).toBe(12); // 6 planned open-response items x 120 s at difficulty 3
    const m = buildGroupConfig({ ...draft, kind: 'MOCK', conceptIds: ['c1', 'c2', 'c3'], timing: { timed: true, durationMinutes: null } }, { subjectId: 's', eligible, timezone: 'UTC' }, T0);
    if (!m.ok) throw new Error(m.error);
    expect(m.config.timing).toMatchObject({ timed: true, durationMinutes: 12, recommendedDurationMinutes: 12, durationSource: 'STUDYUS_RECOMMENDED' });
    const adj = buildGroupConfig({ ...draft, kind: 'MOCK', conceptIds: ['c1', 'c2', 'c3'], timing: { timed: true, durationMinutes: 20 } }, { subjectId: 's', eligible, timezone: 'UTC' }, T0);
    if (!adj.ok) throw new Error(adj.error);
    expect(adj.config.timing).toMatchObject({ durationMinutes: 20, recommendedDurationMinutes: 12, durationSource: 'TEACHER_ADJUSTED' });
  });

  it('TEST may be timed (teacher duration) or untimed', () => {
    const t = buildGroupConfig({ ...draft, timing: { timed: true, durationMinutes: 15 } }, { subjectId: 's', eligible, timezone: 'UTC' }, T0);
    if (!t.ok) throw new Error(t.error);
    expect(t.config.timing.durationMinutes).toBe(15);
    expect(t.config.feedbackPolicy).toBe('TEST_CORRECTNESS_ONLY');
  });
});

describe('group results', () => {
  it('distribution buckets (a reading aid, the 80 pass mark is the only rule) and pooled aggregates', () => {
    expect(resultDistribution([0, 59.9, 60, 79.9, 80, 100])).toEqual({ '0-59': 2, '60-79': 2, '80-100': 2 });
    const g = aggregateGroup([
      { studentId: 'a', scorePercent: 100, perConcept: [{ conceptKey: 'c1', total: 2, correct: 2, unanswered: 0 }, { conceptKey: 'c2', total: 2, correct: 2, unanswered: 0 }], items: [{ conceptKey: 'c1', questionKey: 'q', status: 'CORRECT' }] },
      { studentId: 'b', scorePercent: 50, perConcept: [{ conceptKey: 'c1', total: 2, correct: 2, unanswered: 0 }, { conceptKey: 'c2', total: 2, correct: 0, unanswered: 1 }], items: [{ conceptKey: 'c1', questionKey: 'q', status: 'INCORRECT' }] },
    ]);
    expect(g.averageScorePercent).toBe(75);
    expect(g.passedCount).toBe(1);
    expect(g.perConcept.find((c) => c.conceptKey === 'c2')?.scorePercent).toBe(50);
    expect(g.largestGaps).toEqual(['c2']);
    expect(g.strongestConcepts).toEqual(['c1']);
    expect(g.highErrorQuestions).toEqual([{ questionKey: 'q', conceptKey: 'c1', served: 2, wrong: 1, errorRate: 0.5 }]);
  });
});
