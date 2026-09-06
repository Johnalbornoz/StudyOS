/**
 * D6 -- Concept Detail derived-metric resilience.
 *
 * A computation/read failure in ONE optional Phase 1E derived metric
 * (learningVelocity, prerequisiteGaps, helpDependency, persistence)
 * must make ONLY that metric unavailable (reason COMPUTATION_ERROR) +
 * emit one structured `[ops]` WARN -- it must NOT reject the whole
 * getConceptView projection (the prior Concept Detail 500 / React #441
 * class). Required/core Twin reads stay fatal.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const readerStubs = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    readMasteryRow: fn(),
    toMasterySignal: fn(),
    readKnowledgeStateSignal: fn(),
    readIndependenceSignal: fn(),
    readMetacognitionSignal: fn(),
    readTransferSignal: fn(),
    readMisconceptionSummary: fn(),
    readInterventionState: fn(),
    readConceptValidationState: fn(),
    readAssessmentState: fn(),
    readRecentEvidence: fn(),
    readConceptErrorPatterns: fn(),
    readAssessmentPressure: fn(),
    readResponseTimingSignal: fn(),
    getTwinMemorySignal: fn(),
    readStateHistory: fn(),
    toRetentionSignal: fn(),
    toMemorySignal: fn(),
  };
});

const metricStubs = vi.hoisted(() => ({
  readPrerequisiteGaps: vi.fn(),
  readHelpDependency: vi.fn(),
  readLearningVelocity: vi.fn(),
  readPersistence: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    query: vi.fn(async () => ({ rows: [{ subject_id: 'subj-1', label: 'Derivatives' }] })),
  },
}));
vi.mock('@/lib/learner-twin/readers', () => readerStubs);
vi.mock('@/lib/learner-twin/metrics', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, ...metricStubs };
});
vi.mock('@/services/learner-model.service', () => ({ getSubjectLearnerModel: vi.fn() }));
vi.mock('@/services/validation-cycle.service', () => ({ getKVR14: vi.fn() }));

import { getConceptView } from '@/lib/learner-twin/service';
import { metricAvailable } from '@/lib/learner-twin/metrics';

const VELOCITY = metricAvailable({ marker: 'velocity' } as any);
const PREREQ = metricAvailable({ marker: 'prereq' } as any);
const HELP = metricAvailable({ marker: 'help' } as any);
const PERSIST = metricAvailable({ marker: 'persist' } as any);

let warnSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;
const savedEnv = { sha: process.env.VERCEL_GIT_COMMIT_SHA, env: process.env.VERCEL_ENV };

beforeEach(() => {
  process.env.VERCEL_GIT_COMMIT_SHA = 'd6d6d6d6d6d6d6d6d6d6d6d6d6d6d6d6d6d6d6d6d6';
  process.env.VERCEL_ENV = 'production';
  vi.clearAllMocks();
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  // healthy defaults
  readerStubs.readMasteryRow.mockResolvedValue({ mastery_score: 42 });
  readerStubs.toMasterySignal.mockReturnValue({ score: 42 });
  readerStubs.readKnowledgeStateSignal.mockResolvedValue({
    masteryState: 'DEVELOPING',
    dimensions: { understanding: 60, independence: null, application: null, retention: null, transfer: null },
    validationReadiness: 'INSUFFICIENT_EVIDENCE',
    stateReason: null,
    quality: { sourceType: 'DETERMINISTIC_DERIVATION', lastUpdatedAt: null },
  });
  readerStubs.readIndependenceSignal.mockResolvedValue({ independentMastery: null, evidenceStrength: 'MEDIUM' });
  readerStubs.readMetacognitionSignal.mockResolvedValue({ confidence: null, confidenceCalibration: null });
  readerStubs.readTransferSignal.mockResolvedValue({ transferScore: null });
  readerStubs.readMisconceptionSummary.mockResolvedValue({ activeCount: 0 });
  readerStubs.readInterventionState.mockResolvedValue({ hasActivePath: false });
  readerStubs.readConceptValidationState.mockResolvedValue({ status: 'NONE' });
  readerStubs.readAssessmentState.mockResolvedValue({ hasPendingVerification: false });
  readerStubs.readRecentEvidence.mockResolvedValue([]);
  readerStubs.readConceptErrorPatterns.mockResolvedValue([]);
  readerStubs.readAssessmentPressure.mockResolvedValue({ examSoon: false });
  readerStubs.readResponseTimingSignal.mockResolvedValue({ samples: 0 });
  readerStubs.getTwinMemorySignal.mockResolvedValue(null);
  readerStubs.readStateHistory.mockResolvedValue([]);
  readerStubs.toRetentionSignal.mockReturnValue({ retentionScore: null, forgettingRisk: null });
  readerStubs.toMemorySignal.mockReturnValue({ forgettingRisk: null });

  metricStubs.readPrerequisiteGaps.mockResolvedValue(PREREQ);
  metricStubs.readHelpDependency.mockResolvedValue(HELP);
  metricStubs.readLearningVelocity.mockResolvedValue(VELOCITY);
  metricStubs.readPersistence.mockResolvedValue(PERSIST);
});
afterEach(() => {
  savedEnv.sha === undefined ? delete process.env.VERCEL_GIT_COMMIT_SHA : (process.env.VERCEL_GIT_COMMIT_SHA = savedEnv.sha);
  savedEnv.env === undefined ? delete process.env.VERCEL_ENV : (process.env.VERCEL_ENV = savedEnv.env);
  warnSpy.mockRestore();
  errSpy.mockRestore();
});

const opsWarns = () => (warnSpy.mock.calls as any[][]).filter((c) => c[0] === '[ops]').map((c) => JSON.parse(c[1] as string));

const METRIC_FIELD: Record<string, 'prerequisiteGaps' | 'helpDependency' | 'learningVelocity' | 'persistence'> = {
  readPrerequisiteGaps: 'prerequisiteGaps',
  readHelpDependency: 'helpDependency',
  readLearningVelocity: 'learningVelocity',
  readPersistence: 'persistence',
};
const HEALTHY: Record<string, unknown> = {
  prerequisiteGaps: PREREQ,
  helpDependency: HELP,
  learningVelocity: VELOCITY,
  persistence: PERSIST,
};

describe('D6 -- success-path equivalence', () => {
  it('all readers healthy: the four metric fields pass through unchanged and NO [ops] line is emitted', async () => {
    const view = await getConceptView('stu-1', 'concept-1');
    expect(view).not.toBeNull();
    expect(view!.prerequisiteGaps).toBe(PREREQ);
    expect(view!.helpDependency).toBe(HELP);
    expect(view!.learningVelocity).toBe(VELOCITY);
    expect(view!.persistence).toBe(PERSIST);
    expect(view!.mastery).toEqual({ score: 42 });
    expect(view!.knowledgeState.masteryState).toBe('DEVELOPING');
    expect(opsWarns()).toHaveLength(0);
  });
});

describe('D6 -- single optional-metric failure matrix', () => {
  for (const source of ['readPrerequisiteGaps', 'readHelpDependency', 'readLearningVelocity', 'readPersistence']) {
    it(`${source} rejects -> only ${METRIC_FIELD[source]} is COMPUTATION_ERROR, others intact, one WARN`, async () => {
      (metricStubs as any)[source].mockRejectedValue(new Error(`boom:${source}`));

      const view = await getConceptView('stu-secret', 'concept-1');
      expect(view, 'A. getConceptView resolves').not.toBeNull();

      const failedField = METRIC_FIELD[source];
      expect(view![failedField]).toEqual({
        available: false,
        reason: 'COMPUTATION_ERROR',
        detail: expect.any(String),
      }); // B + C

      for (const other of ['prerequisiteGaps', 'helpDependency', 'learningVelocity', 'persistence'] as const) {
        if (other === failedField) continue;
        expect(view![other], `D. ${other} untouched`).toBe(HEALTHY[other]);
      }

      expect(view!.mastery).toEqual({ score: 42 }); // core preserved

      const warns = opsWarns();
      expect(warns, 'E. exactly one WARN').toHaveLength(1);
      expect(warns[0]).toMatchObject({
        at: 'operational_warning',
        severity: 'WARN',
        subsystem: 'learner-twin',
        operation: 'getConceptView',
        failedSource: source, // F
        conceptId: 'concept-1',
        subjectId: 'subj-1',
        environment: 'production',
      });
      const raw = (warnSpy.mock.calls as any[][]).find((c) => c[0] === '[ops]')![1] as string;
      expect(raw, 'G. no studentId').not.toContain('stu-secret');
      expect(raw).not.toContain('studentId');
    });
  }
});

describe('D6 -- multiple simultaneous failures', () => {
  it('two optional metrics fail: both COMPUTATION_ERROR, other two intact, exactly two distinct WARNs', async () => {
    metricStubs.readLearningVelocity.mockRejectedValue(new TypeError('firstEvidenceAt.slice is not a function'));
    metricStubs.readPersistence.mockRejectedValue(new Error('persist read failed'));

    const view = await getConceptView('stu-1', 'concept-1');
    expect(view).not.toBeNull();
    expect(view!.learningVelocity).toMatchObject({ available: false, reason: 'COMPUTATION_ERROR' });
    expect(view!.persistence).toMatchObject({ available: false, reason: 'COMPUTATION_ERROR' });
    expect(view!.prerequisiteGaps).toBe(PREREQ);
    expect(view!.helpDependency).toBe(HELP);

    const warns = opsWarns();
    expect(warns).toHaveLength(2);
    expect(warns.map((w) => w.failedSource).sort()).toEqual(['readLearningVelocity', 'readPersistence']);
  });
});

describe('D6 -- P0 class regression (a derived reader throws an unexpected TypeError)', () => {
  it('learning-velocity Date/string-style TypeError no longer 500s the projection', async () => {
    metricStubs.readLearningVelocity.mockRejectedValue(new TypeError('firstEvidenceAt.slice is not a function'));

    const view = await getConceptView('stu-1', 'concept-1');
    expect(view, 'view data resolves').not.toBeNull();
    expect(view!.learningVelocity).toMatchObject({ available: false, reason: 'COMPUTATION_ERROR' });
    expect(view!.mastery).toEqual({ score: 42 }); // core state preserved
    expect(view!.knowledgeState.masteryState).toBe('DEVELOPING');
    expect(opsWarns()).toHaveLength(1);
    expect(opsWarns()[0].failedSource).toBe('readLearningVelocity');
  });
});

describe('D6 -- core/required reads stay fatal (no partial render)', () => {
  it('concept does not exist -> getConceptView returns null (unchanged contract)', async () => {
    const { db } = await import('@/lib/db');
    (db.query as any).mockResolvedValueOnce({ rows: [] });
    await expect(getConceptView('stu-1', 'missing')).resolves.toBeNull();
  });

  it('no mastery row (no evidence yet) -> returns null (unchanged contract)', async () => {
    readerStubs.readMasteryRow.mockResolvedValueOnce(null);
    await expect(getConceptView('stu-1', 'concept-1')).resolves.toBeNull();
  });

  it('a CORE reader (readKnowledgeStateSignal) rejecting still rejects the whole projection', async () => {
    readerStubs.readKnowledgeStateSignal.mockRejectedValueOnce(new Error('KS read failed'));
    await expect(getConceptView('stu-1', 'concept-1')).rejects.toThrow(/KS read failed/);
    expect(opsWarns()).toHaveLength(0); // never downgraded to a WARN
  });

  it('a CORE reader (getTwinMemorySignal) rejecting still rejects the whole projection', async () => {
    readerStubs.getTwinMemorySignal.mockRejectedValueOnce(new Error('memory read failed'));
    await expect(getConceptView('stu-1', 'concept-1')).rejects.toThrow(/memory read failed/);
  });
});
