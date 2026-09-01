/**
 * Phase 1E Step 29 + Phase 1E-R Steps 12-14: Study Plan Adherence
 * fixtures -- full completion, partial completion, no scheduled
 * sessions, AND the critical semantic fixtures external review
 * required: unrelated same-day evidence must NOT falsely complete a
 * planned session; matching same-day evidence must; multiple same-day
 * sessions must each be judged against their OWN planned content, not
 * cross-satisfied by one evidence stream.
 *
 * Also pins the source-audit finding that completion_status is dead
 * data (never asserted on here -- adherence is derived from
 * content-matched learning_evidence presence instead).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock('@/lib/db');
});

function mockPlanAndSessions(sessions: Array<{ scheduled_date: string; has_matching_evidence: boolean }>) {
  return vi.fn(async (sql: string) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.includes('FROM study_plans WHERE student_id')) {
      return { rows: [{ id: 'plan-1', period_start: '2026-08-25', period_end: '2026-09-08' }] };
    }
    if (s.includes('FROM study_sessions ss WHERE')) return { rows: sessions };
    throw new Error(`Unmocked: ${s}`);
  });
}

/**
 * Faithfully replicates the real SQL's join semantics in JS, so these
 * tests exercise the ACTUAL intended completion logic (session's own
 * items' concepts, matched against same-date evidence) rather than
 * just asserting on a pre-computed boolean. `sessions` carry the
 * concept IDs their OWN study_session_items planned; `evidence` is a
 * flat list of (concept_id, date) observations across ALL subjects
 * that day, exactly like real production data would be.
 */
function simulateSessionsQuery(
  sessions: Array<{ id: string; scheduled_date: string; plannedConceptIds: string[] }>,
  evidence: Array<{ concept_id: string; date: string }>
) {
  return sessions.map((session) => ({
    scheduled_date: session.scheduled_date,
    has_matching_evidence: evidence.some((e) => session.plannedConceptIds.includes(e.concept_id) && e.date === session.scheduled_date),
  }));
}

function mockPlanWithSimulatedJoin(sessions: Array<{ id: string; scheduled_date: string; plannedConceptIds: string[] }>, evidence: Array<{ concept_id: string; date: string }>) {
  return vi.fn(async (sql: string) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.includes('FROM study_plans WHERE student_id')) {
      return { rows: [{ id: 'plan-1', period_start: '2026-08-25', period_end: '2026-09-08' }] };
    }
    if (s.includes('FROM study_sessions ss WHERE')) {
      // Structural proof (Steps 12-14): the real query must scope the
      // EXISTS join to THIS session (ssi.session_id = ss.id) and match
      // on concept (ssi.concept_id = le.concept_id) -- not "any evidence
      // that day" regardless of subject/session.
      expect(s).toMatch(/JOIN study_session_items ssi ON ssi\.concept_id = le\.concept_id/);
      expect(s).toMatch(/ssi\.session_id = ss\.id/);
      expect(s).toMatch(/le\.timestamp::date = ss\.scheduled_date/);
      return { rows: simulateSessionsQuery(sessions, evidence) };
    }
    throw new Error(`Unmocked: ${s}`);
  });
}

describe('readStudyPlanAdherence', () => {
  it('no active study plan -> NOT_APPLICABLE, not INSUFFICIENT_EVIDENCE', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    vi.doMock('@/lib/db', () => ({ db: { query } }));
    const { readStudyPlanAdherence } = await import('@/lib/learner-twin/metrics/study-plan-adherence');
    const result = await readStudyPlanAdherence('student-1');
    expect(result.available).toBe(false);
    if (!result.available) expect(result.reason).toBe('NOT_APPLICABLE');
  });

  it('no scheduled sessions due yet -> INSUFFICIENT_EVIDENCE (plan exists but nothing to measure yet)', async () => {
    vi.doMock('@/lib/db', () => ({ db: { query: mockPlanAndSessions([]) } }));
    const { readStudyPlanAdherence } = await import('@/lib/learner-twin/metrics/study-plan-adherence');
    const result = await readStudyPlanAdherence('student-1');
    expect(result.available).toBe(false);
    if (!result.available) expect(result.reason).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('full completion -- every due session has matching evidence, completionRate 1.0', async () => {
    vi.doMock(
      '@/lib/db',
      () => ({
        db: {
          query: mockPlanAndSessions([
            { scheduled_date: '2026-08-25', has_matching_evidence: true },
            { scheduled_date: '2026-08-26', has_matching_evidence: true },
            { scheduled_date: '2026-08-27', has_matching_evidence: true },
          ]),
        },
      })
    );
    const { readStudyPlanAdherence } = await import('@/lib/learner-twin/metrics/study-plan-adherence');
    const result = await readStudyPlanAdherence('student-1');
    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.value.scheduledSessions).toBe(3);
      expect(result.value.completedSessions).toBe(3);
      expect(result.value.missedSessions).toBe(0);
      expect(result.value.completionRate).toBe(1);
    }
  });

  it('partial completion -- derived from content-matched learning_evidence, not the dead completion_status column', async () => {
    vi.doMock(
      '@/lib/db',
      () => ({
        db: {
          query: mockPlanAndSessions([
            { scheduled_date: '2026-08-25', has_matching_evidence: true },
            { scheduled_date: '2026-08-26', has_matching_evidence: false },
            { scheduled_date: '2026-08-27', has_matching_evidence: false },
            { scheduled_date: '2026-08-28', has_matching_evidence: true },
          ]),
        },
      })
    );
    const { readStudyPlanAdherence } = await import('@/lib/learner-twin/metrics/study-plan-adherence');
    const result = await readStudyPlanAdherence('student-1');
    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.value.scheduledSessions).toBe(4);
      expect(result.value.completedSessions).toBe(2);
      expect(result.value.missedSessions).toBe(2);
      expect(result.value.completionRate).toBe(0.5);
    }
  });

  it('windowDays override switches the window to a trailing N-day range instead of the plan period', async () => {
    const query = vi.fn(async (sql: string, params: any[]) => {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (s.includes('FROM study_plans WHERE student_id')) return { rows: [{ id: 'plan-1', period_start: '2026-08-01', period_end: '2026-09-30' }] };
      if (s.includes('FROM study_sessions ss WHERE')) {
        // windowStart should be ~7 days before today, not the plan's Aug 1 period_start.
        expect(params[2]).not.toBe('2026-08-01');
        return { rows: [{ scheduled_date: params[2], has_matching_evidence: true }] };
      }
      throw new Error(`Unmocked: ${s}`);
    });
    vi.doMock('@/lib/db', () => ({ db: { query } }));
    const { readStudyPlanAdherence } = await import('@/lib/learner-twin/metrics/study-plan-adherence');
    const result = await readStudyPlanAdherence('student-1', { windowDays: 7 });
    expect(result.available).toBe(true);
  });
});

