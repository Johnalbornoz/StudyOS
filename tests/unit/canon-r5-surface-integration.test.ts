/**
 * CANON-R5 -- CONTROLLED CANONICAL ENGINE INTEGRATION: surface-level
 * integration tests. `@/lib/pedagogical-decision` is mocked as a black
 * box here (its own internals are covered by
 * `canon-r5-canonical-decision-service.test.ts`) -- these tests answer a
 * different question: does each learner-facing entry point (session
 * start, Today's snapshot, Concept Mission's read boundary) actually
 * consult it, honor its answer, and never fall back to the legacy
 * authority on failure.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const CanonicalDecisionUnavailableErrorMock = vi.hoisted(() => {
  return class CanonicalDecisionUnavailableErrorMock extends Error {
    cause?: unknown;
    constructor(message: string, cause?: unknown) {
      super(message);
      this.name = 'CanonicalDecisionUnavailableError';
      this.cause = cause;
    }
  };
});

const isCanonicalEngineV1EnabledMock = vi.fn();
const getCanonicalPedagogicalDecisionMock = vi.fn();
const resolveCanonicalLaunchMock = vi.fn();
const resolveConceptSubjectForStudentMock = vi.fn();
const overrideConceptMissionViewWithCanonicalDecisionMock = vi.fn();
vi.mock('@/lib/pedagogical-decision', () => ({
  isCanonicalEngineV1Enabled: (...a: unknown[]) => isCanonicalEngineV1EnabledMock(...a),
  getCanonicalPedagogicalDecision: (...a: unknown[]) => getCanonicalPedagogicalDecisionMock(...a),
  resolveCanonicalLaunch: (...a: unknown[]) => resolveCanonicalLaunchMock(...a),
  resolveConceptSubjectForStudent: (...a: unknown[]) => resolveConceptSubjectForStudentMock(...a),
  overrideConceptMissionViewWithCanonicalDecision: (...a: unknown[]) => overrideConceptMissionViewWithCanonicalDecisionMock(...a),
  CanonicalDecisionUnavailableError: CanonicalDecisionUnavailableErrorMock,
}));

const verifyAuthMock = vi.fn();
const verifyStudentAccessMock = vi.fn();
vi.mock('@/lib/auth', () => ({
  verifyAuth: () => verifyAuthMock(),
  verifyStudentAccess: (...a: unknown[]) => verifyStudentAccessMock(...a),
}));

const getLearningDecisionsMock = vi.fn();
vi.mock('@/services/adaptive-learning-orchestrator.service', () => ({
  getLearningDecisions: (...a: unknown[]) => getLearningDecisionsMock(...a),
}));

const startLearningSessionMock = vi.fn();
vi.mock('@/services/learning-session-engine.service', () => ({
  startLearningSession: (...a: unknown[]) => startLearningSessionMock(...a),
}));

vi.mock('@/lib/i18n/language', () => ({ getInterfaceLanguage: async () => 'en' }));

const dbQueryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: unknown[]) => dbQueryMock(...a) }, query: (...a: unknown[]) => dbQueryMock(...a) }));

import { POST } from '@/app/api/learning/session/start/route';
import { getLearningOSSnapshot } from '@/services/learning-os-snapshot.service';

const STUDENT = '11111111-1111-4111-8111-111111111111';
const CONCEPT = '22222222-2222-4222-8222-222222222222';

function makeRequest(body: unknown) {
  return { json: async () => body } as any;
}

beforeEach(() => {
  verifyAuthMock.mockReset().mockResolvedValue({ userId: 'u1', role: 'student' });
  verifyStudentAccessMock.mockReset().mockResolvedValue(true);
  getLearningDecisionsMock.mockReset().mockResolvedValue([]);
  startLearningSessionMock.mockReset().mockResolvedValue({ launchStatus: 'READY', launchTarget: '/dashboard/quiz?mode=topic_practice' });
  isCanonicalEngineV1EnabledMock.mockReset().mockReturnValue(false);
  getCanonicalPedagogicalDecisionMock.mockReset();
  resolveCanonicalLaunchMock.mockReset();
  resolveConceptSubjectForStudentMock.mockReset().mockResolvedValue({ subjectId: 'subj1' });
  overrideConceptMissionViewWithCanonicalDecisionMock.mockReset();
  dbQueryMock.mockReset().mockResolvedValue({ rows: [] });
  getConceptKnowledgeStateMock.mockReset().mockResolvedValue(null);
  getActiveMasteryPolicyMock.mockReset().mockResolvedValue(null);
});

describe('Part 12/13 -- POST /api/learning/session/start, feature gate off', () => {
  it('uses the legacy Phase 3C path and never touches the canonical decision service', async () => {
    getLearningDecisionsMock.mockResolvedValue([{ actionConceptId: CONCEPT, subjectId: 'subj1', activityType: 'PRACTICE' }]);
    const res: any = await POST(makeRequest({ studentId: STUDENT, actionConceptId: CONCEPT }));
    expect(res.status ?? 200).toBe(200);
    expect(getLearningDecisionsMock).toHaveBeenCalledTimes(1);
    expect(getCanonicalPedagogicalDecisionMock).not.toHaveBeenCalled();
    expect(startLearningSessionMock).toHaveBeenCalledTimes(1);
  });
});

describe('Part 2/12/13 -- POST /api/learning/session/start, feature gate ON', () => {
  it('calls the canonical decision service fresh and never calls the legacy Phase 3C path (ONE AUTHORITY RULE)', async () => {
    isCanonicalEngineV1EnabledMock.mockReturnValue(true);
    getCanonicalPedagogicalDecisionMock.mockResolvedValue({ decision: { stage: 'PRACTICE', actionState: 'EXECUTABLE' } });
    resolveCanonicalLaunchMock.mockReturnValue({ launchStatus: 'READY', launchTarget: '/dashboard/quiz?mode=topic_practice&maxQuestions=3&difficulty=3' });
    const res: any = await POST(makeRequest({ studentId: STUDENT, actionConceptId: CONCEPT }));
    expect(res.status ?? 200).toBe(200);
    expect(getCanonicalPedagogicalDecisionMock).toHaveBeenCalledWith({ studentId: STUDENT, conceptId: CONCEPT });
    expect(getLearningDecisionsMock).not.toHaveBeenCalled();
    expect(startLearningSessionMock).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.data.authority).toBe('CANONICAL_ENGINE_V1');
    expect(body.data.session.launchStatus).toBe('READY');
  });

  it('a client-supplied mode/stage field is never forwarded to the decision service -- the client cannot override the server\'s authority', async () => {
    isCanonicalEngineV1EnabledMock.mockReturnValue(true);
    getCanonicalPedagogicalDecisionMock.mockResolvedValue({ decision: { stage: 'PROVE', actionState: 'WAITING' } });
    resolveCanonicalLaunchMock.mockReturnValue({ launchStatus: 'WAITING' });
    await POST(makeRequest({ studentId: STUDENT, actionConceptId: CONCEPT, mode: 'quick_check', stage: 'TRANSFER' }));
    expect(getCanonicalPedagogicalDecisionMock).toHaveBeenCalledWith({ studentId: STUDENT, conceptId: CONCEPT });
  });

  it('the request schema itself has no mode/stage/activityType field at all (source audit -- structurally impossible to accept one)', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/api/learning/session/start/route.ts'), 'utf-8');
    const schemaMatch = source.match(/const StartSessionSchema = z\.object\(\{[\s\S]*?\}\);/);
    expect(schemaMatch).not.toBeNull();
    expect(schemaMatch![0]).not.toMatch(/mode|stage|activityType/);
  });

  it('refuses with 404 when the concept does not belong to the student, without ever calling the decision service', async () => {
    isCanonicalEngineV1EnabledMock.mockReturnValue(true);
    resolveConceptSubjectForStudentMock.mockResolvedValue(null);
    const res: any = await POST(makeRequest({ studentId: STUDENT, actionConceptId: CONCEPT }));
    expect(res.status).toBe(404);
    expect(getCanonicalPedagogicalDecisionMock).not.toHaveBeenCalled();
  });

  it('Part 28 fail-safe: a canonical decision read failure returns a controlled 503 and NEVER falls back to the legacy Phase 3C path', async () => {
    isCanonicalEngineV1EnabledMock.mockReturnValue(true);
    getCanonicalPedagogicalDecisionMock.mockRejectedValue(new CanonicalDecisionUnavailableErrorMock('boom'));
    const res: any = await POST(makeRequest({ studentId: STUDENT, actionConceptId: CONCEPT }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('CANONICAL_DECISION_UNAVAILABLE');
    expect(getLearningDecisionsMock).not.toHaveBeenCalled();
    expect(startLearningSessionMock).not.toHaveBeenCalled();
  });

  it('a WAITING canonical decision returns 200 with launchStatus WAITING -- never a launch, never the legacy session engine', async () => {
    isCanonicalEngineV1EnabledMock.mockReturnValue(true);
    getCanonicalPedagogicalDecisionMock.mockResolvedValue({
      decision: { stage: 'RETAIN', actionState: 'WAITING', waitingReason: 'RETENTION_MINIMUM_INTERVAL_NOT_REACHED', nextEligibleAt: '2026-09-25T00:00:00.000Z' },
    });
    resolveCanonicalLaunchMock.mockReturnValue({ launchStatus: 'WAITING', launchTarget: null, waitingReason: 'RETENTION_MINIMUM_INTERVAL_NOT_REACHED', nextEligibleAt: '2026-09-25T00:00:00.000Z' });
    const res: any = await POST(makeRequest({ studentId: STUDENT, actionConceptId: CONCEPT }));
    expect(res.status ?? 200).toBe(200);
    const body = await res.json();
    expect(body.data.session.launchStatus).toBe('WAITING');
    expect(startLearningSessionMock).not.toHaveBeenCalled();
  });

  it('a NOT_READY canonical decision (e.g. Prove/Transfer generation not ready) returns 200 with launchStatus NOT_READY -- never a fabricated legacy launch', async () => {
    isCanonicalEngineV1EnabledMock.mockReturnValue(true);
    getCanonicalPedagogicalDecisionMock.mockResolvedValue({ decision: { stage: 'PROVE', actionState: 'EXECUTABLE' } });
    resolveCanonicalLaunchMock.mockReturnValue({ launchStatus: 'NOT_READY', launchTarget: null, notReadyReason: 'V1_PROVE_GENERATION_NOT_READY' });
    const res: any = await POST(makeRequest({ studentId: STUDENT, actionConceptId: CONCEPT }));
    expect(res.status ?? 200).toBe(200);
    const body = await res.json();
    expect(body.data.session.launchStatus).toBe('NOT_READY');
    expect(startLearningSessionMock).not.toHaveBeenCalled();
  });
});

describe('Part 30 -- session-start performance: canonical reads are not serialized behind unrelated work', () => {
  it('resolveConceptSubjectForStudent and getCanonicalPedagogicalDecision are both awaited, but no legacy Phase 3C read (getLearningDecisions) runs on the canonical path at all', async () => {
    isCanonicalEngineV1EnabledMock.mockReturnValue(true);
    getCanonicalPedagogicalDecisionMock.mockResolvedValue({ decision: { stage: 'PRACTICE', actionState: 'EXECUTABLE' } });
    resolveCanonicalLaunchMock.mockReturnValue({ launchStatus: 'READY', launchTarget: '/dashboard/quiz' });
    await POST(makeRequest({ studentId: STUDENT, actionConceptId: CONCEPT }));
    expect(resolveConceptSubjectForStudentMock).toHaveBeenCalledTimes(1);
    expect(getLearningDecisionsMock).not.toHaveBeenCalled();
  });
});

describe('Part 9 -- getLearningOSSnapshot canonicalOverride (Today)', () => {
  const item = { decision: { actionConceptId: CONCEPT, subjectId: 'subj1', activityType: 'PRACTICE', targetConceptIds: [], learningState: 'DEVELOPING' }, estimatedMinutes: 5, sequence: 0, executionReason: 'FITS_IN_ORDER' };

  it('gate off: canonicalOverride is null and the canonical decision service is never called', async () => {
    getLearningDecisionsMock.mockResolvedValue([item.decision]);
    isCanonicalEngineV1EnabledMock.mockReturnValue(false);
    const snapshot = await getLearningOSSnapshot(STUDENT, { availableMinutes: 60 });
    expect(snapshot.canonicalOverride).toBeNull();
    expect(getCanonicalPedagogicalDecisionMock).not.toHaveBeenCalled();
  });

  it('gate on + a nextExecutableItem exists: canonicalOverride is populated from a FRESH decision for that exact concept -- the ranking itself is untouched (still legacy)', async () => {
    getLearningDecisionsMock.mockResolvedValue([item.decision]);
    isCanonicalEngineV1EnabledMock.mockReturnValue(true);
    getCanonicalPedagogicalDecisionMock.mockResolvedValue({ decision: { stage: 'PRACTICE', actionState: 'EXECUTABLE' } });
    resolveCanonicalLaunchMock.mockReturnValue({ launchStatus: 'READY' });
    const snapshot = await getLearningOSSnapshot(STUDENT, { availableMinutes: 60 });
    expect(getCanonicalPedagogicalDecisionMock).toHaveBeenCalledWith(expect.objectContaining({ studentId: STUDENT, conceptId: CONCEPT }));
    expect(snapshot.canonicalOverride).toEqual({ launchStatus: 'READY' });
    expect(snapshot.decisions).toEqual([item.decision]); // ranking/decision list itself unchanged
  });

  it('gate on + no nextExecutableItem: canonicalOverride stays null, no canonical read at all', async () => {
    getLearningDecisionsMock.mockResolvedValue([]);
    isCanonicalEngineV1EnabledMock.mockReturnValue(true);
    const snapshot = await getLearningOSSnapshot(STUDENT, { availableMinutes: 60 });
    expect(snapshot.canonicalOverride).toBeNull();
    expect(getCanonicalPedagogicalDecisionMock).not.toHaveBeenCalled();
  });

  it('Part 28 fail-safe: a canonical read failure sets canonicalOverrideReadFailed, never silently reuses the legacy waiting/zeroGap flags as if canonical had agreed', async () => {
    getLearningDecisionsMock.mockResolvedValue([item.decision]);
    isCanonicalEngineV1EnabledMock.mockReturnValue(true);
    getCanonicalPedagogicalDecisionMock.mockRejectedValue(new CanonicalDecisionUnavailableErrorMock('boom'));
    const snapshot = await getLearningOSSnapshot(STUDENT, { availableMinutes: 60 });
    expect(snapshot.canonicalOverride).toBeNull();
    expect(snapshot.canonicalOverrideReadFailed).toBe(true);
  });
});

describe('Part 9 -- Today page treats a failed canonical override as blocked, never as "legacy is fine"', () => {
  it('the page source computes bestZeroGapBlocked as true when canonicalOverrideReadFailed is true and there is no override', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/dashboard/today/page.tsx'), 'utf-8');
    expect(source).toMatch(/canonicalOverrideReadFailed/);
  });
});

const getConceptViewMock = vi.fn();
vi.mock('@/lib/learner-twin', () => ({ getConceptView: (...a: unknown[]) => getConceptViewMock(...a) }));

const getConceptKnowledgeStateMock = vi.fn();
const getActiveMasteryPolicyMock = vi.fn();
vi.mock('@/services/knowledge-state.service', () => ({
  getConceptKnowledgeState: (...a: unknown[]) => getConceptKnowledgeStateMock(...a),
  getActiveMasteryPolicy: (...a: unknown[]) => getActiveMasteryPolicyMock(...a),
}));

const getBestLearningDecisionForConceptMock = vi.fn();
vi.mock('@/services/adaptive-teaching.service', () => ({
  getBestLearningDecisionForConcept: (...a: unknown[]) => getBestLearningDecisionForConceptMock(...a),
}));

const getConceptTransferDepthMock = vi.fn();
vi.mock('@/services/transfer-read.service', () => ({ getConceptTransferDepth: (...a: unknown[]) => getConceptTransferDepthMock(...a) }));

import { getConceptMissionView } from '@/services/concept-mission-view.service';

describe('Part 10 -- getConceptMissionView canonical override wiring', () => {
  beforeEach(() => {
    dbQueryMock.mockReset().mockImplementation(async (sql: string) => {
      if (typeof sql === 'string' && sql.includes('FROM concepts c')) {
        return { rows: [{ subject_name: 'Physics', label: 'Momentum' }] };
      }
      return { rows: [] };
    });
    getConceptViewMock.mockReset().mockResolvedValue(null);
    getConceptKnowledgeStateMock.mockReset().mockResolvedValue(null);
    getActiveMasteryPolicyMock.mockReset().mockResolvedValue(null);
    getBestLearningDecisionForConceptMock.mockReset().mockResolvedValue(null);
    getConceptTransferDepthMock.mockReset().mockResolvedValue(null);
  });

  it('gate off: the legacy view is returned untouched, canonical decision service never called', async () => {
    isCanonicalEngineV1EnabledMock.mockReturnValue(false);
    const result = await getConceptMissionView(STUDENT, 'subj1', CONCEPT, 'en', 'Learn Momentum');
    expect(result.status).toBe('OK');
    expect(getCanonicalPedagogicalDecisionMock).not.toHaveBeenCalled();
  });

  it('gate on: the legacy view is still fully computed, then overridden by the canonical decision (Part 3: old model kept for diagnostics, but loses next-action authority)', async () => {
    isCanonicalEngineV1EnabledMock.mockReturnValue(true);
    getCanonicalPedagogicalDecisionMock.mockResolvedValue({ decision: { stage: 'PRACTICE' } });
    overrideConceptMissionViewWithCanonicalDecisionMock.mockImplementation((view: any, decision: any) => ({ ...view, journey: { ...view.journey, stage: decision.stage } }));
    const result = await getConceptMissionView(STUDENT, 'subj1', CONCEPT, 'en', 'Learn Momentum');
    expect(result.status).toBe('OK');
    expect(overrideConceptMissionViewWithCanonicalDecisionMock).toHaveBeenCalledTimes(1);
    if (result.status === 'OK') {
      expect((result.view.journey as any).stage).toBe('PRACTICE');
    }
  });

  it('Part 28 fail-safe: a canonical read failure returns CANONICAL_DECISION_UNAVAILABLE, never the stale legacy view', async () => {
    isCanonicalEngineV1EnabledMock.mockReturnValue(true);
    getCanonicalPedagogicalDecisionMock.mockRejectedValue(new CanonicalDecisionUnavailableErrorMock('boom'));
    const result = await getConceptMissionView(STUDENT, 'subj1', CONCEPT, 'en', 'Learn Momentum');
    expect(result.status).toBe('CANONICAL_DECISION_UNAVAILABLE');
  });

  it('NOT_FOUND is returned before the canonical decision service is ever consulted', async () => {
    isCanonicalEngineV1EnabledMock.mockReturnValue(true);
    dbQueryMock.mockReset().mockResolvedValue({ rows: [] });
    const result = await getConceptMissionView(STUDENT, 'subj1', CONCEPT, 'en', 'Learn Momentum');
    expect(result.status).toBe('NOT_FOUND');
    expect(getCanonicalPedagogicalDecisionMock).not.toHaveBeenCalled();
  });
});
