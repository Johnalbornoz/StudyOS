/**
 * F15 -> Track B -- deterministic tests for item-resolution.service.ts, the
 * server-authoritative exam delivery service. Covers: ownership (IDOR),
 * active-status enforcement, idempotent re-fetch (a refresh never swaps the
 * item), unavailable items (never fabricated), answer-key isolation, grading
 * delegated to recordSimulationItemResponse with the SERVER-held item,
 * tampered answers rejected before anything is recorded, navigation policy,
 * autosave, compare-and-swap retries, HARD section deadlines, breaks,
 * inactivity expiry, skip and hand-in finalization.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let writtenNav: any[] = [];
let casFailuresLeft = 0;
const otherQueries: Array<{ sql: string; params: any[] }> = [];
const queryMock = vi.fn(async (sql: string, params: any[] = []) => {
  if (/UPDATE simulation_attempts SET navigation_state = \$2/.test(sql)) {
    if (casFailuresLeft > 0) {
      casFailuresLeft--;
      return { rows: [], rowCount: 0 };
    }
    writtenNav.push(JSON.parse(params[1]));
    return { rows: [{ id: params[0] }], rowCount: 1 };
  }
  otherQueries.push({ sql, params });
  return { rows: [], rowCount: 1 };
});
vi.mock('@/lib/db', () => ({ db: { query: (sql: string, params?: any[]) => queryMock(sql, params) } }));

const isOwnerMock = vi.fn();
vi.mock('@/lib/authorization', () => ({ isOwner: (...a: any[]) => isOwnerMock(...a) }));

const getSimulationAttemptMock = vi.fn();
vi.mock('@/lib/simulation/attempt.service', () => ({ getSimulationAttempt: (...a: any[]) => getSimulationAttemptMock(...a) }));

const getSimulationPlanByIdMock = vi.fn();
vi.mock('@/lib/simulation/plan.service', () => ({
  getSimulationPlanById: (...a: any[]) => getSimulationPlanByIdMock(...a),
  deriveSections: () => [],
}));

const getObjectiveTargetMock = vi.fn();
vi.mock('@/lib/assessment/blueprint.service', () => ({ getObjectiveTarget: (...a: any[]) => getObjectiveTargetMock(...a) }));
vi.mock('@/lib/assessment/component.service', () => ({ listComponentsForVersion: async () => [] }));

const sourceExamItemMock = vi.fn();
vi.mock('@/lib/exam-core/item-sourcing.service', () => ({ sourceExamItem: (...a: any[]) => sourceExamItemMock(...a) }));

const recordSimulationItemResponseMock = vi.fn();
vi.mock('@/lib/simulation/scoring.service', () => ({ recordSimulationItemResponse: (...a: any[]) => recordSimulationItemResponseMock(...a) }));

import {
  getNextSimulationItem,
  submitSimulationItemAnswer,
  skipUnavailableSimulationItem,
  saveSimulationItemDraft,
  endSimulationBreak,
  finalizeOpenItemsForSubmission,
  SimulationItemAccessDeniedError,
  SimulationItemNotFoundError,
  SimulationItemNotActiveError,
  SimulationItemNoPendingItemError,
  SimulationNavigationError,
  SimulationInvalidResponseError,
} from '@/lib/simulation/item-resolution.service';
import { findAnswerKeyLeak, type ExamItem } from '@/lib/exam-core/items';
import type { ResolvedDeliveryPolicy } from '@/lib/exam-core/delivery-policy';

const NOW = new Date().toISOString();

function policy(over: Partial<ResolvedDeliveryPolicy> = {}): ResolvedDeliveryPolicy {
  return { v: 1, navigation: 'LINEAR', breaks: [], itemFeedback: 'NEVER', resultReview: 'FULL', permittedResources: [], timeLimit: 'NONE', pauseAllowed: true, tutorAssistance: 'BLOCKED', inactivityExpiryHours: 24, ...over };
}

const SECTIONS = [
  { componentId: 'comp-a', key: 'a', name: 'Section A', order: 0, startIndex: 0, endIndex: 1, durationSeconds: 600 },
  { componentId: 'comp-b', key: 'b', name: 'Section B', order: 1, startIndex: 2, endIndex: 2, durationSeconds: 600 },
];

function nav(over: Record<string, unknown> = {}) {
  return { v: 2, rev: 3, policy: policy(), sections: SECTIONS, sectionIndex: 0, sectionStartedAt: NOW, sectionPausedSeconds: 0, breakUntil: null, items: {}, visitedTargetIds: [], lastActivityAt: NOW, ...over };
}

function attempt(over: Record<string, unknown> = {}) {
  return {
    id: 'attempt-1',
    examAttemptId: 'exam-attempt-1',
    studentId: 'student-1',
    examProfileId: 'profile-1',
    examVersionId: 'version-1',
    simulationType: 'FULL_MOCK',
    simulationPlanId: 'plan-1',
    readinessSnapshotId: null,
    timingMode: 'UNTIMED',
    pauseAllowed: true,
    status: 'ACTIVE',
    pausedAt: null,
    resumedAt: null,
    elapsedSecondsAtPause: null,
    navigationState: nav(),
    language: 'es',
    timezone: null,
    createdAt: NOW,
    ...over,
  };
}

const PLAN = {
  id: 'plan-1',
  studentId: 'student-1',
  examVersionId: 'version-1',
  blueprintId: 'bp-1',
  simulationType: 'FULL_MOCK',
  readinessSnapshotId: null,
  selectedTargets: [
    { blueprintObjectiveTargetId: 'bot-0', assessmentComponentId: 'comp-a', questionType: null, difficultyRange: null, reasoningRequirement: null, commandTermId: null, allocatedSeconds: null },
    { blueprintObjectiveTargetId: 'bot-1', assessmentComponentId: 'comp-a', questionType: null, difficultyRange: null, reasoningRequirement: null, commandTermId: null, allocatedSeconds: null },
    { blueprintObjectiveTargetId: 'bot-2', assessmentComponentId: 'comp-b', questionType: null, difficultyRange: null, reasoningRequirement: null, commandTermId: null, allocatedSeconds: null },
  ],
  timingAllocation: { mode: 'UNTIMED', totalSeconds: null },
  toolRules: {},
  scoringConfiguration: { scoringModelId: 'sm-1' },
  sections: SECTIONS,
  createdAt: NOW,
};

function item(id = 'item-1'): ExamItem {
  return {
    id,
    conceptId: '',
    type: 'multiple_choice',
    answerFormat: 'single_choice',
    question: `What is ${id}?`,
    options: [
      { id: 'A', text: 'one' },
      { id: 'B', text: 'two' },
    ],
    correctAnswer: 'B',
    explanation: 'because',
    difficulty: 3,
    learningObjectiveId: 'lo-1',
    exam: { source: 'APPROVED_BANK', approvedItemId: id, key: id, contentStatus: 'DEV_CERT_FIXTURE', marks: 2, stimulus: { key: 's1', title: 'Passage', text: 'Text' }, parts: null, acceptableAnswers: null, numericTolerance: null, commandTerm: null },
  };
}

const CTX = { assessmentComponentId: 'comp-a', learningObjectiveId: 'lo-1', commandTermId: null };

beforeEach(() => {
  writtenNav = [];
  casFailuresLeft = 0;
  otherQueries.length = 0;
  queryMock.mockClear();
  isOwnerMock.mockReset().mockResolvedValue(true);
  getSimulationAttemptMock.mockReset().mockResolvedValue(attempt());
  getSimulationPlanByIdMock.mockReset().mockResolvedValue(PLAN);
  getObjectiveTargetMock.mockReset().mockResolvedValue({ id: 'bot-0', learningObjectiveId: 'lo-1' });
  sourceExamItemMock.mockReset().mockResolvedValue({ outcome: 'READY', item: item() });
  recordSimulationItemResponseMock.mockReset().mockResolvedValue({ responseId: 'resp-1', evaluation: { score: 2, maxScore: 2, feedback: 'ok' }, evidenceWritten: false, duplicate: false, grade: { status: 'ANSWERED' } });
});

describe('ownership and status (IDOR)', () => {
  it('NOT_FOUND for an unknown attempt id', async () => {
    getSimulationAttemptMock.mockResolvedValue(null);
    await expect(getNextSimulationItem('actor-1', 'nope')).rejects.toBeInstanceOf(SimulationItemNotFoundError);
  });

  it('a non-owner (another student, parent, teacher) can never fetch, autosave, answer or hand in', async () => {
    isOwnerMock.mockResolvedValue(false);
    await expect(getNextSimulationItem('intruder', 'attempt-1')).rejects.toBeInstanceOf(SimulationItemAccessDeniedError);
    await expect(saveSimulationItemDraft('intruder', 'attempt-1', 0, 'A')).rejects.toBeInstanceOf(SimulationItemAccessDeniedError);
    await expect(submitSimulationItemAnswer('intruder', 'attempt-1', 'A', 'k', 0)).rejects.toBeInstanceOf(SimulationItemAccessDeniedError);
    await expect(finalizeOpenItemsForSubmission('intruder', 'attempt-1')).rejects.toBeInstanceOf(SimulationItemAccessDeniedError);
    expect(sourceExamItemMock).not.toHaveBeenCalled();
    expect(recordSimulationItemResponseMock).not.toHaveBeenCalled();
    expect(writtenNav).toHaveLength(0);
  });

  it.each(['PAUSED', 'COMPLETED', 'ABANDONED'])('a %s attempt never delivers or accepts an item', async (status) => {
    getSimulationAttemptMock.mockResolvedValue(attempt({ status }));
    await expect(getNextSimulationItem('actor-1', 'attempt-1')).rejects.toBeInstanceOf(SimulationItemNotActiveError);
    await expect(submitSimulationItemAnswer('actor-1', 'attempt-1', 'A')).rejects.toBeInstanceOf(SimulationItemNotActiveError);
  });

  it('an attempt idle beyond its frozen inactivity expiry is closed (ABANDONED) on access and never resumed', async () => {
    getSimulationAttemptMock.mockResolvedValue(attempt({ navigationState: nav({ lastActivityAt: new Date(Date.now() - 30 * 3600 * 1000).toISOString() }) }));
    await expect(getNextSimulationItem('actor-1', 'attempt-1')).rejects.toBeInstanceOf(SimulationItemNotActiveError);
    expect(otherQueries.some((q) => /UPDATE simulation_attempts SET status = 'ABANDONED'/.test(q.sql))).toBe(true);
    expect(otherQueries.some((q) => /UPDATE exam_attempts SET status = 'ABANDONED'/.test(q.sql))).toBe(true);
  });
});

describe('server-authoritative delivery', () => {
  it('sources the item, persists the SERVER copy (with its key) and sends the client a key-free item', async () => {
    const r = await getNextSimulationItem('actor-1', 'attempt-1');
    expect(r.outcome).toBe('ITEM_READY');
    if (r.outcome !== 'ITEM_READY') return;
    expect(r.targetIndex).toBe(0);
    expect(findAnswerKeyLeak(r)).toBeNull();
    expect((r.question as any).correctAnswer).toBeUndefined();
    expect(r.question.stimulus?.text).toBe('Text');
    expect(r.question.marks).toBe(2);
    expect(writtenNav).toHaveLength(1);
    expect(writtenNav[0].items['0'].item.correctAnswer).toBe('B');
    expect(writtenNav[0].rev).toBe(4);
  });

  it('a repeated fetch returns the SAME delivered item and its autosaved draft (refresh recovery), sourcing nothing', async () => {
    getSimulationAttemptMock.mockResolvedValue(attempt({ navigationState: nav({ items: { '0': { status: 'DELIVERED', item: item('kept'), ctx: CTX, draft: 'A' } } }) }));
    const r = await getNextSimulationItem('actor-1', 'attempt-1');
    expect(sourceExamItemMock).not.toHaveBeenCalled();
    expect(r.outcome === 'ITEM_READY' && r.question.question).toBe('What is kept?');
    expect(r.outcome === 'ITEM_READY' && r.draft).toBe('A');
  });

  it('ITEM_UNAVAILABLE when no item can be sourced -- never a fabricated question', async () => {
    sourceExamItemMock.mockResolvedValue({ outcome: 'UNAVAILABLE', reason: 'CONCEPT_NOT_MATCHED' });
    const r = await getNextSimulationItem('actor-1', 'attempt-1');
    expect(r).toMatchObject({ outcome: 'ITEM_UNAVAILABLE', reason: 'CONCEPT_NOT_MATCHED', targetIndex: 0 });
  });

  it('COMPLETE once every section is resolved', async () => {
    getSimulationAttemptMock.mockResolvedValue(attempt({ navigationState: nav({ sectionIndex: 2 }) }));
    expect((await getNextSimulationItem('actor-1', 'attempt-1')).outcome).toBe('COMPLETE');
  });

  it('a pre-Track-B pending question (legacy navigation state) is served unchanged, not regenerated', async () => {
    const legacy = { currentTargetIndex: 0, visitedTargetIds: [], pendingQuestion: { ...item('legacy'), exam: undefined }, pendingQuestionTargetIndex: 0, pendingObjectiveContext: CTX };
    getSimulationAttemptMock.mockResolvedValue(attempt({ navigationState: legacy }));
    const r = await getNextSimulationItem('actor-1', 'attempt-1');
    expect(sourceExamItemMock).not.toHaveBeenCalled();
    expect(r.outcome === 'ITEM_READY' && r.question.question).toBe('What is legacy?');
  });

  it('retries on a compare-and-swap conflict instead of losing an update', async () => {
    casFailuresLeft = 1;
    const r = await getNextSimulationItem('actor-1', 'attempt-1');
    expect(r.outcome).toBe('ITEM_READY');
    expect(getSimulationAttemptMock).toHaveBeenCalledTimes(2);
    expect(writtenNav).toHaveLength(1);
  });
});

describe('navigation policy', () => {
  it('LINEAR: a later item of the section cannot be opened before the current one', async () => {
    await expect(getNextSimulationItem('actor-1', 'attempt-1', 1)).rejects.toBeInstanceOf(SimulationNavigationError);
  });
  it('FREE_ORDER_WITHIN_SECTION: any open item of the current section can be opened', async () => {
    getSimulationAttemptMock.mockResolvedValue(attempt({ navigationState: nav({ policy: policy({ navigation: 'FREE_ORDER_WITHIN_SECTION' }) }) }));
    const r = await getNextSimulationItem('actor-1', 'attempt-1', 1);
    expect(r.outcome === 'ITEM_READY' && r.targetIndex).toBe(1);
  });
  it('an item of a later section is never reachable before its section', async () => {
    getSimulationAttemptMock.mockResolvedValue(attempt({ navigationState: nav({ policy: policy({ navigation: 'FREE_ORDER_WITHIN_SECTION' }) }) }));
    await expect(getNextSimulationItem('actor-1', 'attempt-1', 2)).rejects.toBeInstanceOf(SimulationNavigationError);
  });
  it('a configured break starts once a section is fully resolved, and can be ended early', async () => {
    getSimulationAttemptMock.mockResolvedValue(
      attempt({ navigationState: nav({ policy: policy({ breaks: [{ afterSectionKey: 'a', minutes: 5 }] }), items: { '0': { status: 'ANSWERED' }, '1': { status: 'ANSWERED' } } }) })
    );
    const r = await getNextSimulationItem('actor-1', 'attempt-1');
    expect(r.outcome).toBe('BREAK');
    expect(writtenNav[0].sectionIndex).toBe(1);
    expect(writtenNav[0].breakUntil).toBeTruthy();
    getSimulationAttemptMock.mockResolvedValue(attempt({ navigationState: writtenNav[0] }));
    expect(await endSimulationBreak('actor-1', 'attempt-1')).toEqual({ ended: true });
    expect(writtenNav[1].breakUntil).toBeNull();
  });
});

describe('answers', () => {
  const delivered = () => attempt({ navigationState: nav({ items: { '0': { status: 'DELIVERED', item: item(), ctx: CTX } } }) });

  it('NO_PENDING_ITEM when nothing was delivered at that position', async () => {
    await expect(submitSimulationItemAnswer('actor-1', 'attempt-1', 'A', 'k', 0)).rejects.toBeInstanceOf(SimulationItemNoPendingItemError);
    expect(recordSimulationItemResponseMock).not.toHaveBeenCalled();
  });

  it('grades the SERVER-held item via recordSimulationItemResponse (answer string only), marks it ANSWERED', async () => {
    getSimulationAttemptMock.mockResolvedValue(delivered());
    const r = await submitSimulationItemAnswer('actor-1', 'attempt-1', 'B', 'key-1', 0);
    const call = recordSimulationItemResponseMock.mock.calls[0][0];
    expect(call.question.correctAnswer).toBe('B'); // the server copy, never a client object
    expect(call.studentAnswer).toBe('B');
    expect(call.targetIndex).toBe(0);
    expect(call.idempotencyKey).toBe('key-1');
    expect(call.studentId).toBe('student-1');
    expect(call.examVersionId).toBe('version-1');
    expect(writtenNav[0].items['0'].status).toBe('ANSWERED');
    expect(r.evaluation).toBeNull(); // policy: no item feedback during the attempt
  });

  it('item feedback is returned only when the frozen policy allows it', async () => {
    getSimulationAttemptMock.mockResolvedValue(attempt({ navigationState: nav({ policy: policy({ itemFeedback: 'AFTER_EACH_ITEM' }), items: { '0': { status: 'DELIVERED', item: item(), ctx: CTX } } }) }));
    const r = await submitSimulationItemAnswer('actor-1', 'attempt-1', 'B', 'k', 0);
    expect(r.evaluation).toEqual({ score: 2, maxScore: 2, feedback: 'ok' });
  });

  it('a tampered structured answer (not producible by the controls) is rejected and NOTHING is recorded', async () => {
    getSimulationAttemptMock.mockResolvedValue(delivered());
    await expect(submitSimulationItemAnswer('actor-1', 'attempt-1', JSON.stringify({ correctAnswer: 'B' }), 'k', 0)).rejects.toBeInstanceOf(SimulationInvalidResponseError);
    await expect(submitSimulationItemAnswer('actor-1', 'attempt-1', 'Z', 'k', 0)).rejects.toBeInstanceOf(SimulationInvalidResponseError);
    expect(recordSimulationItemResponseMock).not.toHaveBeenCalled();
    expect(writtenNav).toHaveLength(0);
  });

  it('a committed item cannot be answered again', async () => {
    getSimulationAttemptMock.mockResolvedValue(attempt({ navigationState: nav({ items: { '0': { status: 'ANSWERED', item: item(), ctx: CTX } } }) }));
    await expect(submitSimulationItemAnswer('actor-1', 'attempt-1', 'B', 'k2', 0)).rejects.toBeInstanceOf(SimulationItemNoPendingItemError);
    expect(recordSimulationItemResponseMock).not.toHaveBeenCalled();
  });

  it('autosave stores a draft for a delivered item and never grades it', async () => {
    getSimulationAttemptMock.mockResolvedValue(delivered());
    const r = await saveSimulationItemDraft('actor-1', 'attempt-1', 0, 'A');
    expect(r.targetIndex).toBe(0);
    expect(writtenNav[0].items['0']).toMatchObject({ status: 'DELIVERED', draft: 'A' });
    expect(recordSimulationItemResponseMock).not.toHaveBeenCalled();
  });

  it('skip only applies to an item the platform could not prepare; it records no response and excludes it', async () => {
    getSimulationAttemptMock.mockResolvedValue(attempt({ navigationState: nav({ items: { '0': { status: 'UNAVAILABLE', unavailableReason: 'NO_ITEM_GENERATED', ctx: CTX } } }) }));
    const r = await skipUnavailableSimulationItem('actor-1', 'attempt-1');
    expect(r.targetIndex).toBe(0);
    expect(writtenNav[0].items['0'].status).toBe('EXCLUDED');
    expect(recordSimulationItemResponseMock).not.toHaveBeenCalled();
    getSimulationAttemptMock.mockResolvedValue(delivered());
    await expect(skipUnavailableSimulationItem('actor-1', 'attempt-1', 0)).rejects.toBeInstanceOf(SimulationItemNoPendingItemError);
  });
});

describe('timing and submission integrity', () => {
  it('HARD limit: past the section deadline, drafts are committed and the rest becomes MISSING', async () => {
    const past = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    getSimulationAttemptMock.mockResolvedValue(
      attempt({ timingMode: 'OFFICIAL_SIMULATION_TIMED', navigationState: nav({ policy: policy({ timeLimit: 'HARD' }), sectionStartedAt: past, items: { '0': { status: 'DELIVERED', item: item(), ctx: CTX, draft: 'B' } } }) })
    );
    const r = await getNextSimulationItem('actor-1', 'attempt-1');
    expect(recordSimulationItemResponseMock).toHaveBeenCalledTimes(1);
    expect(recordSimulationItemResponseMock.mock.calls[0][0]).toMatchObject({ studentAnswer: 'B', targetIndex: 0, idempotencyKey: 'auto:attempt-1:0' });
    const written = writtenNav[writtenNav.length - 1];
    expect(written.items['1'].status).toBe('MISSING');
    expect(written.sectionIndex).toBe(1);
    expect(r.outcome === 'ITEM_READY' && r.targetIndex).toBe(2);
  });

  it('SOFT limit (training): over time is reported, never enforced', async () => {
    const past = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    getSimulationAttemptMock.mockResolvedValue(attempt({ navigationState: nav({ policy: policy({ timeLimit: 'SOFT' }), sectionStartedAt: past }) }));
    const r = await getNextSimulationItem('actor-1', 'attempt-1');
    expect(r.outcome === 'ITEM_READY' && r.targetIndex).toBe(0);
    expect(r.outcome === 'ITEM_READY' && (r.section.remainingSeconds ?? 0) < 0).toBe(true);
  });

  it('hand-in commits autosaved drafts, marks the rest MISSING / EXCLUDED, and works from PAUSED', async () => {
    getSimulationAttemptMock.mockResolvedValue(
      attempt({
        status: 'PAUSED',
        navigationState: nav({ items: { '0': { status: 'DELIVERED', item: item(), ctx: CTX, draft: 'A' }, '1': { status: 'UNAVAILABLE', ctx: CTX } } }),
      })
    );
    const r = await finalizeOpenItemsForSubmission('actor-1', 'attempt-1');
    expect(r).toEqual({ committedDrafts: 1, missing: 1, safetySignal: null }); // Human Agency P0-4: no draft carried a safety signal
    expect(recordSimulationItemResponseMock.mock.calls[0][0]).toMatchObject({ studentAnswer: 'A', idempotencyKey: 'final:attempt-1:0' });
    const written = writtenNav[0];
    expect(written.items['1'].status).toBe('EXCLUDED');
    expect(written.items['2'].status).toBe('MISSING');
    expect(written.sectionIndex).toBe(2);
  });
});