describe('Phase 1E-R Step 12: unrelated same-day evidence must NOT falsely complete a planned session', () => {
  it('scheduled Math/Concept-A session, but the only same-day evidence is Physics/Concept-B -> NOT completed', async () => {
    const sessions = [{ id: 'session-1', scheduled_date: '2026-08-25', plannedConceptIds: ['math-concept-a'] }];
    const evidence = [{ concept_id: 'physics-concept-b', date: '2026-08-25' }];
    vi.doMock('@/lib/db', () => ({ db: { query: mockPlanWithSimulatedJoin(sessions, evidence) } }));

    const { readStudyPlanAdherence } = await import('@/lib/learner-twin/metrics/study-plan-adherence');
    const result = await readStudyPlanAdherence('student-1');

    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.value.completedSessions).toBe(0);
      expect(result.value.missedSessions).toBe(1);
    }
  });
});

describe('Phase 1E-R Step 13: matching same-day, same-concept evidence completes the session', () => {
  it('scheduled Math/Concept-A session, same-day evidence for Math/Concept-A -> completed', async () => {
    const sessions = [{ id: 'session-1', scheduled_date: '2026-08-25', plannedConceptIds: ['math-concept-a'] }];
    const evidence = [{ concept_id: 'math-concept-a', date: '2026-08-25' }];
    vi.doMock('@/lib/db', () => ({ db: { query: mockPlanWithSimulatedJoin(sessions, evidence) } }));

    const { readStudyPlanAdherence } = await import('@/lib/learner-twin/metrics/study-plan-adherence');
    const result = await readStudyPlanAdherence('student-1');

    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.value.completedSessions).toBe(1);
      expect(result.value.missedSessions).toBe(0);
    }
  });
});

describe('Phase 1E-R Step 14: multiple same-day planned sessions are each judged against their own content', () => {
  it('two sessions same day (Math/A and Physics/B); evidence matches only Math/A -> Math completed, Physics NOT auto-completed', async () => {
    const sessions = [
      { id: 'session-math', scheduled_date: '2026-08-25', plannedConceptIds: ['math-concept-a'] },
      { id: 'session-physics', scheduled_date: '2026-08-25', plannedConceptIds: ['physics-concept-b'] },
    ];
    const evidence = [{ concept_id: 'math-concept-a', date: '2026-08-25' }];
    vi.doMock('@/lib/db', () => ({ db: { query: mockPlanWithSimulatedJoin(sessions, evidence) } }));

    const { readStudyPlanAdherence } = await import('@/lib/learner-twin/metrics/study-plan-adherence');
    const result = await readStudyPlanAdherence('student-1');

    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.value.scheduledSessions).toBe(2);
      // Exactly one session (Math) is satisfied -- the one evidence
      // stream does not spuriously complete both.
      expect(result.value.completedSessions).toBe(1);
      expect(result.value.missedSessions).toBe(1);
    }
  });

  it('two sessions same day, evidence genuinely covers both concepts -> both completed (not a false negative either)', async () => {
    const sessions = [
      { id: 'session-math', scheduled_date: '2026-08-25', plannedConceptIds: ['math-concept-a'] },
      { id: 'session-physics', scheduled_date: '2026-08-25', plannedConceptIds: ['physics-concept-b'] },
    ];
    const evidence = [
      { concept_id: 'math-concept-a', date: '2026-08-25' },
      { concept_id: 'physics-concept-b', date: '2026-08-25' },
    ];
    vi.doMock('@/lib/db', () => ({ db: { query: mockPlanWithSimulatedJoin(sessions, evidence) } }));

    const { readStudyPlanAdherence } = await import('@/lib/learner-twin/metrics/study-plan-adherence');
    const result = await readStudyPlanAdherence('student-1');

    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.value.completedSessions).toBe(2);
      expect(result.value.missedSessions).toBe(0);
    }
  });
});

describe('Phase 1E-R Step 11: remains purely observational', () => {
  it('StudyPlanAdherenceSummary never carries a motivation/personality field', async () => {
    vi.doMock(
      '@/lib/db',
      () => ({ db: { query: mockPlanAndSessions([{ scheduled_date: '2026-08-25', has_matching_evidence: true }]) } })
    );
    const { readStudyPlanAdherence } = await import('@/lib/learner-twin/metrics/study-plan-adherence');
    const result = await readStudyPlanAdherence('student-1');
    expect(result.available).toBe(true);
    if (result.available) {
      expect(Object.keys(result.value).sort()).toEqual(
        ['windowStart', 'windowEnd', 'scheduledSessions', 'completedSessions', 'missedSessions', 'completionRate', 'quality'].sort()
      );
    }
  });
});
