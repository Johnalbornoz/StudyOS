import { describe, it, expect, vi, beforeEach } from 'vitest';

// P0-A.1 requirement 3: VALIDATION_DEADLINE_OVERDUE must be proven reachable
// through the REAL validation-cycle.service <-> learning-scheduler.service
// interaction, not just by mocking an impossible service response. Every
// other learning-scheduler test mocks '@/services/validation-cycle.service'
// wholesale, which would make this assertion vacuous (it would pass even if
// getValidationDeadlines still resolved-and-filtered overdue cycles away).
// This file mocks only the DB layer both real services actually sit on top
// of, so the fix in getValidationDeadlines (a direct, non-resolving SELECT)
// is what's actually under test.

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...args: any[]) => queryMock(...args) } }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));
vi.mock('@/services/assessment.service', () => ({ getUpcomingForStudent: vi.fn().mockResolvedValue([]) }));

import { getDueItems } from '@/services/learning-scheduler.service';

function daysFromNow(n: number): string {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString();
}

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockImplementation(async (sql: string) => {
    if (/FROM validation_cycles WHERE student_id = \$1 AND status = 'OPEN'/.test(sql)) {
      return { rows: [{ concept_id: 'overdue-concept', validation_deadline: daysFromNow(-3) }] };
    }
    return { rows: [] }; // concept_knowledge_state (AT_RISK/INTERVENTION_REQUIRED), mastery_records, remediation_paths
  });
});

describe('P0-A.1 integration. VALIDATION_DEADLINE_OVERDUE is reachable end-to-end through the real services', () => {
  it('an OPEN validation cycle with a past deadline, sitting in the real DB layer, surfaces as VALIDATION_DEADLINE_OVERDUE via the real getValidationDeadlines -> getDueItems path', async () => {
    const items = await getDueItems('s1');

    const overdue = items.find((i) => i.type === 'VALIDATION_DEADLINE_OVERDUE');
    expect(overdue).toMatchObject({ conceptId: 'overdue-concept', urgency: 'CRITICAL' });
  });

  it('the real getValidationDeadlines never issues an UPDATE while the Scheduler reads it -- the overdue cycle stays OPEN in the DB, available for the Knowledge Projector to resolve properly', async () => {
    await getDueItems('s1');

    expect(queryMock.mock.calls.some((c) => /UPDATE validation_cycles/i.test(String(c[0])))).toBe(false);
  });
});
