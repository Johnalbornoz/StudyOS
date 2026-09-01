/**
 * Phase 1E Step 29: Help Dependency fixtures -- independent evidence
 * only, assisted evidence only, mixed evidence, insufficient evidence.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { computeHelpDependency } from '@/lib/learner-twin/metrics/help-dependency';

function evidenceRow(assisted: boolean, hints = 0, ts = '2026-08-20T10:00:00.000Z') {
  return { ai_assistance_type: assisted ? 'HINT' : 'NONE', hints_used: hints, timestamp: ts };
}

describe('computeHelpDependency (pure)', () => {
  it('independent evidence only -- assistedEvidenceShare 0, independentEvidenceShare 1', () => {
    const rows = [evidenceRow(false), evidenceRow(false), evidenceRow(false)];
    const result = computeHelpDependency(rows, 85, []);
    expect(result.assistedEvidenceShare).toBe(0);
    expect(result.independentEvidenceShare).toBe(1);
    expect(result.hintUsageShare).toBe(0);
    expect(result.independentMastery).toBe(85);
  });

  it('assisted evidence only -- assistedEvidenceShare 1, independentEvidenceShare 0', () => {
    const rows = [evidenceRow(true, 2), evidenceRow(true, 1), evidenceRow(true, 0)];
    const result = computeHelpDependency(rows, null, []);
    expect(result.assistedEvidenceShare).toBe(1);
    expect(result.independentEvidenceShare).toBe(0);
    expect(result.hintUsageShare).toBeCloseTo(2 / 3, 5);
    // independentMastery can legitimately be null even when overall available=true --
    // it's getIndependentMastery's own separate <2-independent-rows gate.
    expect(result.independentMastery).toBeNull();
  });

  it('mixed evidence -- shares reflect the real split, never rounded to 0/1', () => {
    const rows = [evidenceRow(false), evidenceRow(false), evidenceRow(true), evidenceRow(true), evidenceRow(true)];
    const result = computeHelpDependency(rows, 70, []);
    expect(result.independentEvidenceShare).toBeCloseTo(0.4, 5);
    expect(result.assistedEvidenceShare).toBeCloseTo(0.6, 5);
  });

  it('never invents a band -- always null, regardless of how lopsided the shares are', () => {
    const rows = [evidenceRow(true), evidenceRow(true), evidenceRow(true), evidenceRow(true)];
    const result = computeHelpDependency(rows, null, []);
    expect(result.band).toBeNull();
  });

  it('verificationConsistency is null with zero resolved verification attempts -- never fabricated as 0', () => {
    const rows = [evidenceRow(false), evidenceRow(false)];
    const result = computeHelpDependency(rows, 80, [{ outcome: null }]); // unresolved attempt only
    expect(result.verificationConsistency).toBeNull();
  });

  it('verificationConsistency reflects real resolved outcomes when present', () => {
    const rows = [evidenceRow(false), evidenceRow(false)];
    const result = computeHelpDependency(rows, 80, [
      { outcome: 'CONFIRMED' },
      { outcome: 'CONFIRMED' },
      { outcome: 'CONTRADICTED' },
      { outcome: null }, // still pending -- excluded from resolvedCount
    ]);
    expect(result.verificationConsistency).toEqual({
      resolvedCount: 3,
      confirmedCount: 2,
      contradictedCount: 1,
      inconclusiveCount: 0,
      confirmedShare: 2 / 3,
    });
  });

  it('quality.sampleSize reflects total evidence count, sourceType is DETERMINISTIC_DERIVATION', () => {
    const rows = [evidenceRow(false), evidenceRow(true)];
    const result = computeHelpDependency(rows, null, []);
    expect(result.quality).toMatchObject({ sourceType: 'DETERMINISTIC_DERIVATION', sampleSize: 2, modelVersion: 'v1' });
  });
});

describe('readHelpDependency: insufficient evidence gate (Step 4)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock('@/lib/db');
  });

  it('below the active mastery policy minimumEvidenceCount -> INSUFFICIENT_EVIDENCE, never a fabricated HIGH_DEPENDENCY from one attempt', async () => {
    // Fresh module graph -- the earlier `computeHelpDependency` tests
    // above already statically imported this module's file (with the
    // real @/lib/db binding); without this, vi.doMock below would not
    // retroactively replace an already-resolved import.
    vi.resetModules();
    const query = vi.fn(async (sql: string) => {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (s.includes('mastery_policies')) {
        return { rows: [{ version: 1, minimum_understanding: 70, minimum_independence: 60, minimum_application: 60, minimum_retention: 60, minimum_transfer: 50, requires_transfer: false, maximum_critical_misconceptions: 0, minimum_evidence_count: 3, minimum_independent_evidence_count: 2, retention_min_gap_days: 3, validation_window_days: 14 }] };
      }
      if (s.includes('ai_assistance_type, hints_used, timestamp FROM learning_evidence')) {
        return { rows: [{ ai_assistance_type: 'HINT', hints_used: 1, timestamp: '2026-08-20T10:00:00.000Z' }] }; // only 1 row, policy requires 3
      }
      throw new Error(`Unmocked: ${s}`);
    });
    vi.doMock('@/lib/db', () => ({ db: { query } }));

    const { readHelpDependency } = await import('@/lib/learner-twin/metrics/help-dependency');
    const result = await readHelpDependency('student-1', 'concept-1');

    expect(result.available).toBe(false);
    if (!result.available) expect(result.reason).toBe('INSUFFICIENT_EVIDENCE');
  });
});
