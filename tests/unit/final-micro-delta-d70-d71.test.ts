/**
 * FINAL MICRO-DELTA D69-D71 (APPROVED 2026-10-17) -- D70 teacher-assigned untimed Test inactivity resume and D71
 * timezone authority (pure rules + source pins). D69 is covered in subject-assessment-knowledge-bucket.test.ts; the
 * publish-path D70 / D71 cases in teacher-subject-assessment-service.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  decideAssignmentAttemptGate, resumeAfterInactivityApplies, validateResumeAfterInactivity, recipientTimezoneAuthority, recipientAssignmentWindow, ABANDONMENT_TOLERANCE_SECONDS,
} from '@/lib/teacher/subject-assessment-assignment.rules';
import { resolveTimezoneAuthority, SUBJECT_UNTIMED_INACTIVITY_MINUTES } from '@/lib/subject-assessment/lifecycle';
import { MESSAGES } from '@/lib/i18n/messages';
import { decideAttemptAction, latestCompletedAttempt, type AttemptSummary } from '@/lib/teacher/subject-assessment-assignment.rules';
import { subjectAssessmentScorePercent } from '@/lib/subject-assessment/sizing';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('D70 -- teacher-assigned untimed Test: resumeAfterInactivity', () => {
  it('exists only for a TEST that is untimed (never Mock, never timed Test)', () => {
    expect(resumeAfterInactivityApplies('TEST', false)).toBe(true);
    expect(resumeAfterInactivityApplies('TEST', true)).toBe(false);
    expect(resumeAfterInactivityApplies('MOCK', true)).toBe(false);
    expect(validateResumeAfterInactivity('MOCK', true, true)).toEqual({ ok: false, error: 'RESUME_AFTER_INACTIVITY_NOT_APPLICABLE' });
    expect(validateResumeAfterInactivity('TEST', true, true)).toEqual({ ok: false, error: 'RESUME_AFTER_INACTIVITY_NOT_APPLICABLE' });
    expect(validateResumeAfterInactivity('TEST', false, true)).toEqual({ ok: true, value: true });
  });
  it('DEFAULT = FALSE: absent / false freezes false', () => {
    expect(validateResumeAfterInactivity('TEST', false, undefined)).toEqual({ ok: true, value: false });
    expect(validateResumeAfterInactivity('MOCK', true, undefined)).toEqual({ ok: true, value: false });
    expect(validateResumeAfterInactivity('MOCK', true, false)).toEqual({ ok: true, value: false });
  });
  it('false: 45 min idle before the close -> CLOSE_AS_IS (saved progress kept, the same attempt never resumes)', () => {
    expect(SUBJECT_UNTIMED_INACTIVITY_MINUTES).toBe(45);
    expect(decideAssignmentAttemptGate({ state: 'EXPIRED', closed: false, resumeAfterInactivity: false, liveSession: false })).toBe('CLOSE_AS_IS');
  });
  it('true: 45 min idle before the close -> REVIVE (the same attempt, saved answers kept)', () => {
    expect(decideAssignmentAttemptGate({ state: 'EXPIRED', closed: false, resumeAfterInactivity: true, liveSession: false })).toBe('REVIVE');
  });
  it('true NEVER overrides the post-21:00 rule: after the close an idle / left attempt cannot resume', () => {
    expect(decideAssignmentAttemptGate({ state: 'EXPIRED', closed: true, resumeAfterInactivity: true, liveSession: false })).toBe('CLOSE_AS_IS');
    expect(decideAssignmentAttemptGate({ state: 'ACTIVE', closed: true, resumeAfterInactivity: true, liveSession: false })).toBe('CLOSE_AS_IS');
    // an attempt still live in its session continues after 21:00 (abandonment tolerance unchanged)
    expect(decideAssignmentAttemptGate({ state: 'ACTIVE', closed: true, resumeAfterInactivity: false, liveSession: true })).toBe('OK');
    expect(ABANDONMENT_TOLERANCE_SECONDS).toBe(180);
  });
  it('active before the close, completed, time-up: untouched', () => {
    for (const r of [true, false]) {
      expect(decideAssignmentAttemptGate({ state: 'ACTIVE', closed: false, resumeAfterInactivity: r, liveSession: false })).toBe('OK');
      expect(decideAssignmentAttemptGate({ state: 'COMPLETED', closed: false, resumeAfterInactivity: r, liveSession: false })).toBe('OK');
      expect(decideAssignmentAttemptGate({ state: 'TIME_UP', closed: true, resumeAfterInactivity: r, liveSession: false })).toBe('OK');
    }
  });
  it('the session gate is the only consumer, and a Student-created attempt never reaches it (origin TEACHER only)', () => {
    const svc = src('src/services/subject-assessment.service.ts');
    expect(svc).toMatch(/if \(setup\.origin !== 'TEACHER' \|\| !setup\.assignmentWindow \|\| !setup\.timing\.startedAt\) return 'OK';/);
    expect(svc).toMatch(/decideAssignmentAttemptGate\(\{ state, closed, resumeAfterInactivity/);
    // the frozen flag goes to the session only for an untimed Test
    expect(src('src/lib/teacher/subject-assessment-assignment.service.ts')).toMatch(/resumeAfterInactivity: row\.config\.timing\.resumeAfterInactivity === true && resumeAfterInactivityApplies\(row\.config\.kind, row\.config\.timing\.timed\)/);
  });
  it('the composer shows it only for an untimed Test; copy in every locale', () => {
    expect(src('src/app/dashboard/teacher/classes/[classId]/SubjectAssessmentComposer.tsx')).toMatch(/\{kind === 'TEST' && !isTimed && \(\s*<label className="ta-choice" data-testid="tsa-resume-after-inactivity">/);
    for (const [locale, m] of Object.entries(MESSAGES)) {
      expect((m as Record<string, string>)['tsa.resumeAfterInactivity'], locale).toBeTruthy();
      expect((m as Record<string, string>)['tsa.resumeAfterInactivityHint'], locale).toBeTruthy();
    }
  });
});

describe('D71 -- timezone authority', () => {
  const now = new Date('2026-10-17T12:00:00Z');
  it('student timezone beats the institution timezone', () => {
    expect(resolveTimezoneAuthority('Europe/Madrid', ['America/Bogota'])).toEqual({ ok: true, timezone: 'Europe/Madrid', source: 'STUDENT_AVAILABILITY' });
    expect(recipientTimezoneAuthority('Europe/Madrid', 'America/Bogota')).toMatchObject({ ok: true, timezone: 'Europe/Madrid' });
    const w = recipientAssignmentWindow({ startDate: '2026-10-17', endDate: '2026-10-18' }, recipientTimezoneAuthority('Europe/Madrid', 'America/Bogota'), now);
    expect(w).toMatchObject({ ok: true, window: { timezone: 'Europe/Madrid', timezoneSource: 'STUDENT_AVAILABILITY', closesAt: '2026-10-18T19:00:00.000Z' } });
  });
  it('institution fallback when the student has none', () => {
    expect(resolveTimezoneAuthority(null, ['America/Bogota'])).toEqual({ ok: true, timezone: 'America/Bogota', source: 'INSTITUTION' });
    const w = recipientAssignmentWindow({ startDate: '2026-10-17', endDate: '2026-10-18' }, recipientTimezoneAuthority(null, 'America/Bogota'), now);
    expect(w).toMatchObject({ ok: true, window: { timezone: 'America/Bogota', timezoneSource: 'INSTITUTION', closesAt: '2026-10-19T02:00:00.000Z' } });
  });
  it('no timezone at all -> TIMEZONE_AUTHORITY_BLOCKER', () => {
    expect(resolveTimezoneAuthority(null, [])).toMatchObject({ ok: false, error: 'TIMEZONE_AUTHORITY_BLOCKER', reason: 'NO_TIMEZONE_AUTHORITY' });
    expect(recipientTimezoneAuthority(null, null)).toMatchObject({ ok: false, error: 'TIMEZONE_AUTHORITY_BLOCKER' });
    expect(recipientAssignmentWindow({ startDate: '2026-10-17', endDate: '2026-10-18' }, recipientTimezoneAuthority(null, null), now)).toEqual({ ok: false, error: 'TIMEZONE_AUTHORITY_BLOCKER' });
    // an invalid zone is no authority either
    expect(resolveTimezoneAuthority('Not/AZone', ['Also/Not'])).toMatchObject({ ok: false, error: 'TIMEZONE_AUTHORITY_BLOCKER' });
  });
  it('conflicting institutions without a student timezone -> blocker (never a choice)', () => {
    expect(resolveTimezoneAuthority(null, ['America/Bogota', 'America/Mexico_City'])).toMatchObject({ ok: false, error: 'TIMEZONE_AUTHORITY_BLOCKER', reason: 'INSTITUTION_TIMEZONES_CONFLICT' });
    // with the student timezone the conflict does not matter
    expect(resolveTimezoneAuthority('America/Lima', ['America/Bogota', 'America/Mexico_City'])).toMatchObject({ ok: true, timezone: 'America/Lima' });
  });
  it('no browser / server timezone fallback, and the QA fixture zone is never a product default', () => {
    for (const f of ['src/lib/subject-assessment/lifecycle.ts', 'src/services/subject-assessment.service.ts', 'src/lib/teacher/subject-assessment-assignment.rules.ts', 'src/lib/teacher/subject-assessment-assignment.service.ts']) {
      const code = src(f);
      expect(code, f).not.toMatch(/Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone/);
      // legacy values may only be READ (rows frozen before 2026-10-17); nothing assigns or returns them
      expect(code, f).not.toMatch(/(=|:|\?|return)\s*'(BROWSER_ASSUMED|DEFAULT_UTC_ASSUMED)'/);
      expect(code, f).not.toMatch(/browserTimezone/);
      expect(code, f).not.toMatch(/process\.env\.TZ/);
      expect(code, f).not.toMatch(/'America\/Mexico_City'/);
    }
    expect(src('src/app/dashboard/quiz/page.tsx')).not.toMatch(/resolvedOptions\(\)\.timeZone/);
  });
});

describe('D72 -- INACTIVITY_CLOSED is a completed attempt (untimed Teacher Test, resumeAfterInactivity false)', () => {
  const window = { opensAt: '2026-10-17T05:00:00.000Z', closesAt: '2026-10-19T02:00:00.000Z' };
  const now = new Date('2026-10-17T18:00:00Z');
  const closed: AttemptSummary = { attemptNumber: 1, quizId: 'q1', state: 'COMPLETED', startedAt: '2026-10-17T16:00:00Z', completedAt: '2026-10-17T16:50:00Z', scorePercent: 60, passed: false, completionReason: 'INACTIVITY_CLOSED' };
  it('D72_CLOSE_REASON: the idle-expired attempt before the close is closed as is with INACTIVITY_CLOSED', () => {
    expect(decideAssignmentAttemptGate({ state: 'EXPIRED', closed: false, resumeAfterInactivity: false, liveSession: false })).toBe('CLOSE_AS_IS');
    const svc = src('src/services/subject-assessment.service.ts');
    expect(svc).toMatch(/closedAsIs \? \(inactivityClose\(setup, state, now\) \? 'INACTIVITY_CLOSED' : 'WINDOW_CLOSED_AFTER_EXIT'\)/);
    expect(svc).toMatch(/return state === 'EXPIRED' && !!setup\.assignmentWindow && now\.getTime\(\) < new Date\(setup\.assignmentWindow\.closesAt\)\.getTime\(\);/);
  });
  it('D72_SCORE_SAVED_RESPONSES + D72_UNANSWERED_DENOMINATOR: 12 correct, 3 incorrect, 5 unanswered of 20 = 60%', () => {
    expect(subjectAssessmentScorePercent(12, 20)).toBe(60);
    // the closing submit grades the SAVED responses only and scores over the frozen total (unanswered stay in it)
    const svc = src('src/services/subject-assessment.service.ts');
    expect(svc).toMatch(/const closedAsIs = gate === 'CLOSE_AS_IS';/);
    expect(svc).toMatch(/const saved = await savedResponses\(input\.quizId\);/);
  });
  it('D72_ATTEMPT_CONSUMED: the closed attempt counts against maxAttempts; it is the result when it is the last completed', () => {
    expect(decideAttemptAction({ cancelled: false, window, maxAttempts: 1, attempts: [closed], now })).toEqual({ action: 'NONE', reason: 'ATTEMPTS_EXHAUSTED' });
    expect(latestCompletedAttempt([closed])).toBe(closed);
  });
  it('D72_NEW_ATTEMPT_IF_AVAILABLE: with attempts left a NEW attempt starts (attempt 2)', () => {
    expect(decideAttemptAction({ cancelled: false, window, maxAttempts: 2, attempts: [closed], now })).toEqual({ action: 'START', attemptNumber: 2 });
  });
  it('D72_SAME_ATTEMPT_NO_RESUME: a COMPLETED attempt is never resumed', () => {
    const d = decideAttemptAction({ cancelled: false, window, maxAttempts: 3, attempts: [closed], now });
    expect(d.action).not.toBe('RESUME');
    // TRUE keeps its behaviour: revive before the close only, never after it
    expect(decideAssignmentAttemptGate({ state: 'EXPIRED', closed: false, resumeAfterInactivity: true, liveSession: false })).toBe('REVIVE');
    expect(decideAssignmentAttemptGate({ state: 'EXPIRED', closed: true, resumeAfterInactivity: true, liveSession: false })).toBe('CLOSE_AS_IS');
  });
});

describe('D73 -- pre-publication timezone validation (teacher-facing)', () => {
  it('the service validates every intended recipient BEFORE any write and never publishes partially', () => {
    const svc = src('src/lib/teacher/subject-assessment-assignment.service.ts');
    const validate = svc.indexOf("reason: 'INVALID_TIMEZONE_RECIPIENT'");
    expect(validate).toBeGreaterThan(0);
    expect(validate).toBeLessThan(svc.indexOf('await ensureConceptInLearnerPlan('));
    expect(validate).toBeLessThan(svc.indexOf('await assignTeacherIntervention('));
  });
  it('the API returns the structured result; the composer lists the students by NAME (no internal ids shown)', () => {
    expect(src('src/app/api/teacher/classes/[classId]/subject-assessments/_shared.ts')).toMatch(/invalidRecipientCount: error\.detail\.invalidRecipientCount, invalidRecipients: error\.detail\.invalidRecipients/);
    const ui = src('src/app/dashboard/teacher/classes/[classId]/SubjectAssessmentComposer.tsx');
    expect(ui).toMatch(/names: body\.invalidRecipients\.map\(\(r: \{ name: string \}\) => r\.name\)/);
    expect(ui).toMatch(/data-testid="tsa-invalid-timezone-recipients">\{message\.names\.map\(\(n, i\) => <li key=\{i\}>\{n\}<\/li>\)\}/);
    expect((MESSAGES.es as Record<string, string>)['tsa.err.timezoneRecipients']).toMatch(/^No se puede publicar todavía\. \{n\} estudiante/);
    for (const [locale, m] of Object.entries(MESSAGES)) {
      expect((m as Record<string, string>)['tsa.err.timezoneRecipients'], locale).toMatch(/\{n\}/);
      expect((m as Record<string, string>)['tsa.err.timezoneRecipientsFix'], locale).toBeTruthy();
    }
  });
  it('composer / preview without any valid reference shows a configuration message (never the browser / server zone)', () => {
    const ui = src('src/app/dashboard/teacher/classes/[classId]/SubjectAssessmentComposer.tsx');
    expect(ui).toMatch(/data-code="TIMEZONE_AUTHORITY_BLOCKER">\{t\['tsa\.timezoneBlocker'\]\}/);
    expect(ui).not.toMatch(/resolvedOptions\(\)\.timeZone/);
  });
});
