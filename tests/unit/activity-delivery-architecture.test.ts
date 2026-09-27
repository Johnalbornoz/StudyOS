/**
 * LEARNING_ACTIVITY_DELIVERY -- AI generation is separated from activity
 * launch. The hot path (authorize -> decide -> resume / consume READY /
 * assemble from the VALIDATED bank -> session) makes 0 AI calls; emergency
 * generation is explicit; background work is a deduplicated, bounded queue.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');

const h = vi.hoisted(() => ({
  clientQuery: vi.fn(),
  release: vi.fn(),
  poolQuery: vi.fn(),
  resume: vi.fn(),
  snapshot: vi.fn(),
  askFlags: vi.fn(),
  reserved: vi.fn(),
  consume: vi.fn(),
  link: vi.fn(),
  assemble: vi.fn(),
  storeQuiz: vi.fn(),
  deliveries: vi.fn(),
  addCandidates: vi.fn(),
  schedule: vi.fn(),
  executeAI: vi.fn(),
  callModel: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: { connect: async () => ({ query: (...a: any[]) => h.clientQuery(...a), release: h.release }), query: (...a: any[]) => h.poolQuery(...a) },
  query: (...a: any[]) => h.poolQuery(...a),
}));
vi.mock('@/services/quiz-persistence.service', async (orig) => ({
  ...(await orig<typeof import('@/services/quiz-persistence.service')>()),
  findResumableCanonicalSession: (...a: any[]) => h.resume(...a),
  storeQuiz: (...a: any[]) => h.storeQuiz(...a),
}));
vi.mock('@/services/activity-delivery-context.service', () => ({ loadLearnerStateSnapshot: (...a: any[]) => h.snapshot(...a), loadAcademicContext: vi.fn() }));
vi.mock('@/services/ask-confidence.service', () => ({ computeAskConfidenceFlags: (...a: any[]) => h.askFlags(...a) }));
vi.mock('@/services/activity-inventory.service', () => ({
  consumeCompatibleInventory: (...a: any[]) => h.consume(...a),
  linkConsumedActivity: (...a: any[]) => h.link(...a),
  reservedCandidateIds: (...a: any[]) => h.reserved(...a),
}));
vi.mock('@/services/activity-assembly.service', () => ({ assembleActivityForLearner: (...a: any[]) => h.assemble(...a) }));
vi.mock('@/services/question-bank.service', () => ({ recordBankDeliveries: (...a: any[]) => h.deliveries(...a), addValidatedCandidates: (...a: any[]) => h.addCandidates(...a) }));
vi.mock('@/services/activity-delivery-worker.service', () => ({ scheduleDeliveryReplenishment: (...a: any[]) => h.schedule(...a) }));
vi.mock('@/lib/ai', async (orig) => ({ ...(await orig<typeof import('@/lib/ai')>()), executeAI: (...a: any[]) => h.executeAI(...a) }));
vi.mock('@/lib/ai/adapters/call-model', async (orig) => ({ ...(await orig<typeof import('@/lib/ai/adapters/call-model')>()), callModel: (...a: any[]) => h.callModel(...a) }));

import {
  activityContractFingerprint, learnerStateFingerprint, preparedActivityCompatibility, inventoryTarget, bankTarget,
  NO_ACADEMIC_CONTEXT, type ActivityContract,
} from '@/lib/activity-delivery/contract';
import { assembleFromBank, type BankCandidate } from '@/lib/activity-delivery/assembly';
import { deliverCanonicalActivity, launchLockId, completeEmergencyDelivery } from '@/services/activity-delivery.service';
import { runWithAiMetrics, currentAiCallCount } from '@/lib/ai/request-metrics';

const CONTRACT: ActivityContract = {
  conceptId: 'c1', activityType: 'PROVE', language: 'es', academic: { curriculum: 'ib', programme: 'DP', year: 'DP2', subjectGroup: 'math', level: 'HL' },
  difficulty: { min: 3, max: 4, target: 3 }, itemCount: 10, independence: true, policyVersion: 'studyus-canonical-v1',
};
const MARKER: any = {
  pedagogicalPolicyVersion: 'studyus-canonical-v1', canonicalRevision: 'r', canonicalStage: 'PROVE', canonicalActivityType: 'PROVE',
  itemCount: { min: 10, max: 10, authorized: 10 }, difficulty: { min: 3, max: 4, target: 3 }, assistanceAllowed: false, independence: true, supportLevel: 'NONE', minimumScorePercent: 80,
};
const INPUT: any = { studentId: 's1', subjectId: 'sub1', conceptId: 'c1', quizMode: 'canonical_prove', activityType: 'PROVE', contract: CONTRACT, academic: CONTRACT.academic, v1Marker: MARKER, canonicalRevision: 'r' };
const Q = (i: number, over: object = {}): any => ({ id: `q${i}`, conceptId: 'c1', type: 'numeric_problem', answerFormat: 'text', difficulty: 3, question: `${i + 3} zorbl${i}s cuestan ${i * 7 + 11} flur${i}s. ¿Cuánto cuestan ${i + 9}?`, correctAnswer: String(i), explanation: 'e', ...over });

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset();
  h.clientQuery.mockResolvedValue({ rows: [] });
  h.poolQuery.mockResolvedValue({ rows: [] });
  h.resume.mockResolvedValue(null);
  h.snapshot.mockResolvedValue({ evidenceCount: 5, lastEvidenceId: 'e5', criticalMisconceptions: 0, hintsUsed: 1 });
  h.askFlags.mockResolvedValue(new Map([['c1', false]]));
  h.reserved.mockResolvedValue(new Set());
  h.consume.mockResolvedValue(null);
  h.storeQuiz.mockResolvedValue('quiz-new');
  h.deliveries.mockResolvedValue(undefined);
  h.schedule.mockResolvedValue(undefined);
});

describe('1. activity contract', () => {
  it('fingerprint is stable and changes with every compatibility-relevant field', () => {
    const fp = activityContractFingerprint(CONTRACT);
    expect(activityContractFingerprint({ ...CONTRACT })).toBe(fp);
    for (const changed of [
      { language: 'en' }, { difficulty: { min: 3, max: 4, target: 4 } }, { itemCount: 9 }, { independence: false }, { activityType: 'RETAIN' as const },
      { academic: { ...CONTRACT.academic, level: 'SL' } }, { academic: { ...CONTRACT.academic, year: 'DP1' } }, { academic: NO_ACADEMIC_CONTEXT }, { policyVersion: 'v2' },
    ]) expect(activityContractFingerprint({ ...CONTRACT, ...changed } as ActivityContract), JSON.stringify(changed)).not.toBe(fp);
  });

  it('learner-state fingerprint tracks evidence, misconceptions and help', () => {
    const s = { evidenceCount: 5, lastEvidenceId: 'e5', criticalMisconceptions: 0, hintsUsed: 1 };
    const fp = learnerStateFingerprint(s);
    for (const c of [{ evidenceCount: 6 }, { lastEvidenceId: 'e6' }, { criticalMisconceptions: 1 }, { hintsUsed: 2 }]) expect(learnerStateFingerprint({ ...s, ...c })).not.toBe(fp);
  });

  it('a prepared activity is deliverable only while contract AND learner state match (TTL is only a backstop)', () => {
    const now = new Date('2026-09-27T12:00:00Z');
    const base = { contractFingerprint: 'c', learnerStateFingerprint: 'l', expiresAt: new Date('2026-09-28T00:00:00Z') };
    const cur = { contractFingerprint: 'c', learnerStateFingerprint: 'l', now };
    expect(preparedActivityCompatibility(base, cur)).toEqual({ compatible: true });
    expect(preparedActivityCompatibility({ ...base, contractFingerprint: 'x' }, cur)).toEqual({ compatible: false, reason: 'CONTRACT_CHANGED' });
    expect(preparedActivityCompatibility({ ...base, learnerStateFingerprint: 'x' }, cur)).toEqual({ compatible: false, reason: 'LEARNER_STATE_CHANGED' });
    expect(preparedActivityCompatibility({ ...base, expiresAt: new Date('2026-09-27T11:00:00Z') }, cur)).toEqual({ compatible: false, reason: 'EXPIRED' });
    expect(preparedActivityCompatibility({ ...base, contractFingerprint: null }, cur)).toEqual({ compatible: false, reason: 'LEGACY_PREPARATION' });
  });

  it('replenishment policy: PRACTICE keeps 2 READY, every other next action 1; a Prove READY is a full set', () => {
    expect(inventoryTarget('PRACTICE')).toBe(2);
    for (const t of ['LEARN_CHECK', 'PROVE', 'RETAIN', 'TRANSFER'] as const) expect(inventoryTarget(t)).toBe(1);
    expect(bankTarget('PROVE', 10)).toBe(20);
    expect(bankTarget('TRANSFER', 3)).toBe(6);
  });

  it('the consumption SQL mirrors preparedActivityCompatibility exactly', () => {
    const inv = read('src/services/activity-inventory.service.ts');
    for (const reason of ['LEGACY_PREPARATION', 'EXPIRED', 'CONTRACT_CHANGED', 'LEARNER_STATE_CHANGED']) expect(inv).toContain(`'${reason}'`);
    expect(inv).toMatch(/FOR UPDATE SKIP LOCKED/);
  });
});

describe('2. assembly from the VALIDATED bank (pure, no AI)', () => {
  const cand = (i: number, over: Partial<BankCandidate> = {}): BankCandidate => ({ id: `b${i}`, question: Q(i), difficulty: 3, contentFingerprint: `f${i}`, transferDepth: null, usageCount: 0, delivered: false, ...over });
  const req = { activityType: 'PROVE' as const, itemCount: 3, difficulty: { min: 3, max: 4, target: 3 }, language: 'es', excludeFingerprints: new Set<string>(), reservedCandidateIds: new Set<string>() };

  it('assembles exactly itemCount, within the difficulty band', () => {
    const r = assembleFromBank([cand(1, { difficulty: 2 }), cand(2), cand(3), cand(4), cand(5, { difficulty: 5 })], req);
    expect(r).toMatchObject({ status: 'ASSEMBLED', candidateIds: ['b2', 'b3', 'b4'] });
  });

  it('independent checks never re-deliver; exclusions and reservations are respected', () => {
    const r = assembleFromBank([cand(1, { delivered: true }), cand(2), cand(3, { contentFingerprint: 'seen' }), cand(4), cand(5), cand(6)], { ...req, excludeFingerprints: new Set(['seen']), reservedCandidateIds: new Set(['b4']) });
    expect(r).toMatchObject({ status: 'ASSEMBLED', candidateIds: ['b2', 'b5', 'b6'] });
  });

  it('assisted practice may reuse, but prefers unseen and least-used items', () => {
    const r = assembleFromBank([cand(1, { delivered: true }), cand(2, { usageCount: 3 }), cand(3), cand(4)], { ...req, activityType: 'PRACTICE', itemCount: 3 });
    expect(r).toMatchObject({ status: 'ASSEMBLED', candidateIds: ['b3', 'b4', 'b2'] });
  });

  it('semantic diversity comes from the SAME selector (near duplicates are never assembled together)', () => {
    const dup = cand(9, { id: 'dup', question: { ...Q(2), id: 'dup', question: `${Q(2).question} ` }, contentFingerprint: 'f-dup' });
    const r = assembleFromBank([cand(2), dup, cand(3), cand(4)], req);
    expect(r).toMatchObject({ status: 'ASSEMBLED', candidateIds: ['b2', 'b3', 'b4'] });
    expect(read('src/lib/activity-delivery/assembly.ts')).toMatch(/import \{ selectDiverse \} from '@\/lib\/lx\/question-diversity';/);
  });

  it('TRANSFER takes exactly one NEAR, one CONTEXTUAL and one HIGHER', () => {
    const t = (i: number, depth: any) => cand(i, { transferDepth: depth, difficulty: 4 });
    const r = assembleFromBank([t(1, 'NEAR'), t(2, 'NEAR'), t(3, 'HIGHER'), t(4, 'CONTEXTUAL')], { ...req, activityType: 'TRANSFER', itemCount: 3, difficulty: { min: 4, max: 5, target: 4 } });
    expect(r.status).toBe('ASSEMBLED');
    expect((r as any).questions.map((q: any) => q.transferDepth)).toEqual(['NEAR', 'CONTEXTUAL', 'HIGHER']);
  });

  it('never returns an incomplete set: not enough -> SHORT', () => {
    expect(assembleFromBank([cand(1), cand(2)], req)).toEqual({ status: 'SHORT', available: 2, needed: 3 });
  });
});

describe('3. the hot path (0 AI calls)', () => {
  const run = <T,>(fn: () => Promise<T>) => runWithAiMetrics('test launch', async () => ({ result: await fn(), ai: currentAiCallCount() }));

  it('the launch lock is transaction-scoped, taken in ONE round trip, and released by COMMIT (safe behind PgBouncer)', async () => {
    h.resume.mockResolvedValue({ quizId: 'quiz-open', questions: [Q(1)] });
    await deliverCanonicalActivity(INPUT);
    const sql = h.clientQuery.mock.calls.map((c) => String(c[0]));
    expect(sql[0]).toBe(`BEGIN; SET LOCAL lock_timeout = '90s'; SELECT pg_advisory_xact_lock(${launchLockId('activity-launch:s1:c1:canonical_prove')});`);
    expect(sql).toContain('COMMIT');
    expect(sql.join(' ')).not.toMatch(/pg_advisory_lock\(|pg_advisory_unlock/);
    expect(h.release).toHaveBeenCalledTimes(1);
    expect(launchLockId('x')).toMatch(/^-?\d+$/);
  });

  it('RESUMED: an equivalent open session is returned, nothing is created', async () => {
    h.resume.mockResolvedValue({ quizId: 'quiz-open', questions: [Q(1)] });
    const { result, ai } = await run(() => deliverCanonicalActivity(INPUT));
    expect(result).toMatchObject({ status: 'DELIVERED', source: 'RESUMED', quizId: 'quiz-open' });
    expect(h.storeQuiz).not.toHaveBeenCalled();
    expect(h.consume).not.toHaveBeenCalled();
    expect(ai).toEqual({ executions: 0, providerCalls: 0 });
  });

  it('INVENTORY: a compatible READY activity is consumed and becomes the session; replenishment is scheduled', async () => {
    const questions = Array.from({ length: 10 }, (_, i) => Q(i));
    h.consume.mockResolvedValue({ id: 'prep-1', questions, candidateIds: ['b1'] });
    const { result, ai } = await run(() => deliverCanonicalActivity(INPUT));
    expect(result).toMatchObject({ status: 'DELIVERED', source: 'INVENTORY', quizId: 'quiz-new' });
    const [student, concept, subject, stored, lang, mode, conceptIds, marker] = h.storeQuiz.mock.calls[0];
    expect([student, concept, subject, lang, mode, conceptIds]).toEqual(['s1', 'c1', 'sub1', 'es', 'canonical_prove', ['c1']]);
    expect(stored).toHaveLength(10);
    expect(marker.novelty.noveltyPolicy).toBe('EXACT_DUPLICATE_EXCLUSION_V1');
    expect(h.poolQuery).toHaveBeenCalledWith(`UPDATE quiz_sessions SET delivery_source = $2 WHERE id = $1`, ['quiz-new', 'INVENTORY']);
    expect(h.link).toHaveBeenCalledWith('prep-1', 'quiz-new');
    expect(h.deliveries).toHaveBeenCalledWith(['b1'], 'quiz-new', 's1');
    expect(h.consume.mock.calls[0][1].contractFingerprint).toBe(activityContractFingerprint(CONTRACT));
    expect(ai).toEqual({ executions: 0, providerCalls: 0 });
  });

  it('BANK: cold miss assembles from the bank', async () => {
    h.assemble.mockResolvedValue({ status: 'ASSEMBLED', questions: Array.from({ length: 10 }, (_, i) => Q(i)), candidateIds: ['b1', 'b2'], poolSize: 30 });
    const { result, ai } = await run(() => deliverCanonicalActivity(INPUT));
    expect(result).toMatchObject({ status: 'DELIVERED', source: 'BANK' });
    expect(h.poolQuery).toHaveBeenCalledWith(`UPDATE quiz_sessions SET delivery_source = $2 WHERE id = $1`, ['quiz-new', 'BANK']);
    expect(ai).toEqual({ executions: 0, providerCalls: 0 });
    expect(h.executeAI).not.toHaveBeenCalled();
    expect(h.callModel).not.toHaveBeenCalled();
  });

  it('bank short -> EMERGENCY_REQUIRED, explicit, with the lock still held until the caller completes it', async () => {
    h.assemble.mockResolvedValue({ status: 'SHORT', available: 4, needed: 10, poolSize: 4 });
    const r = await deliverCanonicalActivity(INPUT);
    expect(r).toMatchObject({ status: 'EMERGENCY_REQUIRED', bank: { available: 4, needed: 10 } });
    expect(h.clientQuery.mock.calls.map((c) => c[0])).not.toContain('COMMIT');
    expect(h.storeQuiz).not.toHaveBeenCalled();
    await (r as any).lock.release();
    expect(h.clientQuery.mock.calls.map((c) => c[0])).toContain('COMMIT');
  });

  it('a failure anywhere still releases the lock', async () => {
    h.consume.mockRejectedValue(new Error('db'));
    await expect(deliverCanonicalActivity(INPUT)).rejects.toThrow('db');
    expect(h.clientQuery.mock.calls.map((c) => c[0])).toContain('COMMIT');
    expect(h.release).toHaveBeenCalled();
  });

  it('after an emergency generation the result is banked, marked EMERGENCY_AI and recorded as delivered', async () => {
    h.addCandidates.mockResolvedValue({ inserted: 2, ids: ['n1', 'n2'] });
    await completeEmergencyDelivery({ input: INPUT, quizId: 'quiz-e', questions: [Q(1), Q(2)], generator: { provider: 'openai', model: 'm', promptId: 'p', promptVersion: 'v3', operationId: 'op' } });
    expect(h.addCandidates.mock.calls[0][1]).toMatchObject({ studentId: 's1', conceptId: 'c1', activityType: 'PROVE', language: 'es' });
    expect(h.poolQuery).toHaveBeenCalledWith(`UPDATE quiz_sessions SET delivery_source = 'EMERGENCY_AI' WHERE id = $1`, ['quiz-e']);
    expect(h.deliveries).toHaveBeenCalledWith(['n1', 'n2'], 'quiz-e', 's1');
  });

  it('the hot-path module never calls a generator or the AI gateway (replenishment only via after()/queue)', () => {
    const src = read('src/services/activity-delivery.service.ts');
    expect(src).not.toMatch(/generateActivityCandidates|generateCanonicalProveQuestions|generatePracticeQuestions|executeAI|callModel|gradeAnswer/);
    expect(src).toMatch(/after\(\(\) => scheduleDeliveryReplenishment\(target, \{ language \}\)/);
    expect(src).toMatch(/const hotPathAiViolation = fields\.source !== 'EMERGENCY_AI' && aiCalls > 0;/);
    expect(src).toMatch(/console\.error\('\[activity-launch\] HOT_PATH_AI_VIOLATION'/);
    expect(src).toMatch(/console\.warn\('\[activity-launch\] EMERGENCY_GENERATION'/);
  });
});

describe('4. route wiring', () => {
  const ROUTE = read('src/app/api/quizzes/generate-and-take/route.ts');
  it('canonical activities are delivered after authorization and BEFORE any generation; delivered launches return immediately', () => {
    const deliverIdx = ROUTE.indexOf('const delivery = await deliverCanonicalActivity(deliveryInput);');
    expect(deliverIdx).toBeGreaterThan(ROUTE.indexOf("if (validated.quizMode === 'canonical_prove' && !v1Marker)"));
    expect(deliverIdx).toBeLessThan(ROUTE.indexOf('const [questionArrays, askConfidenceFlags] = await Promise.all(['));
    const block = ROUTE.slice(deliverIdx, ROUTE.indexOf('emergencyLaunch = { lock: delivery.lock'));
    expect(block).toMatch(/if \(delivery\.status === 'DELIVERED'\) \{[\s\S]*logActivityLaunch\([\s\S]*return NextResponse\.json\(/);
  });

  it('emergency generation is explicit, keeps the lock until its session exists, banks the result, and always releases the lock', () => {
    expect(ROUTE).toMatch(/console\.warn\('\[activity-launch\] EMERGENCY_GENERATION_STARTED'/);
    const storeIdx = ROUTE.indexOf('const quizId = await storeQuiz(');
    const completeIdx = ROUTE.indexOf('await completeEmergencyDelivery({ input: emergencyLaunch.input, quizId, questions');
    expect(completeIdx).toBeGreaterThan(storeIdx);
    expect(ROUTE).toMatch(/\} finally \{\s*if \(emergencyLaunch\) await emergencyLaunch\.lock\.release\(\)\.catch\(\(\) => \{\}\);/);
  });

  it('launching writes no learning evidence (evidence/grading only at submit)', () => {
    const svc = read('src/services/activity-delivery.service.ts') + read('src/services/activity-inventory.service.ts') + read('src/services/activity-assembly.service.ts');
    expect(svc).not.toMatch(/learning_evidence\s*\(|INSERT INTO learning_evidence|updateMastery|recordError|quiz_responses/);
  });
});

describe('5. replenishment triggers', () => {
  it('activity finished, Concept Mission, Today and consumption all use the ONE trigger, after the response', () => {
    expect(read('src/app/api/quizzes/generate-and-take/route.ts')).toMatch(/after\(\(\) => scheduleDeliveryReplenishment\(target, \{ language: replenishLanguage \}\)/);
    expect(read('src/app/dashboard/subjects/[id]/concepts/[conceptId]/page.tsx')).toMatch(/after\(\(\) => scheduleDeliveryReplenishment\(\{ studentId, subjectId, conceptId \}\)/);
    expect(read('src/app/dashboard/today/page.tsx')).toMatch(/after\(\(\) => scheduleDeliveryReplenishment\(replenishTarget\)/);
    expect(read('src/services/activity-delivery.service.ts')).toMatch(/scheduleReplenishment\(input\);\s*return \{ status: 'DELIVERED', source: 'INVENTORY'/);
  });

  it('the old PROVE-only AI pre-generation trigger is gone', () => {
    expect(() => read('src/services/prove-preparation-trigger.service.ts')).toThrow();
  });
});

describe('6. schema (migration 20261016_1000_activity_delivery)', () => {
  const M = read('database/migrations/20261016_1000_activity_delivery.sql');
  it('bank, deliveries, queue and inventory generalization are additive', () => {
    for (const t of ['question_bank_candidates', 'question_bank_deliveries', 'generation_jobs']) expect(M).toMatch(new RegExp(`CREATE TABLE public\\.${t}`));
    expect(M).toMatch(/CHECK \(stage IN \('LEARN', 'PRACTICE', 'PROVE', 'RETAIN', 'TRANSFER'\)\)/);
    expect(M).toMatch(/'EXPIRED'/);
    expect(M).not.toMatch(/^\s*(UPDATE|DELETE FROM|TRUNCATE|DROP TABLE)\b/m);
  });
  it('bank candidates are concept-scoped, content-unique, and only VALIDATED ones are ever loaded', () => {
    expect(M).toMatch(/CONSTRAINT question_bank_candidates_content_key UNIQUE \(concept_id, activity_type, language, content_fingerprint\)/);
    expect(read('src/services/question-bank.service.ts')).toMatch(/c\.validation_status = 'VALIDATED'/);
    expect(read('src/services/question-bank.service.ts')).toMatch(/WHERE c\.concept_id = \$2 AND c\.student_id = \$1/);
  });
  it('queue: one open job per key; inventory: at most one open row per slot', () => {
    expect(M).toMatch(/CREATE UNIQUE INDEX generation_jobs_one_open_per_key ON public\.generation_jobs \(dedup_key\) WHERE status IN \('PENDING', 'RUNNING'\);/);
    expect(M).toMatch(/\(student_id, concept_id, stage, pedagogical_policy_version, slot\)\s*WHERE status IN \('PREPARING', 'READY'\)/);
  });
});

describe('7. bank pool selection (regression: an exhausted-oldest bank must not look empty)', () => {
  const BANK = read('src/services/question-bank.service.ts');
  it('the bounded pool loads never-delivered, least-used, newest candidates first', () => {
    expect(BANK).toMatch(/ORDER BY pool\.delivered, pool\.usage_count, pool\.created_at DESC\s*\n\s*LIMIT \$7/);
    expect(BANK).not.toMatch(/ORDER BY c\.created_at\s*\n\s*LIMIT/);
  });
  it('independent checks do not load delivered candidates at all', () => {
    expect(BANK).toMatch(/WHERE NOT \(\$6::boolean AND pool\.delivered\)/);
    expect(read('src/services/activity-assembly.service.ts')).toMatch(/excludeDelivered: isIndependentActivity\(contract\.activityType\)/);
  });
  it('independence is ONE definition shared by assembly and pool loading', async () => {
    const { isIndependentActivity } = await import('@/lib/activity-delivery/assembly');
    expect(['LEARN_CHECK', 'PRACTICE', 'PROVE', 'RETAIN', 'TRANSFER'].filter((t) => isIndependentActivity(t as never))).toEqual(['PROVE', 'RETAIN', 'TRANSFER']);
  });
});

describe('8. background worker throughput', () => {
  it('bank replenishment is split into generator-sized chunks that run in parallel', async () => {
    const { bankChunks } = await import('@/lib/activity-delivery/contract');
    expect(bankChunks(20, 10)).toEqual([10, 10]);
    expect(bankChunks(25, 10)).toEqual([10, 10, 5]);
    expect(bankChunks(3, 3)).toEqual([3]);
    expect(bankChunks(0, 10)).toEqual([]);
    expect(bankChunks(-4, 10)).toEqual([]);
    const W = read('src/services/activity-delivery-worker.service.ts');
    // generation already in flight is subtracted, so repeated triggers never over-generate
    expect(W).toMatch(/const missing = want - undelivered - inFlight;/);
    expect(W).toMatch(/enqueueGenerationJob\('BANK_REPLENISH', `\$\{key\}:c\$\{i\}`/);
    expect(read('src/services/generation-queue.service.ts')).toMatch(/kind = 'BANK_REPLENISH' AND status IN \('PENDING', 'RUNNING'\) AND left\(dedup_key, length\(\$1\)\) = \$1/);
  });

  it('a slow job never holds back quick jobs queued behind it (continuous slots, no batch barrier)', async () => {
    const { runGenerationWorker } = await import('@/services/generation-queue.service');
    const queue = [
      { id: 'slow', kind: 'BANK_REPLENISH', dedup_key: 'b', payload: {}, attempts: 1, max_attempts: 3 },
      { id: 'q1', kind: 'PREPARE_INVENTORY', dedup_key: 'p1', payload: {}, attempts: 1, max_attempts: 3 },
      { id: 'q2', kind: 'PREPARE_INVENTORY', dedup_key: 'p2', payload: {}, attempts: 1, max_attempts: 3 },
      { id: 'q3', kind: 'PREPARE_INVENTORY', dedup_key: 'p3', payload: {}, attempts: 1, max_attempts: 3 },
    ];
    h.poolQuery.mockImplementation(async (sql: string) => {
      if (String(sql).includes('UPDATE generation_jobs j')) { const j = queue.shift(); return { rows: j ? [j] : [] }; }
      return { rows: [] };
    });
    const done: string[] = [];
    let releaseSlow!: () => void;
    const slowGate = new Promise<void>((r) => { releaseSlow = r; });
    const stats = runGenerationWorker({
      BANK_REPLENISH: async (job) => { await slowGate; done.push(job.id); return { ok: true, result: {} }; },
      PREPARE_INVENTORY: async (job) => { done.push(job.id); if (done.length === 3) releaseSlow(); return { ok: true, result: {} }; },
    }, { concurrency: 2 });
    expect(await stats).toEqual({ processed: 4, succeeded: 4, retried: 0, failed: 0 });
    expect(done).toEqual(['q1', 'q2', 'q3', 'slow']);
  });

  it('follow-up jobs queued by a running job are still drained before the worker stops', async () => {
    const { runGenerationWorker } = await import('@/services/generation-queue.service');
    const queue: any[] = [{ id: 'bank', kind: 'BANK_REPLENISH', dedup_key: 'b', payload: {}, attempts: 1, max_attempts: 3 }];
    h.poolQuery.mockImplementation(async (sql: string) => {
      if (String(sql).includes('UPDATE generation_jobs j')) { const j = queue.shift(); return { rows: j ? [j] : [] }; }
      return { rows: [] };
    });
    const done: string[] = [];
    const s = await runGenerationWorker({
      BANK_REPLENISH: async (job) => { await new Promise((r) => setTimeout(r, 30)); queue.push({ id: 'prep', kind: 'PREPARE_INVENTORY', dedup_key: 'p', payload: {}, attempts: 1, max_attempts: 3 }); done.push(job.id); return { ok: true, result: {} }; },
      PREPARE_INVENTORY: async (job) => { done.push(job.id); return { ok: true, result: {} }; },
    }, { concurrency: 3 });
    expect(done).toEqual(['bank', 'prep']);
    expect(s.processed).toBe(2);
  });

  it('maxJobs bounds the jobs a run starts', async () => {
    const { runGenerationWorker } = await import('@/services/generation-queue.service');
    let n = 0;
    h.poolQuery.mockImplementation(async (sql: string) =>
      String(sql).includes('UPDATE generation_jobs j') ? { rows: [{ id: `j${n++}`, kind: 'PREPARE_INVENTORY', dedup_key: `k${n}`, payload: {}, attempts: 1, max_attempts: 3 }] } : { rows: [] });
    const s = await runGenerationWorker({ BANK_REPLENISH: async () => ({ ok: true, result: {} }), PREPARE_INVENTORY: async () => ({ ok: true, result: {} }) }, { concurrency: 3, maxJobs: 5 });
    expect(s.processed).toBe(5);
  });
});
