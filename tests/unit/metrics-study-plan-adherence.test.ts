/**
 * Phase 8 -- Step 8H1: Study Plan Adherence migrated to the canonical
 * `learning_plan` / `learning_plan_item` source.
 *
 *  - denominator = due plan items in the window, EXCLUDING auto-SUPERSEDED
 *  - numerator   = COMPLETED, or canonical learning_evidence for the
 *                  item's concept on/after its scheduled date (the SQL's
 *                  `completed` expression models exactly that)
 *  - model version bumped to v2
 *  - still purely observational (no motivation / personality field)
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock('@/lib/db');
});

/** rows: one per non-superseded due plan item, `completed` = the SQL boolean. */
function mockPlanAndItems(rows: Array<{ completed: boolean }>, plan: any = { id: 'plan-1', horizon_start: '2026-08-25', horizon_end: '2026-09-08' }) {
  return vi.fn(async (sql: string) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.includes("FROM learning_plan WHERE student_id") && s.includes("status = 'ACTIVE'")) {
      return { rows: plan ? [plan] : [] };
    }
    if (s.includes('FROM learning_plan_item lpi')) {
      // structural proof: excludes SUPERSEDED, and the completed expr is
      // canonical-evidence-derived.
      expect(s).toMatch(/lpi\.status <> 'SUPERSEDED'/);
      expect(s).toMatch(/lpi\.status = 'COMPLETED'/);
      expect(s).toMatch(/FROM learning_evidence le/);
      return { rows };
    }
    throw new Error(`Unmocked: ${s}`);
  });
}

describe('readStudyPlanAdherence (8H1 canonical source)', () => {
  it('no active learning plan -> NOT_APPLICABLE', async () => {
    vi.doMock('@/lib/db', () => ({ db: { query: vi.fn(async () => ({ rows: [] })) } }));
    const { readStudyPlanAdherence } = await import('@/lib/learner-twin/metrics/study-plan-adherence');
    const r = await readStudyPlanAdherence('student-1');
    expect(r.available).toBe(false);
    if (!r.available) expect(r.reason).toBe('NOT_APPLICABLE');
  });

  it('plan exists but no due items in the window -> INSUFFICIENT_EVIDENCE', async () => {
    vi.doMock('@/lib/db', () => ({ db: { query: mockPlanAndItems([]) } }));
    const { readStudyPlanAdherence } = await import('@/lib/learner-twin/metrics/study-plan-adherence');
    const r = await readStudyPlanAdherence('student-1');
    expect(r.available).toBe(false);
    if (!r.available) expect(r.reason).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('full completion -> completionRate 1.0, model version v2', async () => {
    vi.doMock('@/lib/db', () => ({ db: { query: mockPlanAndItems([{ completed: true }, { completed: true }, { completed: true }]) } }));
    const { readStudyPlanAdherence } = await import('@/lib/learner-twin/metrics/study-plan-adherence');
    const r = await readStudyPlanAdherence('student-1');
    expect(r.available).toBe(true);
    if (r.available) {
      expect(r.value.scheduledSessions).toBe(3);
      expect(r.value.completedSessions).toBe(3);
      expect(r.value.missedSessions).toBe(0);
      expect(r.value.completionRate).toBe(1);
      expect(r.value.quality.modelVersion).toBe('v2');
    }
  });

  it('partial completion -> numerator and denominator both reported', async () => {
    vi.doMock('@/lib/db', () => ({ db: { query: mockPlanAndItems([{ completed: true }, { completed: false }, { completed: false }, { completed: true }]) } }));
    const { readStudyPlanAdherence } = await import('@/lib/learner-twin/metrics/study-plan-adherence');
    const r = await readStudyPlanAdherence('student-1');
    expect(r.available).toBe(true);
    if (r.available) {
      expect(r.value.scheduledSessions).toBe(4);
      expect(r.value.completedSessions).toBe(2);
      expect(r.value.missedSessions).toBe(2);
      expect(r.value.completionRate).toBe(0.5);
    }
  });

  it('windowDays override moves the window start off the plan horizon_start', async () => {
    const query = vi.fn(async (sql: string, params: any[]) => {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (s.includes("FROM learning_plan WHERE student_id")) return { rows: [{ id: 'plan-1', horizon_start: '2026-08-01', horizon_end: '2026-09-30' }] };
      if (s.includes('FROM learning_plan_item lpi')) {
        expect(params[1]).not.toBe('2026-08-01'); // windowStart is ~7d before today
        return { rows: [{ completed: true }] };
      }
      throw new Error(`Unmocked: ${s}`);
    });
    vi.doMock('@/lib/db', () => ({ db: { query } }));
    const { readStudyPlanAdherence } = await import('@/lib/learner-twin/metrics/study-plan-adherence');
    const r = await readStudyPlanAdherence('student-1', { windowDays: 7 });
    expect(r.available).toBe(true);
  });

  it('remains purely observational -- no motivation / personality field', async () => {
    vi.doMock('@/lib/db', () => ({ db: { query: mockPlanAndItems([{ completed: true }]) } }));
    const { readStudyPlanAdherence } = await import('@/lib/learner-twin/metrics/study-plan-adherence');
    const r = await readStudyPlanAdherence('student-1');
    expect(r.available).toBe(true);
    if (r.available) {
      expect(Object.keys(r.value).sort()).toEqual(
        ['windowStart', 'windowEnd', 'scheduledSessions', 'completedSessions', 'missedSessions', 'completionRate', 'quality'].sort(),
      );
    }
  });
});
