/**
 * Phase 1E Step 29: Transfer Coverage fixtures -- no transfer evidence,
 * one sample, multiple successful contexts.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { computeTransferCoverage } from '@/lib/learner-twin/metrics/transfer-coverage';

describe('computeTransferCoverage (pure)', () => {
  it('no transfer evidence -- coverage is 0%, not null, when concepts are eligible but none touched', () => {
    const result = computeTransferCoverage(['c1', 'c2', 'c3'], []);
    expect(result.transferEvidenceCount).toBe(0);
    expect(result.coveredConceptCount).toBe(0);
    expect(result.coveragePercent).toBe(0);
    expect(result.lastTransferAt).toBeNull();
  });

  it('one sample -- coverage reflects exactly one covered concept, not treated as proof of general ability', () => {
    const result = computeTransferCoverage(['c1', 'c2'], [{ concept_id: 'c1', result: 'correct', timestamp: '2026-08-20T10:00:00.000Z' }]);
    expect(result.coveredConceptCount).toBe(1);
    expect(result.coveragePercent).toBe(50);
    expect(result.successfulTransferCount).toBe(1);
  });

  it('multiple successful contexts across concepts -- coverage and success counted independently', () => {
    const rows = [
      { concept_id: 'c1', result: 'correct', timestamp: '2026-08-01T10:00:00.000Z' },
      { concept_id: 'c1', result: 'incorrect', timestamp: '2026-08-05T10:00:00.000Z' },
      { concept_id: 'c2', result: 'correct', timestamp: '2026-08-10T10:00:00.000Z' },
      { concept_id: 'c3', result: 'correct', timestamp: '2026-08-15T10:00:00.000Z' },
    ];
    const result = computeTransferCoverage(['c1', 'c2', 'c3', 'c4'], rows);
    expect(result.transferEvidenceCount).toBe(4);
    expect(result.successfulTransferCount).toBe(3);
    expect(result.coveredConceptCount).toBe(3); // c4 untouched
    expect(result.coveragePercent).toBe(75);
    expect(result.lastTransferAt).toBe('2026-08-15T10:00:00.000Z');
  });
});

describe('readTransferCoverage: denominator semantics', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock('@/lib/db');
  });

  it('zero engaged (mastery_records) concepts in this subject -> INSUFFICIENT_EVIDENCE, no eligible denominator', async () => {
    vi.resetModules();
    const query = vi.fn(async () => ({ rows: [] }));
    vi.doMock('@/lib/db', () => ({ db: { query } }));
    const { readTransferCoverage } = await import('@/lib/learner-twin/metrics/transfer-coverage');
    const result = await readTransferCoverage('student-1', 'subject-1');
    expect(result.available).toBe(false);
    if (!result.available) expect(result.reason).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('eligibleConceptCount only counts engaged concepts, never the full subject curriculum', async () => {
    const query = vi.fn(async (sql: string) => {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (s.includes('SELECT concept_id FROM mastery_records')) return { rows: [{ concept_id: 'c1' }, { concept_id: 'c2' }] };
      if (s.includes("source_type = 'TRANSFER'")) return { rows: [] };
      throw new Error(`Unmocked: ${s}`);
    });
    vi.doMock('@/lib/db', () => ({ db: { query } }));
    const { readTransferCoverage } = await import('@/lib/learner-twin/metrics/transfer-coverage');
    const result = await readTransferCoverage('student-1', 'subject-1');
    expect(result.available).toBe(true);
    if (result.available) expect(result.value.eligibleConceptCount).toBe(2);
  });
});
