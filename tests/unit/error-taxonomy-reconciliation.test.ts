/**
 * Phase 2F: Error Taxonomy Reconciliation.
 *
 * `ErrorType` (error-intelligence.service.ts, 5 values) is canonical --
 * every reader (cognitive-diagnosis.service.ts's root-cause recurrence
 * count, error-intelligence's own pattern-meaning lookup) is written
 * against it. `GradingErrorType` (quiz-generation.service.ts, 7 values
 * -- the canonical 5 plus ARITHMETIC/UNIT) is grading's own, more
 * specific classification. `toCanonicalErrorType` is the one adapter
 * boundary; both `errors` table writers apply it before persisting, so
 * a non-canonical value can never reach the table the diagnosis engine
 * reads (closing a real, live production leak this phase found: 2
 * ARITHMETIC rows already existed before this fix).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...args: any[]) => queryMock(...args) } }));

import { toCanonicalErrorType, recordError } from '@/services/error-intelligence.service';

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [] });
});

describe('toCanonicalErrorType -- the one adapter boundary', () => {
  it('the 5 canonical values pass through unchanged', () => {
    for (const t of ['CONCEPTUAL', 'PROCEDURAL', 'CARELESS', 'INCOMPLETE', 'MISREADING'] as const) {
      expect(toCanonicalErrorType(t)).toBe(t);
    }
  });

  it('ARITHMETIC maps to CARELESS -- CARELESS\'s own stated definition already names arithmetic slips', () => {
    expect(toCanonicalErrorType('ARITHMETIC')).toBe('CARELESS');
  });

  it('UNIT maps to PROCEDURAL -- a unit-conversion slip is a procedural-step omission, not a random error', () => {
    expect(toCanonicalErrorType('UNIT')).toBe('PROCEDURAL');
  });

  it('a genuinely unrecognized future value falls back to CARELESS (the most conservative bucket), never throws', () => {
    expect(toCanonicalErrorType('SOMETHING_NEW_NOT_YET_CLASSIFIED')).toBe('CARELESS');
  });
});

describe('recordError -- canonicalizes before every INSERT INTO errors', () => {
  it('a canonical error_type is persisted unchanged', async () => {
    await recordError({ studentId: 's1', conceptId: 'c1', subjectId: 'subj1', errorType: 'CONCEPTUAL', sourceType: 'quiz' });
    expect(queryMock.mock.calls[0][1][3]).toBe('CONCEPTUAL');
  });

  it('a GradingErrorType-only value (ARITHMETIC) is mapped to CARELESS before it ever reaches the errors table', async () => {
    await recordError({ studentId: 's1', conceptId: 'c1', subjectId: 'subj1', errorType: 'ARITHMETIC', sourceType: 'quiz' });
    expect(queryMock.mock.calls[0][1][3]).toBe('CARELESS');
  });

  it('a GradingErrorType-only value (UNIT) is mapped to PROCEDURAL before it ever reaches the errors table', async () => {
    await recordError({ studentId: 's1', conceptId: 'c1', subjectId: 'subj1', errorType: 'UNIT', sourceType: 'quiz' });
    expect(queryMock.mock.calls[0][1][3]).toBe('PROCEDURAL');
  });
});
