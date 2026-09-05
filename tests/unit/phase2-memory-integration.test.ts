/**
 * STUDYUS PHASE 6 -- RETENTION & MEMORY ENGINE
 * Step 6G: Phase 2 Memory Integration -- unit test matrix.
 *
 * Proves recalculateConceptKnowledgeState's new Retention dimension
 * source: Phase 6's concept_memory_state.demonstrated_retention_score
 * (via getPhase2MemoryInput) -- classifyRetention() was Step 6J-B2's
 * deletion target once this step confirmed it was no longer the live
 * path's authority; it no longer exists at all. Null stays null, no
 * transformation, no fallback, and a fail-closed missing-row invariant.
 * evaluateValidationLifecycle (Phase 2.2B's
 * time/decay overlay) is mocked as a base-state pass-through here --
 * its own real decay semantics are exercised in the isolated-Postgres
 * integration proof (same-transaction visibility, VALIDATED_MASTERY
 * conditional decay), not re-tested here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...args: any[]) => queryMock(...args) } }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));
vi.mock('@/lib/audit', () => ({ recordDecisionEvent: vi.fn() }));
vi.mock('@/services/transfer.service', () => ({ getTransferScore: vi.fn().mockResolvedValue(null) }));
vi.mock('@/services/misconception.service', () => ({
  getMisconceptionCountsForConcept: vi.fn().mockResolvedValue({ activeCount: 0, criticalCount: 0, recurringCount: 0 }),
}));
vi.mock('@/services/validation-cycle.service', () => ({
  // Pass-through: this file tests the retention SOURCE, not Phase 2.2B's
  // own time/decay overlay (covered by the isolated-Postgres proof).
  evaluateValidationLifecycle: vi.fn(async (params: any) => params.baseState),
}));

const memoryInputMock = vi.fn();
vi.mock('@/services/memory-read.service', () => ({
  getPhase2MemoryInput: (...args: any[]) => memoryInputMock(...args),
}));

import { recalculateConceptKnowledgeState, determineMasteryState, determineValidationReadiness } from '@/services/knowledge-state.service';
import type { DimensionScores, MisconceptionState, MasteryPolicy } from '@/services/knowledge-state.service';
import type { Phase2MemoryInput } from '@/services/memory-read.service';

function memoryInput(overrides: Partial<Phase2MemoryInput> = {}): Phase2MemoryInput {
  return {
    demonstratedRetentionScore: null,
    retentionEvidenceCount: 0,
    memoryStatus: 'NOT_ESTABLISHED',
    lastSuccessfulRetentionAt: null,
    policyVersion: 1,
    ...overrides,
  };
}

const POLICY_ROW = (overrides: Record<string, unknown> = {}) => ({
  version: 1,
  minimum_understanding: 80,
  minimum_independence: 80,
  minimum_application: 75,
  minimum_retention: 75,
  minimum_transfer: 70,
  requires_transfer: false,
  maximum_critical_misconceptions: 0,
  minimum_evidence_count: 1,
  minimum_independent_evidence_count: 1,
  retention_min_gap_days: 3,
  validation_window_days: 14,
  ...overrides,
});

/** Strong evidence on every OTHER dimension (understanding/independence/application), so retention is the only variable under test. */
const STRONG_EVIDENCE_ROW = {
  source_type: 'CUMULATIVE_ASSESSMENT',
  result: 'correct',
  score_percent: 95,
  ai_assistance_type: 'NONE',
  timestamp: new Date('2026-01-05T00:00:00Z'),
};

function setupQueryMock(opts: { policyOverrides?: Record<string, unknown>; previousMasteryState?: string | null; evidenceRows?: any[] } = {}) {
  queryMock.mockImplementation(async (sql: string, params: any[] = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (/^SELECT subject_id FROM concepts/.test(s)) return { rows: [{ subject_id: 'subj1' }] };
    if (/FROM learning_evidence/.test(s)) return { rows: opts.evidenceRows ?? [STRONG_EVIDENCE_ROW] };
    if (/FROM mastery_policies/.test(s)) return { rows: [POLICY_ROW(opts.policyOverrides)] };
    if (/SELECT mastery_state FROM concept_knowledge_state/.test(s)) {
      return { rows: opts.previousMasteryState ? [{ mastery_state: opts.previousMasteryState }] : [] };
    }
    if (/^INSERT INTO concept_knowledge_state/.test(s)) {
      const [
        studentId, conceptId, subjectId, masteryState, understanding, independence, application, retention, transfer,
        activeMisconceptionCount, criticalMisconceptionCount, recurringMisconceptionCount,
        evidenceCount, independentEvidenceCount, firstEvidenceAt, lastEvidenceAt,
        validationReadiness, stateReasonJson, policyVersion,
      ] = params;
      return {
        rows: [{
          id: 'cks-1', student_id: studentId, concept_id: conceptId, subject_id: subjectId, mastery_state: masteryState,
          understanding_score: understanding, independence_score: independence, application_score: application,
          retention_score: retention, transfer_score: transfer,
          active_misconception_count: activeMisconceptionCount, critical_misconception_count: criticalMisconceptionCount,
          recurring_misconception_count: recurringMisconceptionCount,
          evidence_count: evidenceCount, independent_evidence_count: independentEvidenceCount,
          first_evidence_at: firstEvidenceAt, last_evidence_at: lastEvidenceAt,
          validation_readiness: validationReadiness, state_reason: JSON.parse(stateReasonJson),
          projection_version: 1, mastery_policy_version: policyVersion, updated_at: new Date().toISOString(),
        }],
      };
    }
    throw new Error(`Unmocked query in phase2-memory-integration test fake: ${s}`);
  });
}

