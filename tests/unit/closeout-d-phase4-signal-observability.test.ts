/**
 * STUDYUS PHASE 6 -- CLOSEOUT D2.
 *
 * For every one of the eight student-wide signal sources that
 * loadLearningSignals already degrades to an empty result on failure:
 *   A. forcing it to reject emits exactly ONE [ops] WARN naming that
 *      source (never one per concept),
 *   B. the existing fallback value is still used, and
 *   C. getLearningDecisions produces byte-identical output to the
 *      all-healthy run (fail-soft semantics unchanged), and
 *   D. no studentId in the log line.
 * Also: an all-healthy run emits NO [ops] line.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

const FIXED = new Date('2026-09-07T09:00:00.000Z');
const SUBJECT = 'subj-1';
const CONCEPTS = ['c000', 'c001', 'c002', 'c003'];

const state = vi.hoisted(() => ({ rejectSource: null as string | null }));

function boom(source: string) {
  return new Error(`FORCED_FAILURE:${source}`);
}
function guard<T>(source: string, value: T): T {
  if (state.rejectSource === source) throw boom(source);
  return value;
}

function ksFor(id: string, i: number) {
  return {
    studentId: 'stu-1', conceptId: id, subjectId: SUBJECT,
    masteryState: (['LEARNING', 'DEVELOPING', 'PROVISIONAL_MASTERY', 'AT_RISK'] as const)[i % 4],
    understandingScore: i % 2 === 0 ? 50 : 90,
    independenceScore: null, applicationScore: null, retentionScore: null, transferScore: null,
    activeMisconceptionCount: 0, criticalMisconceptionCount: i === 0 ? 1 : 0,
    recurringMisconceptionCount: 0, evidenceCount: 5, independentEvidenceCount: 2,
    firstEvidenceAt: '2026-08-01T00:00:00.000Z', lastEvidenceAt: '2026-09-01T00:00:00.000Z',
    validationReadiness: (['INSUFFICIENT_EVIDENCE', 'WAITING_FOR_RETENTION', 'TRANSFER_REQUIRED', 'READY'] as const)[i % 4],
    stateReason: null, projectionVersion: 1, masteryPolicyVersion: 1, updatedAt: '2026-09-01T00:00:00.000Z',
  };
}

vi.mock('@/lib/db', () => ({
  db: { query: vi.fn(async (sql: string) => (/FROM subjects WHERE student_id/i.test(sql) ? { rows: [{ id: SUBJECT }] } : { rows: [] })) },
}));
vi.mock('@/services/knowledge-state.service', () => ({
  getActiveMasteryPolicy: vi.fn(async () => ({
    version: 1, minimumUnderstanding: 70, minimumIndependence: 80, minimumApplication: 75,
    minimumRetention: 75, minimumTransfer: 70, requiresTransfer: true, maximumCriticalMisconceptions: 0,
    minimumEvidenceCount: 3, minimumIndependentEvidenceCount: 2, validationWindowDays: 14,
  })),
  getSubjectKnowledgeState: vi.fn(async (_s: string, subjectId: string) =>
    CONCEPTS.map((id, i) => ksFor(id, i)).filter((k) => k.subjectId === subjectId)),
}));
vi.mock('@/services/learning-scheduler.service', () => ({ getDueItems: vi.fn(async () => []) }));
// --- the eight instrumented fail-soft sources ---
vi.mock('@/services/remediation.service', () => ({ getActiveRemediationsWithLabels: vi.fn(async () => guard('getActiveRemediationsWithLabels', [])) }));
vi.mock('@/services/cognitive-diagnosis.service', () => ({ getActiveDiagnoses: vi.fn(async () => guard('getActiveDiagnoses', [])) }));
vi.mock('@/services/misconception.service', () => ({ getRecurringMisconceptions: vi.fn(async () => guard('getRecurringMisconceptions', [])) }));
vi.mock('@/services/learning-debt.service', () => ({ getActiveDebts: vi.fn(async () => guard('getActiveDebts', [])) }));
vi.mock('@/services/external-assessment.service', () => ({ getCalibrationConflicts: vi.fn(async () => guard('getCalibrationConflicts', [])) }));
vi.mock('@/services/assessment.service', () => ({ getUpcomingForStudent: vi.fn(async () => guard('getUpcomingForStudent', [])) }));
vi.mock('@/services/mastery.service', () => ({ getStudentMastery: vi.fn(async () => guard('getStudentMastery', [])) }));
vi.mock('@/services/memory-read.service', () => ({ getPhase4MemorySignalsForStudent: vi.fn(async () => guard('getPhase4MemorySignalsForStudent', new Map())) }));
// --- per-concept readers (not part of D2; kept trivial + deterministic) ---
vi.mock('@/services/concept-graph.service', () => ({ getLearningUnlockValue: vi.fn(async () => ({ score: 10, blockedCount: 1 })) }));
vi.mock('@/services/learner-model.service', () => ({ getIndependentMastery: vi.fn(async () => null) }));
vi.mock('@/services/assessment-verification.service', () => ({
  getAssessmentStateForConcept: vi.fn(async () => ({
    hasPendingVerification: false, pendingVerification: null, lastIndependentEvidence: null,
    lastFormalEvidence: null, lastVerification: null,
    cognitiveDemand: { latestObservedLevel: null, observedLevels: [], sampleSize: 0, lastObservedAt: null },
  })),
}));

const THE_EIGHT = [
  'getActiveRemediationsWithLabels',
  'getActiveDiagnoses',
  'getRecurringMisconceptions',
  'getActiveDebts',
  'getCalibrationConflicts',
  'getUpcomingForStudent',
  'getStudentMastery',
  'getPhase4MemorySignalsForStudent',
];

let warnSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;
const savedEnv = { sha: process.env.VERCEL_GIT_COMMIT_SHA, env: process.env.VERCEL_ENV };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FIXED);
  process.env.VERCEL_GIT_COMMIT_SHA = '1111222233334444555566667777888899990000';
  process.env.VERCEL_ENV = 'production';
  state.rejectSource = null;
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => {
  vi.useRealTimers();
  savedEnv.sha === undefined ? delete process.env.VERCEL_GIT_COMMIT_SHA : (process.env.VERCEL_GIT_COMMIT_SHA = savedEnv.sha);
  savedEnv.env === undefined ? delete process.env.VERCEL_ENV : (process.env.VERCEL_ENV = savedEnv.env);
});

async function run() {
  const { getLearningDecisions } = await import('@/services/adaptive-learning-orchestrator.service');
  return getLearningDecisions('stu-1', 'en');
}
function opsLines(spy: ReturnType<typeof vi.spyOn>): any[] {
  return (spy.mock.calls as any[][]).filter((c) => c[0] === '[ops]').map((c) => JSON.parse(c[1] as string));
}

describe('Closeout D2 -- Phase 4 silent signal-drop warnings', () => {
  it('all-healthy run emits NO [ops] line and produces a non-empty decision set', async () => {
    const decisions = await run();
    expect(Array.isArray(decisions)).toBe(true);
    expect(decisions.length).toBeGreaterThan(0);
    expect(opsLines(warnSpy)).toHaveLength(0);
    expect(opsLines(errSpy)).toHaveLength(0);
  });

  it('each of the eight sources: one WARN, unchanged fallback, identical decisions', async () => {
    state.rejectSource = null;
    const baseline = JSON.stringify(await run());

    for (const source of THE_EIGHT) {
      warnSpy.mockClear();
      errSpy.mockClear();
      state.rejectSource = source;

      const decisions = await run();
      const warns = opsLines(warnSpy);

      expect(warns, `${source}: exactly one WARN`).toHaveLength(1);
      expect(warns[0]).toMatchObject({
        at: 'operational_warning',
        severity: 'WARN',
        subsystem: 'phase4-orchestrator',
        operation: 'loadLearningSignals',
        failedSource: source,
        environment: 'production',
      });
      expect(warns[0].commitSha).toBe('1111222233334444555566667777888899990000');

      const raw = (warnSpy.mock.calls as any[][]).find((c) => c[0] === '[ops]')![1] as string;
      expect(raw, `${source}: no studentId`).not.toContain('stu-1');
      expect(raw).not.toContain('studentId');

      expect(JSON.stringify(decisions), `${source}: decision output unchanged`).toBe(baseline);
      expect(opsLines(errSpy), `${source}: never escalated to ERROR`).toHaveLength(0);

      state.rejectSource = null;
    }
  });

  it('two sources failing -> two WARNs (one per source), still no throw', async () => {
    const baseline = JSON.stringify(await run());
    warnSpy.mockClear();

    // reject the first, then the second, in two runs -- proves per-source, not per-concept
    state.rejectSource = 'getActiveDebts';
    await run();
    state.rejectSource = 'getUpcomingForStudent';
    await run();

    const failed = opsLines(warnSpy).map((l: any) => l.failedSource).sort();
    expect(failed).toEqual(['getActiveDebts', 'getUpcomingForStudent']);
    state.rejectSource = null;
    expect(JSON.stringify(await run())).toBe(baseline);
  });
});
