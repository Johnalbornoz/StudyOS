/**
 * D75 -- PROVE EXACT-ITEM NOVELTY (approved).
 *
 * A Prove retry never re-administers an EXACT item the learner already saw in
 * a prior Prove attempt (nor, as before, an exact prior Practice item) for the
 * same concept -- on every Prove path: live generation, prepared batches
 * (re-checked at consumption), bank assembly and bank inventory consumption.
 * Exact only (normalized text, exact-duplicate-novelty.ts): a near-identical
 * item stays ALLOWED. When exact novelty cannot be met after the bounded
 * regeneration rounds, the outcome is an explicit
 * PROVE_EXACT_NOVELTY_SUPPLY_SHORTAGE -- never a silently reused item.
 *
 * Mocked DB and generators; no provider.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const h = vi.hoisted(() => ({
  chunk: vi.fn(),
  recovery: vi.fn(),
  practice: vi.fn(),
  prove: vi.fn(),
  query: vi.fn(),
  pool: vi.fn(),
}));

vi.mock('@/services/gated-question-generation.service', () => ({
  generateConcurrentChunkedBatch: (...a: any[]) => h.chunk(...a),
  generateBoundedRecoveryBatch: (...a: any[]) => h.recovery(...a),
}));
vi.mock('@/services/quiz-persistence.service', async (orig) => ({
  ...(await orig<typeof import('@/services/quiz-persistence.service')>()),
  loadPriorPracticeQuestionFingerprints: (...a: any[]) => h.practice(...a),
  loadPriorProveQuestionFingerprints: (...a: any[]) => h.prove(...a),
}));
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => h.query(...a) }, query: (...a: any[]) => h.query(...a) }));
vi.mock('@/services/question-bank.service', () => ({ loadBankPool: (...a: any[]) => h.pool(...a) }));
vi.mock('@/services/learn-weakness.service', () => ({ getLearnWeaknessesForConcept: async () => null }));

import { generateCanonicalProveQuestions, MAX_DIVERSITY_REGENERATIONS } from '@/services/canonical-prove-generation.service';
import { fingerprintQuestion, filterExactDuplicates } from '@/lib/lx/exact-duplicate-novelty';
import { loadProveExactNoveltyExclusions, PROVE_EXACT_NOVELTY_SUPPLY_SHORTAGE } from '@/services/prove-exact-novelty.service';
import { assembleFromBank, type BankCandidate } from '@/lib/activity-delivery/assembly';
import { assembleActivityForLearner } from '@/services/activity-assembly.service';
import { consumeCompatibleInventory } from '@/services/activity-inventory.service';
import { toCanonicalErrorCode } from '@/lib/pedagogical-decision/canonical-error-taxonomy';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');

// Clearly different items (distinct quantities, numbers and answers); A..J = 0..9, K..T = 10..19, ...
const Q = (i: number, over: object = {}): any => ({
  id: `q${i}`, conceptId: 'c1', type: 'numeric_problem', answerFormat: 'text', difficulty: 3,
  question: `${i + 3} zorbl${i}s cuestan ${i * 7 + 11} flur${i}s. ¿Cuánto cuestan ${i + 9}?`, correctAnswer: String(i), explanation: 'e', ...over,
});
const range = (from: number, to: number) => Array.from({ length: to - from }, (_, k) => Q(from + k));
const fps = (qs: any[]) => new Set(qs.map((q) => fingerprintQuestion(q)));
const diag = { semanticRejectedCount: 0, semanticCallCount: 0, externalAiCallCount: 1, fallbackUsed: false };
const PARAMS = {
  conceptId: 'c1', studentId: 's1', subjectId: 'sub1', targetCount: 10, difficulty: 3, guidance: 'g', language: 'es',
  visualAidRate: 0, ibContext: null, activityType: 'SOLO_CHECK', quizMode: 'canonical_prove', parentOperationId: 'op',
};
const FIRST_PROVE = range(0, 10); // A..J

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset();
  h.practice.mockResolvedValue(new Set());
  h.prove.mockResolvedValue(new Set());
  h.query.mockResolvedValue({ rows: [] });
});

describe('D75 -- live Prove generation excludes exact prior PROVE items (and still exact prior PRACTICE items)', () => {
  it('first Prove -> A..J; second Prove -> none of A..J, even when the generator re-proposes them (exact text, incidental whitespace/case)', async () => {
    // first attempt: no history
    h.chunk.mockResolvedValueOnce({ accepted: FIRST_PROVE, chunkPlan: [4, 3, 3], chunkDiagnostics: [diag, diag, diag] });
    const first = await generateCanonicalProveQuestions(PARAMS);
    expect(first.questions.map((q) => q.id).sort()).toEqual(FIRST_PROVE.map((q) => q.id).sort());

    // second attempt: A..J are now prior PROVE items
    h.prove.mockResolvedValue(fps(first.questions));
    const reproposed = FIRST_PROVE.map((q) => ({ ...q, id: `${q.id}-again`, question: `  ${q.question.toUpperCase()}  ` }));
    h.chunk.mockResolvedValueOnce({ accepted: reproposed, chunkPlan: [4, 3, 3], chunkDiagnostics: [diag, diag, diag] });
    h.recovery.mockResolvedValue({ accepted: range(10, 21), diagnostics: diag });
    const second = await generateCanonicalProveQuestions(PARAMS);

    expect(second.finalQuestionCount).toBe(10);
    const firstFps = fps(first.questions);
    expect(second.questions.filter((q) => firstFps.has(fingerprintQuestion(q)))).toEqual([]);
    expect(second.rejectedExactDuplicateCount).toBeGreaterThanOrEqual(10);
    expect(second.priorProveFingerprintCount).toBe(10);
    expect(second.exactNoveltySupplyShortage).toBe(false);
    expect(h.prove).toHaveBeenCalledWith('s1', 'c1');
  });

  it('Practice history is still excluded alongside Prove history', async () => {
    h.practice.mockResolvedValue(fps([Q(0), Q(1)]));
    h.prove.mockResolvedValue(fps([Q(2), Q(3)]));
    h.chunk.mockResolvedValue({ accepted: FIRST_PROVE, chunkPlan: [4, 3, 3], chunkDiagnostics: [diag, diag, diag] });
    h.recovery.mockResolvedValue({ accepted: range(30, 36), diagnostics: diag });
    const r = await generateCanonicalProveQuestions(PARAMS);
    expect(r.finalQuestionCount).toBe(10);
    const banned = fps([Q(0), Q(1), Q(2), Q(3)]);
    expect(r.questions.some((q) => banned.has(fingerprintQuestion(q)))).toBe(false);
    expect(r.priorPracticeFingerprintCount).toBe(4); // the union filtered against
    expect(r.priorProveFingerprintCount).toBe(2);
  });

  it('shortage: when only exact prior items keep coming back, the bounded rounds end in an explicit shortage -- never a reused item', async () => {
    h.prove.mockResolvedValue(fps(FIRST_PROVE));
    h.chunk.mockResolvedValue({ accepted: FIRST_PROVE, chunkPlan: [4, 3, 3], chunkDiagnostics: [diag, diag, diag] });
    h.recovery.mockResolvedValue({ accepted: FIRST_PROVE.slice(0, 6), diagnostics: diag });
    const r = await generateCanonicalProveQuestions(PARAMS);
    expect(r.finalQuestionCount).toBe(0);
    expect(r.questions).toEqual([]);
    expect(r.exactNoveltySupplyShortage).toBe(true);
    // one aggregate recovery + at most MAX_DIVERSITY_REGENERATIONS targeted rounds -- bounded, never a loop
    expect(h.recovery).toHaveBeenCalledTimes(1 + MAX_DIVERSITY_REGENERATIONS);
  });

  it('the rejected slots are regenerated (only the missing count), and a partial shortage still never pads with a prior item', async () => {
    h.prove.mockResolvedValue(fps(FIRST_PROVE.slice(0, 4)));
    h.chunk.mockResolvedValue({ accepted: FIRST_PROVE, chunkPlan: [4, 3, 3], chunkDiagnostics: [diag, diag, diag] });
    h.recovery.mockResolvedValue({ accepted: FIRST_PROVE.slice(0, 4), diagnostics: diag }); // keeps repeating prior items
    const r = await generateCanonicalProveQuestions(PARAMS);
    expect(r.finalQuestionCount).toBe(6);
    expect(r.exactNoveltySupplyShortage).toBe(true);
    const banned = fps(FIRST_PROVE.slice(0, 4));
    expect(r.questions.some((q) => banned.has(fingerprintQuestion(q)))).toBe(false);
    const regenCounts = h.recovery.mock.calls.slice(1).map((c) => c[3].count);
    expect(regenCounts.every((n: number) => n === 4)).toBe(true);
  });

  it('a NEAR-identical (re-worded) item is ALLOWED -- only exact text is excluded (no semantic detection)', () => {
    const prior = fps([Q(0)]);
    const reworded = { ...Q(0), id: 'rw', question: Q(0).question.replace('¿Cuánto cuestan', '¿Qué precio tienen') };
    const exactAgain = { ...Q(0), id: 'ex', question: Q(0).question.replace(/ /g, '  ') };
    const r = filterExactDuplicates([reworded, exactAgain], prior);
    expect(r.accepted.map((q) => q.id)).toEqual(['rw']);
    expect(r.rejectedCount).toBe(1);
  });
});

describe('D75 -- the exclusion set and the Prove-history loader', () => {
  it('loadProveExactNoveltyExclusions is the union of exact prior Practice and Prove fingerprints', async () => {
    h.practice.mockResolvedValue(new Set(['p1', 'shared']));
    h.prove.mockResolvedValue(new Set(['v1', 'shared']));
    const x = await loadProveExactNoveltyExclusions('s1', 'c1');
    expect([...x.fingerprints].sort()).toEqual(['p1', 'shared', 'v1']);
    expect(x).toMatchObject({ priorPracticeCount: 2, priorProveCount: 2 });
  });

  it('loadPriorProveQuestionFingerprints reads only v1 canonical_prove sessions of this learner + concept', async () => {
    const actual = await vi.importActual<typeof import('@/services/quiz-persistence.service')>('@/services/quiz-persistence.service');
    h.query.mockResolvedValueOnce({ rows: [{ questions: [Q(0), { ...Q(1), conceptId: undefined }, { ...Q(2), conceptId: 'other' }] }] });
    const set = await actual.loadPriorProveQuestionFingerprints('s1', 'c1');
    expect(set).toEqual(fps([Q(0), Q(1)]));
    const [sql, params] = h.query.mock.calls[0];
    expect(sql).toMatch(/quiz_mode = 'canonical_prove'/);
    expect(sql).toMatch(/pedagogical_policy_version IS NOT NULL/);
    expect(sql).toMatch(/\$2::uuid = ANY\(concept_ids\)/);
    expect(params).toEqual(['s1', 'c1']);
  });
});

describe('D75 -- bank paths for PROVE', () => {
  const cand = (q: any, over: Partial<BankCandidate> = {}): BankCandidate => ({
    id: `b-${q.id}`, question: q, difficulty: 3, contentFingerprint: fingerprintQuestion(q), transferDepth: null, usageCount: 0, delivered: false, ...over,
  });
  const REQ = { activityType: 'PROVE' as const, itemCount: 10, difficulty: { min: 2, max: 4, target: 3 }, language: 'es', reservedCandidateIds: new Set<string>() };

  it('assembly never fills a Prove with an exact prior item: not enough novel candidates -> SHORT (explicit), not reuse', () => {
    const pool = range(0, 12).map((q) => cand(q));
    expect(assembleFromBank(pool, { ...REQ, excludeFingerprints: fps(FIRST_PROVE) })).toEqual({ status: 'SHORT', available: 2, needed: 10 });
    const ok = assembleFromBank(range(0, 20).map((q) => cand(q)), { ...REQ, excludeFingerprints: fps(FIRST_PROVE) });
    expect(ok.status).toBe('ASSEMBLED');
    if (ok.status === 'ASSEMBLED') expect(ok.questions.some((q) => fps(FIRST_PROVE).has(fingerprintQuestion(q)))).toBe(false);
  });

  it('a PROVE bank assembly filters against the Practice + Prove union (a banked copy of a prior Prove item is excluded even if never "delivered" from the bank)', async () => {
    h.prove.mockResolvedValue(fps(FIRST_PROVE));
    h.pool.mockResolvedValue(range(0, 20).map((q) => cand(q)));
    const contract: any = { conceptId: 'c1', activityType: 'PROVE', language: 'es', academic: {}, difficulty: { min: 2, max: 4, target: 3 }, itemCount: 10, independence: true, policyVersion: 'v1' };
    const r = await assembleActivityForLearner({ studentId: 's1', contract, academic: contract.academic, reservedCandidateIds: new Set() });
    expect(r.status).toBe('ASSEMBLED');
    if (r.status === 'ASSEMBLED') expect(r.questions.some((q) => fps(FIRST_PROVE).has(fingerprintQuestion(q)))).toBe(false);
    expect(h.practice).toHaveBeenCalledWith('s1', 'c1');
    expect(h.prove).toHaveBeenCalledWith('s1', 'c1');
  });

  it('a READY Prove set prepared before a later attempt is re-checked at consumption: an exact prior item invalidates it (NOVELTY_STALE)', async () => {
    h.query.mockResolvedValueOnce({ rows: [{ retired: null, id: 'prep-1', questions: FIRST_PROVE, candidate_ids: [] }] });
    const consumed = await consumeCompatibleInventory(
      { studentId: 's1', conceptId: 'c1', stage: 'PROVE', policyVersion: 'v1' },
      { contractFingerprint: 'c', learnerStateFingerprint: 'l', independent: true, excludeFingerprints: fps([Q(7)]) },
    );
    expect(consumed).toBeNull();
    const [sql, params] = h.query.mock.calls[1];
    expect(sql).toMatch(/SET status = 'INVALIDATED', failure_reason = 'NOVELTY_STALE'/);
    expect(params).toEqual(['prep-1']);
  });

  it('...and is served when it holds no exact prior item', async () => {
    h.query.mockResolvedValueOnce({ rows: [{ retired: null, id: 'prep-1', questions: FIRST_PROVE, candidate_ids: ['x'] }] });
    const consumed = await consumeCompatibleInventory(
      { studentId: 's1', conceptId: 'c1', stage: 'PROVE', policyVersion: 'v1' },
      { contractFingerprint: 'c', learnerStateFingerprint: 'l', independent: true, excludeFingerprints: fps([Q(40)]) },
    );
    expect(consumed?.id).toBe('prep-1');
    expect(h.query).toHaveBeenCalledTimes(1);
  });

  it('the launch hot path loads the exclusions for PROVE only and passes them to consumption', () => {
    const svc = read('src/services/activity-delivery.service.ts');
    expect(svc).toMatch(/input\.activityType === 'PROVE' \? loadProveExactNoveltyExclusions\(input\.studentId, input\.conceptId\) : Promise\.resolve\(null\)/);
    expect(svc).toMatch(/\.\.\.\(proveExclusions \? \{ excludeFingerprints: proveExclusions\.fingerprints \} : \{\}\)/);
  });
});

describe('D75 -- explicit shortage outcome', () => {
  it('PROVE_EXACT_NOVELTY_SUPPLY_SHORTAGE is a mapped canonical code (AI_GENERATION_INVALID: candidates came back, novelty filtering left too few)', () => {
    expect(PROVE_EXACT_NOVELTY_SUPPLY_SHORTAGE).toBe('PROVE_EXACT_NOVELTY_SUPPLY_SHORTAGE');
    expect(toCanonicalErrorCode(PROVE_EXACT_NOVELTY_SUPPLY_SHORTAGE)).toEqual({ code: 'AI_GENERATION_INVALID', mapped: true });
  });

  it('the route reports the shortage reason from the generation result (fail closed, no session), else the existing V1_PROVE_GENERATION_INCOMPLETE', () => {
    const route = read('src/app/api/quizzes/generate-and-take/route.ts');
    expect(route).toMatch(/if \(proveShortageCheck\.exactNoveltySupplyShortage\) proveReasonCode = PROVE_EXACT_NOVELTY_SUPPLY_SHORTAGE;/);
    expect((route.match(/reason: proveReasonCode,/g) ?? []).length).toBe(2);
  });

  it('a prepared batch that falls short for exact novelty is FAILED with the same reason', () => {
    const svc = read('src/services/canonical-prepared-activity.service.ts');
    // D79 adds the level-mix reason after the exact-novelty one (exact novelty still wins)
    expect(svc).toMatch(/const reason = result\.exactNoveltySupplyShortage\s*\? PROVE_EXACT_NOVELTY_SUPPLY_SHORTAGE\s*: result\.levelMixSupplyShortage\s*\? PROVE_LEVEL_MIX_SUPPLY_SHORTAGE\s*: 'GENERATION_INCOMPLETE';/);
  });
});