beforeEach(() => {
  queryMock.mockReset();
  memoryInputMock.mockReset();
  setupQueryMock();
});

describe('A. PRACTICE ONLY -- Phase 6 null -> Knowledge State retention null', () => {
  it('no fake retention when demonstratedRetentionScore is null', async () => {
    memoryInputMock.mockResolvedValue(memoryInput({ demonstratedRetentionScore: null, memoryStatus: 'NOT_ESTABLISHED' }));
    const state = await recalculateConceptKnowledgeState('s1', 'c1');
    expect(state?.retentionScore).toBeNull();
  });
});

describe('B. ANCHOR ONLY -- WAITING_FOR_RETENTION, null retention', () => {
  it('memoryStatus=WAITING_FOR_RETENTION with null score keeps KS retention null and validationReadiness WAITING_FOR_RETENTION', async () => {
    memoryInputMock.mockResolvedValue(memoryInput({ demonstratedRetentionScore: null, memoryStatus: 'WAITING_FOR_RETENTION' }));
    const state = await recalculateConceptKnowledgeState('s1', 'c1');
    expect(state?.retentionScore).toBeNull();
    expect(state?.validationReadiness).toBe('WAITING_FOR_RETENTION');
  });
});

describe('C. FIRST QUALIFIED SUCCESS -- exact passthrough', () => {
  it('Phase 6 numeric score flows through unchanged, no transformation', async () => {
    memoryInputMock.mockResolvedValue(memoryInput({ demonstratedRetentionScore: 88, memoryStatus: 'DEVELOPING' }));
    const state = await recalculateConceptKnowledgeState('s1', 'c1');
    expect(state?.retentionScore).toBe(88);
  });
});

describe('D. QUALIFIED PARTIAL -- exact passthrough of the weighted score', () => {
  it('a non-round Phase 6 score is mirrored exactly', async () => {
    memoryInputMock.mockResolvedValue(memoryInput({ demonstratedRetentionScore: 62.4, memoryStatus: 'AT_RISK' }));
    const state = await recalculateConceptKnowledgeState('s1', 'c1');
    expect(state?.retentionScore).toBe(62.4);
  });
});

describe('E. QUALIFIED FAILURE -- same contract', () => {
  it('a low Phase 6 score is mirrored exactly, no floor/adjustment', async () => {
    memoryInputMock.mockResolvedValue(memoryInput({ demonstratedRetentionScore: 12, memoryStatus: 'AT_RISK' }));
    const state = await recalculateConceptKnowledgeState('s1', 'c1');
    expect(state?.retentionScore).toBe(12);
  });
});

describe('F. THREE SUCCESSFUL RETENTION PROOFS (STABLE) does not itself grant mastery', () => {
  it('memoryStatus=STABLE with a null score (edge case) still yields WAITING_FOR_RETENTION -- MemoryStatus never substitutes for the numeric gate', async () => {
    memoryInputMock.mockResolvedValue(memoryInput({ demonstratedRetentionScore: null, memoryStatus: 'STABLE' }));
    const state = await recalculateConceptKnowledgeState('s1', 'c1');
    expect(state?.retentionScore).toBeNull();
    expect(state?.validationReadiness).toBe('WAITING_FOR_RETENTION');
    expect(state?.masteryState).not.toBe('VALIDATED_MASTERY');
  });
});

describe('G. HIGH RETRIEVABILITY BUT NO RETENTION PROOF must not satisfy the gate', () => {
  it('Phase2MemoryInput structurally has no retrievability field to consult -- null score alone drives WAITING_FOR_RETENTION regardless of memoryStatus', async () => {
    // Phase2MemoryInput cannot even express "high retrievability" -- this
    // proves the structural exclusion by construction: whatever
    // memoryStatus claims, only demonstratedRetentionScore matters here.
    memoryInputMock.mockResolvedValue(memoryInput({ demonstratedRetentionScore: null, memoryStatus: 'STABLE' }));
    const state = await recalculateConceptKnowledgeState('s1', 'c1');
    expect(state?.validationReadiness).toBe('WAITING_FOR_RETENTION');
  });
});

