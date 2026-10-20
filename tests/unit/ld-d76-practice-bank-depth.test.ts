/**
 * D76 -- PRACTICE BANK DEPTH TARGET = 9 (approved).
 *
 * The governed minimum depth of a learner's PRACTICE bank for a concept is 9
 * distinct VALID items (3 sessions x 3 questions before controlled reuse).
 * Below it, the EXISTING replenishment path (PREPARE_INVENTORY ->
 * BANK_REPLENISH -> certified generators -> addValidatedCandidates with the
 * P1-03 gate) generates toward 9, asynchronously and deduplicated; at or
 * above it nothing is requested. Practice never deadlocks on a shallow bank:
 * it delivers from the valid items it has (controlled reuse, least recently
 * delivered first) and records PRACTICE_BANK_DEPTH_INSUFFICIENT on the session.
 *
 * Mocked DB, queue and generators; no provider.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  query: vi.fn(),
  decision: vi.fn(),
  launch: vi.fn(),
  reconcile: vi.fn(),
  reserved: vi.fn(),
  store: vi.fn(),
  consume: vi.fn(),
  assemble: vi.fn(),
  spare: vi.fn(),
  depth: vi.fn(),
  enqueue: vi.fn(),
  inFlight: vi.fn(),
  generate: vi.fn(),
  resume: vi.fn(),
  storeQuiz: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => h.query(...a) }, query: (...a: any[]) => h.query(...a) }));
vi.mock('@/lib/pedagogical-decision', () => ({
  getCanonicalPedagogicalDecision: (...a: any[]) => h.decision(...a),
  resolveCanonicalLaunch: (...a: any[]) => h.launch(...a),
  resolveAuthorizedItemCount: (c: any) => c?.max ?? null,
}));
vi.mock('@/services/activity-delivery-context.service', () => ({
  loadAcademicContext: async () => ({ curriculum: null, programme: 'none', year: null, subjectGroup: null, level: null }),
  loadLearnerStateSnapshot: async () => ({ evidenceCount: 1, lastEvidenceId: 'e1', criticalMisconceptions: 0, hintsUsed: 0 }),
}));
vi.mock('@/services/activity-inventory.service', () => ({
  reconcileInventory: (...a: any[]) => h.reconcile(...a),
  reservedCandidateIds: (...a: any[]) => h.reserved(...a),
  retireAllInventory: vi.fn(),
  storeReadyActivity: (...a: any[]) => h.store(...a),
  consumeCompatibleInventory: (...a: any[]) => h.consume(...a),
  linkConsumedActivity: vi.fn(),
}));
vi.mock('@/services/activity-assembly.service', () => ({
  assembleActivityForLearner: (...a: any[]) => h.assemble(...a),
  countSpareSets: (...a: any[]) => h.spare(...a),
  countValidBankDepth: (...a: any[]) => h.depth(...a),
}));
vi.mock('@/services/generation-queue.service', () => ({
  enqueueGenerationJob: (...a: any[]) => h.enqueue(...a),
  openBankSupply: (...a: any[]) => h.inFlight(...a),
  runGenerationWorker: vi.fn(),
}));
vi.mock('@/services/activity-launch-lock.service', () => ({
  acquireLaunchLock: async () => ({ release: async () => {} }),
  launchLockKey: (i: any) => `${i.studentId}:${i.conceptId}:${i.quizMode}`,
  launchLockId: () => '1',
  withLaunchLock: async (_i: any, fn: () => any) => fn(),
}));
vi.mock('@/services/worker-dispatch.service', () => ({ dispatchDeliveryWorker: vi.fn() }));
vi.mock('@/services/activity-candidate-generation.service', () => ({ generateActivityCandidates: (...a: any[]) => h.generate(...a) }));
vi.mock('@/services/subject-generation-context.service', () => ({ getSubjectIBContext: async () => null, resolveLanguageForSubject: async () => 'es' }));
vi.mock('@/services/learn-weakness.service', () => ({ getLearnWeaknessesForConcept: async () => null, recordLearnWeaknessProvenance: vi.fn() }));
vi.mock('@/services/ask-confidence.service', () => ({ computeAskConfidenceFlags: async () => new Map() }));
vi.mock('@/services/quiz-persistence.service', async (orig) => ({
  ...(await orig<typeof import('@/services/quiz-persistence.service')>()),
  findResumableCanonicalSession: (...a: any[]) => h.resume(...a),
  storeQuiz: (...a: any[]) => h.storeQuiz(...a),
}));

import { BANK_DEPTH_TARGET, bankDepthTarget, PRACTICE_BANK_DEPTH_INSUFFICIENT } from '@/lib/activity-delivery/contract';
import { assembleFromBank, countValidCandidates, type BankCandidate } from '@/lib/activity-delivery/assembly';
import { prepareInventoryHandler, bankReplenishHandler } from '@/services/activity-delivery-worker.service';
import { deliverCanonicalActivity } from '@/services/activity-delivery.service';

const Q = (i: number, over: object = {}): any => ({
  id: `q${i}`, conceptId: 'c1', type: 'numeric_problem', answerFormat: 'text', difficulty: 3,
  question: `${i + 3} zorbl${i}s cuestan ${i * 7 + 11} flur${i}s. ¿Cuánto cuestan ${i + 9}?`, correctAnswer: String(i), explanation: 'e', ...over,
});
const cand = (q: any, over: Partial<BankCandidate> = {}): BankCandidate => ({
  id: `b-${q.id}`, question: q, difficulty: 3, contentFingerprint: `fp-${q.id}`, transferDepth: null, usageCount: 0, delivered: false, lastDeliveredAt: null, ...over,
});
// P1-03 fixtures (the same as br-grading-p1-item-validation.test.ts)
const INVALID_MCQ = {
  type: 'multiple_choice', answerFormat: 'single_choice', correctAnswer: 'A', difficulty: 3, conceptId: 'c1', id: 'bad',
  question: '¿En cuál de las siguientes ecuaciones el valor x = 3 es una solución?',
  options: [{ id: 'A', text: '2x + 1 = 8' }, { id: 'B', text: '4x - 2 = 9' }, { id: 'C', text: 'x + 5 = 10' }, { id: 'D', text: '3x + 4 = 12' }],
  explanation: 'Al sustituir x = 3 en 2x + 1 = 8, resulta 2·3 + 1 = 7, no 8. Por tanto, revisa la sustitución para identificar correctamente la ecuación cuya igualdad se cumple.',
};
const VALID_MCQ = {
  type: 'multiple_choice', answerFormat: 'single_choice', correctAnswer: 'B', difficulty: 3, conceptId: 'c1', id: 'good',
  question: '¿Cuál es el valor de x en la ecuación 5x - 3 = 2x + 12?',
  options: [{ id: 'A', text: 'x = 3' }, { id: 'B', text: 'x = 5' }, { id: 'C', text: 'x = 9' }, { id: 'D', text: 'x = 15' }],
  explanation: 'Restamos 2x a ambos lados: 3x - 3 = 12. Sumamos 3: 3x = 15. Finalmente, dividimos entre 3 y obtenemos x = 5.',
};

const PRACTICE_REQ = { activityType: 'PRACTICE' as const, itemCount: 3, difficulty: { min: 2, max: 4, target: 3 }, language: 'es', excludeFingerprints: new Set<string>(), reservedCandidateIds: new Set<string>() };
const TARGET = { studentId: 's1', subjectId: 'sub1', conceptId: 'c1' };
const job = (payload: any, dedupKey = 'prepare:s1:c1'): any => ({ id: 'j1', kind: 'PREPARE_INVENTORY', dedupKey, payload, attempts: 1, maxAttempts: 3 });

function practiceDecision() {
  h.decision.mockResolvedValue({
    decision: { activityContract: { difficulty: { min: 2, max: 4, target: 3 }, itemCount: { min: 3, max: 3 }, independence: false }, policyVersion: 'v1', canonicalRevision: 'r' },
  });
  h.launch.mockReturnValue({ launchStatus: 'READY', launchParams: { mode: 'topic_practice' } });
}
const bankJobs = () => h.enqueue.mock.calls.filter((c) => c[0] === 'BANK_REPLENISH');

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset();
  h.query.mockResolvedValue({ rows: [] });
  h.reconcile.mockResolvedValue({ readyCompatible: 2, usedSlots: [0, 1] }); // inventory already full -> only the depth check runs
  h.reserved.mockResolvedValue(new Set());
  h.spare.mockResolvedValue(0);
  h.inFlight.mockResolvedValue(0);
  h.enqueue.mockResolvedValue(true);
  h.resume.mockResolvedValue(null);
  h.storeQuiz.mockResolvedValue('quiz-new');
  h.consume.mockResolvedValue(null);
  practiceDecision();
});

describe('D76 -- the governed constant', () => {
  it('PRACTICE depth target is 9; every other activity keeps the set-based policy (no target)', () => {
    expect(BANK_DEPTH_TARGET).toEqual({ PRACTICE: 9 });
    expect(bankDepthTarget('PRACTICE')).toBe(9);
    for (const t of ['LEARN_CHECK', 'PROVE', 'RETAIN', 'TRANSFER'] as const) expect(bankDepthTarget(t)).toBeNull();
  });

  it('depth counts DISTINCT VALID items: in band, deliverable (P1-03), not novelty-excluded; deliveries/reservations do not reduce it', () => {
    const pool = [
      cand(Q(0)), cand(Q(1), { delivered: true }), cand(Q(2)),
      cand(Q(3), { difficulty: 5 }), // out of band
      cand(INVALID_MCQ as any, { contentFingerprint: 'fp-bad' }), // P1-03 invalid
      cand(VALID_MCQ as any, { contentFingerprint: 'fp-good' }),
      cand(Q(0), { id: 'dup', contentFingerprint: 'fp-q0' }), // same content twice
    ];
    expect(countValidCandidates(pool, PRACTICE_REQ)).toBe(4);
  });
});

describe('D76 -- replenishment toward 9 through the EXISTING PREPARE_INVENTORY -> BANK_REPLENISH path', () => {
  it('depth < 9 (the QA case: 3) -> BANK_REPLENISH for the missing 6, one deduplicated chunk', async () => {
    h.depth.mockResolvedValue(3);
    const r = await prepareInventoryHandler(job(TARGET));
    expect(r.ok).toBe(true);
    expect(bankJobs()).toHaveLength(1);
    expect(bankJobs()[0][1]).toMatch(/^bank:c1:PRACTICE:es:[0-9a-f]+:c0$/); // the existing dedup key (one open job per key)
    expect(bankJobs()[0][2]).toMatchObject({ activityType: 'PRACTICE', needed: 6, round: 1 });
    expect((r as any).result).toMatchObject({ validDepth: 3, depthTarget: 9, bankJobs: 1 });
  });

  it('generation already in flight is subtracted (repeated triggers never over-generate)', async () => {
    h.depth.mockResolvedValue(3);
    h.inFlight.mockResolvedValue(4);
    await prepareInventoryHandler(job(TARGET));
    expect(bankJobs()[0][2]).toMatchObject({ needed: 2 });
    h.enqueue.mockClear();
    h.inFlight.mockResolvedValue(6);
    await prepareInventoryHandler(job(TARGET));
    expect(bankJobs()).toHaveLength(0);
  });

  it('depth >= 9 -> no replenishment (even though the set-based spare count would have asked for more)', async () => {
    h.depth.mockResolvedValue(9);
    h.spare.mockResolvedValue(0);
    await prepareInventoryHandler(job(TARGET));
    expect(bankJobs()).toHaveLength(0);
    h.depth.mockResolvedValue(14);
    await prepareInventoryHandler(job(TARGET));
    expect(bankJobs()).toHaveLength(0);
  });

  it('depth >= 9 but an assembly actually came up short -> the existing bankShort rule still requests one set', async () => {
    h.depth.mockResolvedValue(9);
    h.reconcile.mockResolvedValue({ readyCompatible: 0, usedSlots: [] });
    h.assemble.mockResolvedValue({ status: 'SHORT', available: 1, needed: 3 });
    await prepareInventoryHandler(job(TARGET));
    expect(bankJobs()).toHaveLength(1);
    expect(bankJobs()[0][2]).toMatchObject({ needed: 3 });
  });

  it('the depth measured is stored with each READY set it prepares (so an INVENTORY delivery can report it)', async () => {
    h.depth.mockResolvedValue(3);
    h.reconcile.mockResolvedValue({ readyCompatible: 0, usedSlots: [] });
    h.assemble.mockResolvedValue({ status: 'ASSEMBLED', questions: [Q(0), Q(1), Q(2)], candidateIds: ['a', 'b', 'c'] });
    h.store.mockResolvedValue(true);
    await prepareInventoryHandler(job(TARGET));
    expect(h.store).toHaveBeenCalledTimes(2);
    expect(h.store.mock.calls[0][0].bankDepth).toEqual({ validItems: 3, target: 9 });
  });

  it('PROVE (no depth target) keeps the set-based policy and never measures depth', async () => {
    h.decision.mockResolvedValue({
      decision: { activityContract: { difficulty: { min: 2, max: 4, target: 3 }, itemCount: { min: 10, max: 10 }, independence: true }, policyVersion: 'v1', canonicalRevision: 'r' },
    });
    h.launch.mockReturnValue({ launchStatus: 'READY', launchParams: { mode: 'canonical_prove' } });
    h.reconcile.mockResolvedValue({ readyCompatible: 1, usedSlots: [0] });
    h.spare.mockResolvedValue(1);
    await prepareInventoryHandler(job(TARGET));
    expect(h.depth).not.toHaveBeenCalled();
    expect(bankJobs()[0][2]).toMatchObject({ activityType: 'PROVE', needed: 10 });
  });
});

describe('D76 -- BANK_REPLENISH admits only VALID items (quality gates + P1-03), with provenance', () => {
  const payload = { ...TARGET, activityType: 'PRACTICE', language: 'es', academic: {}, difficulty: 3, needed: 6, round: 1 };
  const GEN = { provider: 'p', model: 'm', promptId: 'pid', promptVersion: 'v', operationId: 'op' };

  it('a valid item is admitted (generator provenance persisted); an invalid MCQ is rejected; the remainder is re-queued (bounded rounds)', async () => {
    h.generate.mockResolvedValue({ questions: [VALID_MCQ, INVALID_MCQ], generator: GEN });
    h.query.mockImplementation(async (sql: string) => (/INSERT INTO question_bank_candidates/.test(sql) ? { rows: [{ id: 'new-1' }] } : { rows: [] }));
    const r = await bankReplenishHandler({ id: 'j', kind: 'BANK_REPLENISH', dedupKey: 'bank:k:c0', payload, attempts: 1, maxAttempts: 3 } as any);
    expect(r).toMatchObject({ ok: true, result: { inserted: 1, generated: 2, remaining: 5 } });
    const inserts = h.query.mock.calls.filter((c) => /INSERT INTO question_bank_candidates/.test(c[0]));
    expect(inserts).toHaveLength(1);
    expect(inserts[0][1]).toEqual(expect.arrayContaining(['p', 'm', 'pid', 'v', 'op']));
    expect(JSON.parse(inserts[0][1][15]).id).toBe('good');
    expect(h.generate.mock.calls[0][0]).toMatchObject({ activityType: 'PRACTICE', count: 6 });
    expect(h.enqueue).toHaveBeenCalledWith('BANK_REPLENISH', 'bank:k:c0:r2', expect.objectContaining({ needed: 5, round: 2 }));
  });

  it('nothing valid -> the job fails (queue backoff / bounded attempts), never an unbounded retry loop', async () => {
    h.generate.mockResolvedValue({ questions: [INVALID_MCQ], generator: GEN });
    const r = await bankReplenishHandler({ id: 'j', kind: 'BANK_REPLENISH', dedupKey: 'bank:k:c0', payload, attempts: 1, maxAttempts: 3 } as any);
    expect(r.ok).toBe(false);
    expect(h.enqueue).not.toHaveBeenCalled();
  });
});

describe('D76 -- Practice never deadlocks on a shallow bank; it says so', () => {
  const ACADEMIC = { curriculum: null, programme: 'none', year: null, subjectGroup: null, level: null };
  const CONTRACT: any = { conceptId: 'c1', activityType: 'PRACTICE', language: 'es', academic: ACADEMIC, difficulty: { min: 2, max: 4, target: 3 }, itemCount: 3, independence: false, policyVersion: 'v1' };
  const MARKER: any = {
    pedagogicalPolicyVersion: 'v1', canonicalRevision: 'r', canonicalStage: 'PRACTICE', canonicalActivityType: 'PRACTICE',
    itemCount: { min: 3, max: 3, authorized: 3 }, difficulty: { min: 2, max: 4, target: 3 }, assistanceAllowed: true, independence: false, supportLevel: 'ASSISTED', minimumScorePercent: 80,
  };
  const INPUT: any = { studentId: 's1', subjectId: 'sub1', conceptId: 'c1', quizMode: 'topic_practice', activityType: 'PRACTICE', contract: CONTRACT, academic: ACADEMIC, v1Marker: MARKER, canonicalRevision: 'r' };
  const depthWrites = () => h.query.mock.calls.filter((c) => /jsonb_build_object\('bankDepth'/.test(c[0]));

  it('BANK path, 3 valid items (< 9): delivered from what exists, session records PRACTICE_BANK_DEPTH_INSUFFICIENT', async () => {
    h.assemble.mockResolvedValue({ status: 'ASSEMBLED', questions: [Q(0), Q(1), Q(2)], candidateIds: ['a', 'b', 'c'], poolSize: 3, learnFocus: null, validDepth: 3 });
    const r = await deliverCanonicalActivity(INPUT);
    expect(r).toMatchObject({ status: 'DELIVERED', source: 'BANK' });
    expect(depthWrites()).toHaveLength(1);
    expect(depthWrites()[0][1]).toEqual(['quiz-new', JSON.stringify({ reason: PRACTICE_BANK_DEPTH_INSUFFICIENT, validItems: 3, target: 9 })]);
  });

  it('INVENTORY path reports the depth measured when the set was prepared', async () => {
    h.consume.mockResolvedValue({ id: 'prep-1', questions: [Q(0), Q(1), Q(2)], candidateIds: ['a', 'b', 'c'], bankDepth: { validItems: 5, target: 9 } });
    const r = await deliverCanonicalActivity(INPUT);
    expect(r).toMatchObject({ status: 'DELIVERED', source: 'INVENTORY' });
    expect(JSON.parse(depthWrites()[0][1][1])).toEqual({ reason: PRACTICE_BANK_DEPTH_INSUFFICIENT, validItems: 5, target: 9 });
    expect(h.assemble).not.toHaveBeenCalled(); // the inventory hit still never reads the bank
  });

  it('depth >= 9 -> nothing recorded; a READY set from before D76 (no depth) -> nothing recorded', async () => {
    h.assemble.mockResolvedValue({ status: 'ASSEMBLED', questions: [Q(0), Q(1), Q(2)], candidateIds: ['a', 'b', 'c'], poolSize: 9, learnFocus: null, validDepth: 9 });
    await deliverCanonicalActivity(INPUT);
    h.consume.mockResolvedValue({ id: 'prep-1', questions: [Q(0), Q(1), Q(2)], candidateIds: ['a', 'b', 'c'] });
    await deliverCanonicalActivity(INPUT);
    expect(depthWrites()).toHaveLength(0);
  });

  it('controlled reuse: with only 3 valid items every Practice session still assembles (no SHORT, no deadlock)', () => {
    let pool = [Q(0), Q(1), Q(2)].map((q) => cand(q));
    for (let session = 1; session <= 3; session++) {
      const r = assembleFromBank(pool, PRACTICE_REQ);
      expect(r.status).toBe('ASSEMBLED');
      if (r.status !== 'ASSEMBLED') return;
      pool = pool.map((c) => (r.candidateIds.includes(c.id) ? { ...c, delivered: true, usageCount: c.usageCount + 1, lastDeliveredAt: session } : c));
    }
  });
});

describe('D76 -- with 9 valid items, 3 consecutive Practice sessions see 9 distinct items before any reuse', () => {
  it('sessions 1-3 are disjoint (9 distinct); session 4 reuses the LEAST recently delivered items first', () => {
    let pool = Array.from({ length: 9 }, (_, i) => cand(Q(i)));
    const seen: string[][] = [];
    for (let session = 1; session <= 4; session++) {
      const r = assembleFromBank(pool, PRACTICE_REQ);
      expect(r.status).toBe('ASSEMBLED');
      if (r.status !== 'ASSEMBLED') return;
      seen.push(r.candidateIds);
      pool = pool.map((c) => (r.candidateIds.includes(c.id) ? { ...c, delivered: true, usageCount: c.usageCount + 1, lastDeliveredAt: session * 1000 } : c));
    }
    expect(new Set(seen.slice(0, 3).flat()).size).toBe(9);
    expect([...seen[3]].sort()).toEqual([...seen[0]].sort());
  });

  it('least-recently-delivered wins over usage count among already-delivered items', () => {
    const pool = [
      cand(Q(0), { delivered: true, usageCount: 1, lastDeliveredAt: 3000 }),
      cand(Q(1), { delivered: true, usageCount: 2, lastDeliveredAt: 1000 }),
      cand(Q(2), { delivered: true, usageCount: 1, lastDeliveredAt: 3000 }),
      cand(Q(3), { delivered: true, usageCount: 2, lastDeliveredAt: 1000 }),
      cand(Q(4), { delivered: true, usageCount: 2, lastDeliveredAt: 1000 }),
    ];
    const r = assembleFromBank(pool, PRACTICE_REQ);
    expect(r.status === 'ASSEMBLED' && [...r.candidateIds].sort()).toEqual(['b-q1', 'b-q3', 'b-q4']);
  });
});
