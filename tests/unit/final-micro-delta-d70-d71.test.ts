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