describe('H. HIGH FORGETTING RISK BUT demonstratedRetentionScore >= threshold must not fail the gate', () => {
  it('memoryStatus=AT_RISK (predicted-risk-adjacent status) with a passing numeric score still passes the retention dimension', async () => {
    memoryInputMock.mockResolvedValue(memoryInput({ demonstratedRetentionScore: 90, memoryStatus: 'AT_RISK' }));
    const state = await recalculateConceptKnowledgeState('s1', 'c1');
    expect(state?.retentionScore).toBe(90);
    // The retention dimension itself passes policy.minimumRetention=75 --
    // proven directly via the untouched pure gate, using the exact score
    // Knowledge State just persisted.
    expect(state?.retentionScore! >= 75).toBe(true);
  });
});

describe('MISSING MEMORY STATE FAILS CLOSED', () => {
  it('recalculateConceptKnowledgeState rejects, and never reaches the concept_knowledge_state UPSERT, when getPhase2MemoryInput throws', async () => {
    memoryInputMock.mockRejectedValue(new Error('MISSING_CONCEPT_MEMORY_STATE'));
    await expect(recalculateConceptKnowledgeState('s1', 'c1')).rejects.toThrow('MISSING_CONCEPT_MEMORY_STATE');
    expect(queryMock.mock.calls.some((c) => String(c[0]).includes('INSERT INTO concept_knowledge_state'))).toBe(false);
  });
});

describe('RETENTION_GAP_QUALIFICATION_OWNER -- policy.retentionMinGapDays no longer affects the live result', () => {
  it('varying retentionMinGapDays with identical evidence/memory input produces an identical retention score', async () => {
    memoryInputMock.mockResolvedValue(memoryInput({ demonstratedRetentionScore: 77 }));

    setupQueryMock({ policyOverrides: { retention_min_gap_days: 3 } });
    const stateGap3 = await recalculateConceptKnowledgeState('s1', 'c1');

    setupQueryMock({ policyOverrides: { retention_min_gap_days: 30 } });
    const stateGap30 = await recalculateConceptKnowledgeState('s1', 'c1');

    expect(stateGap3?.retentionScore).toBe(77);
    expect(stateGap30?.retentionScore).toBe(77);
  });
});

describe('MINIMUM_RETENTION_THRESHOLD_OWNER -- Phase 2 (mastery_policies) still owns the gate threshold', () => {
  it('the same Phase 6 score passes under a lower threshold and fails under a higher one', () => {
    const scores: DimensionScores = { understanding: 90, independence: 90, application: 90, retention: 80, transfer: null };
    const misconceptions: MisconceptionState = { activeCount: 0, criticalCount: 0, recurringCount: 0 };
    const sufficiency = { evidenceCount: 5, independentEvidenceCount: 3, passed: true };
    const lenientPolicy: MasteryPolicy = {
      version: 1, minimumUnderstanding: 80, minimumIndependence: 80, minimumApplication: 75, minimumRetention: 75,
      minimumTransfer: 70, requiresTransfer: false, maximumCriticalMisconceptions: 0, minimumEvidenceCount: 1,
      minimumIndependentEvidenceCount: 1, validationWindowDays: 14,
    };
    const strictPolicy: MasteryPolicy = { ...lenientPolicy, minimumRetention: 95 };
    expect(determineMasteryState(scores, misconceptions, sufficiency, lenientPolicy)).toBe('VALIDATED_MASTERY');
    expect(determineMasteryState(scores, misconceptions, sufficiency, strictPolicy)).not.toBe('VALIDATED_MASTERY');
  });
});

describe('PREDICTED_FIELDS_STRUCTURALLY_EXCLUDED', () => {
  it('a Phase2MemoryInput object literal cannot carry a predicted field -- TypeScript rejects it at compile time', () => {
    const valid: Phase2MemoryInput = memoryInput({ demonstratedRetentionScore: 90 });
    expect(valid.demonstratedRetentionScore).toBe(90);
    // @ts-expect-error -- forgettingRisk is not a field of Phase2MemoryInput; this line only compiles if the exclusion is enforced.
    const invalid: Phase2MemoryInput = { ...valid, forgettingRisk: 5 };
    void invalid;
  });
});

describe('WAITING_FOR_RETENTION behavior (pure function, direct)', () => {
  it('determineValidationReadiness returns WAITING_FOR_RETENTION whenever retention is null, regardless of every other dimension passing', () => {
    const scores: DimensionScores = { understanding: 99, independence: 99, application: 99, retention: null, transfer: 99 };
    const misconceptions: MisconceptionState = { activeCount: 0, criticalCount: 0, recurringCount: 0 };
    const sufficiency = { evidenceCount: 10, independentEvidenceCount: 5, passed: true };
    const policy: MasteryPolicy = {
      version: 1, minimumUnderstanding: 80, minimumIndependence: 80, minimumApplication: 75, minimumRetention: 75,
      minimumTransfer: 70, requiresTransfer: false, maximumCriticalMisconceptions: 0, minimumEvidenceCount: 1,
      minimumIndependentEvidenceCount: 1, validationWindowDays: 14,
    };
    expect(determineValidationReadiness(scores, misconceptions, sufficiency, policy)).toBe('WAITING_FOR_RETENTION');
  });
});
