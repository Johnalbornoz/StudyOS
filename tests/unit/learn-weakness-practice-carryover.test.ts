/**
 * Requirement §22 -- LEARN weaknesses reach PRACTICE on EVERY supply path, with auditable provenance.
 *
 *   shared accessor        services/learn-weakness.service getLearnWeaknessesForConcept
 *   BANK_PRIORITY          validated bank assembly prioritises matching items (launch AND READY preparation)
 *   CACHE_PRIORITY         a consumed READY set records its re-measured match
 *   pre-generated supply   PRACTICE bank replenishment generates with the weaknesses as guidance
 *   untouched              PROVE / RETAIN / TRANSFER and standardized Exam Prep never read or receive them
 *
 * The live (LIVE_PROMPT) path is exercised through the route in learn-weakness-live-route.test.ts.
 * Mocked DB; no provider.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const h = vi.hoisted(() => ({
  evidenceRows: [] as Array<{ id: string; metadata: unknown }>,
  evidenceThrows: false,
  queries: [] as Array<{ sql: string; params: any[] }>,
  resume: vi.fn(),
  snapshot: vi.fn(),
  askFlags: vi.fn(),
  reserved: vi.fn(),
  consume: vi.fn(),
  link: vi.fn(),
  storeQuiz: vi.fn(),
  pool: vi.fn(),
  deliveries: vi.fn(),
  addCandidates: vi.fn(),
  generate: vi.fn(),
  enqueue: vi.fn(),
  practiceGen: vi.fn(),
}));

function fakeQuery(sql: string, params: any[] = []): any {
  const s = sql.replace(/\s+/g, ' ').trim();
  h.queries.push({ sql: s, params });
  if (/FROM learning_evidence WHERE student_id = \$1 AND concept_id = \$2 AND source_type = \$3/.test(s)) {
    if (h.evidenceThrows) throw new Error('db down');
    return { rows: h.evidenceRows };
  }
  return { rows: [], rowCount: 0 };
}
vi.mock('@/lib/db', () => ({
  db: { query: async (sql: string, p?: any[]) => fakeQuery(sql, p), connect: async () => ({ query: async (sql: string, p?: any[]) => fakeQuery(sql, p), release: () => {} }) },
  query: async (sql: string, p?: any[]) => fakeQuery(sql, p),
}));
vi.mock('@/services/activity-launch-lock.service', () => ({
  acquireLaunchLock: async () => ({ release: async () => {} }),
  launchLockKey: (i: any) => `${i.studentId}:${i.conceptId}:${i.quizMode}`,
  launchLockId: () => '1',
  withLaunchLock: async (_i: any, fn: () => any) => fn(),
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
  reconcileInventory: vi.fn(),
  retireAllInventory: vi.fn(),
  storeReadyActivity: vi.fn(),
}));
vi.mock('@/services/question-bank.service', () => ({
  loadBankPool: (...a: any[]) => h.pool(...a),
  recordBankDeliveries: (...a: any[]) => h.deliveries(...a),
  addValidatedCandidates: (...a: any[]) => h.addCandidates(...a),
}));
vi.mock('@/services/generation-queue.service', () => ({
  enqueueGenerationJob: (...a: any[]) => h.enqueue(...a),
  openBankSupply: async () => 0,
  runGenerationWorker: vi.fn(),
}));
vi.mock('@/services/activity-candidate-generation.service', () => ({ generateActivityCandidates: (...a: any[]) => h.generate(...a), questionGeneratorIdentity: vi.fn() }));
vi.mock('@/services/subject-generation-context.service', () => ({ getSubjectIBContext: async () => null, resolveLanguageForSubject: async () => 'es' }));
vi.mock('@/services/quiz-generation.service', async (orig) => ({
  ...(await orig<typeof import('@/services/quiz-generation.service')>()),
  generatePracticeQuestions: (...a: any[]) => h.practiceGen(...a),
}));

import { getLearnWeaknessesForConcept } from '@/services/learn-weakness.service';
import { loadLatestLearnWeaknesses } from '@/services/learn-guided.service';
import {
  buildLearnWeaknessProvenance, focusFromEvidenceRows, learnFocusPriorityCap, matchLearnFocusItems, prioritiseOrder, questionMatchesLearnFocus,
  type LearnWeaknessFocus,
} from '@/lib/learn-guided/weakness-focus';
import { assembleFromBank, type BankCandidate } from '@/lib/activity-delivery/assembly';
import { deliverCanonicalActivity } from '@/services/activity-delivery.service';
import { bankReplenishHandler } from '@/services/activity-delivery-worker.service';
import { QUIZ_MODE_CONFIG } from '@/lib/quiz/quiz-mode-config';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf-8');
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const walk = (dir: string): string[] => readdirSync(join(ROOT, dir)).flatMap((n) => (statSync(join(ROOT, dir, n)).isDirectory() ? walk(`${dir}/${n}`) : [`${dir}/${n}`]));

const WEAKNESS = 'confunde numerador y denominador al simplificar fracciones';
const learnRow = (over: Record<string, unknown> = {}) => ({
  id: 'ev-learn-1',
  metadata: { activityType: 'LEARN_CHECK', learnSession: { version: 'learn-guided-v1', interactionCount: 7, closedBy: 'CAP', weaknesses: [WEAKNESS], misconceptionIds: ['mis-frac-1'], ...over } },
});
const FOCUS: LearnWeaknessFocus = { learnEvidenceIds: ['ev-learn-1'], weaknesses: [WEAKNESS], misconceptionIds: ['mis-frac-1'] };

// Ten clearly different practice items; q7 targets the weakness by text, q9 by its misconception tag.
const Q = (i: number, over: object = {}): any => ({
  id: `q${i}`, conceptId: 'c1', type: 'numeric_problem', answerFormat: 'text', difficulty: 3,
  question: `${i + 3} zorbl${i}s cuestan ${i * 7 + 11} flur${i}s. ¿Cuánto cuestan ${i + 9}?`, correctAnswer: String(i), explanation: 'e', ...over,
});
const MATCH_TEXT = (i: number) => Q(i, { type: 'short_answer', question: `Simplifica la fracción 12/${i + 30}: ¿qué pasa con el numerador y el denominador?` });
const cand = (q: any, over: Partial<BankCandidate> = {}): BankCandidate => ({ id: `b-${q.id}`, question: q, difficulty: 3, contentFingerprint: `fp-${q.id}`, transferDepth: null, usageCount: 0, delivered: false, ...over });

const PRACTICE_CONTRACT: any = {
  conceptId: 'c1', activityType: 'PRACTICE', language: 'es', academic: { curriculum: null, programme: 'none', year: null, subjectGroup: null, level: null },
  difficulty: { min: 2, max: 4, target: 3 }, itemCount: 4, independence: false, policyVersion: 'studyus-canonical-v1',
};
const PRACTICE_MARKER: any = {
  pedagogicalPolicyVersion: 'studyus-canonical-v1', canonicalRevision: 'r', canonicalStage: 'PRACTICE', canonicalActivityType: 'PRACTICE',
  itemCount: { min: 4, max: 4, authorized: 4 }, difficulty: { min: 2, max: 4, target: 3 }, assistanceAllowed: true, independence: false, supportLevel: 'ASSISTED', minimumScorePercent: 80,
};
const PRACTICE_INPUT: any = {
  studentId: 's1', subjectId: 'sub1', conceptId: 'c1', quizMode: 'topic_practice', activityType: 'PRACTICE', contract: PRACTICE_CONTRACT,
  academic: PRACTICE_CONTRACT.academic, v1Marker: PRACTICE_MARKER, canonicalRevision: 'r',
};
const PROVE_INPUT: any = {
  ...PRACTICE_INPUT, quizMode: 'canonical_prove', activityType: 'PROVE',
  contract: { ...PRACTICE_CONTRACT, activityType: 'PROVE', independence: true, itemCount: 4 },
  v1Marker: { ...PRACTICE_MARKER, canonicalStage: 'PROVE', canonicalActivityType: 'PROVE', independence: true, supportLevel: 'NONE' },
};

const provenanceWrites = () =>
  h.queries.filter((q) => q.sql.startsWith('UPDATE quiz_sessions SET canonical_activity_contract = canonical_activity_contract ||')).map((q) => ({ quizId: q.params[0], provenance: JSON.parse(q.params[1]) }));
const evidenceReads = () => h.queries.filter((q) => /FROM learning_evidence WHERE student_id = \$1 AND concept_id = \$2 AND source_type = \$3/.test(q.sql));

beforeEach(() => {
  for (const f of Object.values(h)) if (typeof f === 'function' && 'mockReset' in f) (f as any).mockReset();
  h.evidenceRows = [learnRow()];
  h.evidenceThrows = false;
  h.queries = [];
  h.resume.mockResolvedValue(null);
  h.snapshot.mockResolvedValue({ evidenceCount: 3, lastEvidenceId: 'ev-learn-1', criticalMisconceptions: 0, hintsUsed: 0 });
  h.askFlags.mockResolvedValue(new Map([['c1', false]]));
  h.reserved.mockResolvedValue(new Set());
  h.consume.mockResolvedValue(null);
  h.storeQuiz.mockResolvedValue('quiz-new');
  h.deliveries.mockResolvedValue(undefined);
  h.link.mockResolvedValue(undefined);
  h.enqueue.mockResolvedValue(undefined);
  h.addCandidates.mockResolvedValue({ inserted: 3, ids: ['n1', 'n2', 'n3'] });
  h.generate.mockResolvedValue({ questions: [Q(1), Q(2), Q(3)], generator: { provider: 'p', model: 'm', promptId: 'x', promptVersion: '3', operationId: 'op' } });
});

describe('the ONE shared accessor', () => {
  it('returns the latest LEARN session weaknesses + misconception ids + its evidence id', async () => {
    expect(await getLearnWeaknessesForConcept('s1', 'c1')).toEqual(FOCUS);
    const [read1] = evidenceReads();
    expect(read1.params).toEqual(['s1', 'c1', 'LEARN_GUIDED']);
    expect(read1.sql).toMatch(/metadata->>'activityType' = 'LEARN_CHECK' ORDER BY timestamp DESC, id DESC LIMIT 1$/);
  });

  it('null when there is no LEARN session, it detected nothing, or the read fails (never throws)', async () => {
    h.evidenceRows = [];
    expect(await getLearnWeaknessesForConcept('s1', 'c1')).toBeNull();
    h.evidenceRows = [learnRow({ weaknesses: [], misconceptionIds: undefined })];
    expect(await getLearnWeaknessesForConcept('s1', 'c1')).toBeNull();
    h.evidenceRows = [{ id: 'legacy', metadata: { activityType: 'LEARN_CHECK' } }];
    expect(await getLearnWeaknessesForConcept('s1', 'c1')).toBeNull();
    h.evidenceThrows = true;
    expect(await getLearnWeaknessesForConcept('s1', 'c1')).toBeNull();
  });

  it('misconception ids alone are a focus; weaknesses are deduplicated and bounded', () => {
    expect(focusFromEvidenceRows([learnRow({ weaknesses: [], misconceptionIds: ['m1', 'm1', 'm2'] })])).toEqual({ learnEvidenceIds: ['ev-learn-1'], weaknesses: [], misconceptionIds: ['m1', 'm2'] });
    const many = focusFromEvidenceRows([learnRow({ weaknesses: ['a uno', 'A uno', 'b', 'c', 'd', 'e', 'f', 'g'] })])!;
    expect(many.weaknesses).toEqual(['a uno', 'b', 'c', 'd', 'e']);
  });

  it('the legacy weakness loader delegates to it (one reader of the LEARN row)', async () => {
    expect(await loadLatestLearnWeaknesses('s1', 'c1')).toEqual([WEAKNESS]);
    expect(code('src/services/learn-guided.service.ts')).toMatch(/getLearnWeaknessesForConcept\(studentId, conceptId\)/);
    // the only SQL reader of learnSession weaknesses is the shared accessor
    const readers = walk('src').filter((f) => /\.tsx?$/.test(f) && /FROM learning_evidence[\s\S]{0,200}source_type = \$3[\s\S]{0,120}LEARN_CHECK/.test(code(f)));
    expect(readers).toEqual(['src/services/learn-weakness.service.ts']);
  });
});

describe('matching + deterministic priority (pure)', () => {
  it('matches by misconception tag or by the weakness content words; unrelated items do not match', () => {
    expect(questionMatchesLearnFocus(Q(9, { misconceptionTarget: 'mis-frac-1' }), FOCUS)).toBe(true);
    expect(questionMatchesLearnFocus(MATCH_TEXT(7), FOCUS)).toBe(true);
    expect(questionMatchesLearnFocus(Q(1), FOCUS)).toBe(false);
    expect(questionMatchesLearnFocus(Q(9, { misconceptionTarget: 'other' }), FOCUS)).toBe(false);
  });

  it('prioritiseOrder only re-orders: same items, matched first up to the cap, stable otherwise', () => {
    const order = prioritiseOrder([1, 2, 3, 4, 5, 6], (x) => x % 2 === 0, 2);
    expect(order).toEqual([2, 4, 1, 3, 5, 6]);
    expect([...order].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(learnFocusPriorityCap(4)).toBe(2);
    expect(learnFocusPriorityCap(5)).toBe(3);
  });

  it('assembleFromBank (PRACTICE): matched candidates are delivered, the count and the band are unchanged', () => {
    const pool = [...Array.from({ length: 8 }, (_, i) => cand(Q(i))), cand(MATCH_TEXT(8)), cand(Q(9, { misconceptionTarget: 'mis-frac-1' })), cand(MATCH_TEXT(10), { difficulty: 5 })];
    const priority = new Set(matchLearnFocusItems(pool, FOCUS));
    expect(priority).toEqual(new Set(['b-q8', 'b-q9', 'b-q10']));
    const base = { activityType: 'PRACTICE' as const, itemCount: 4, difficulty: { min: 2, max: 4, target: 3 }, language: 'es', excludeFingerprints: new Set<string>(), reservedCandidateIds: new Set<string>() };
    const plain = assembleFromBank(pool, base);
    const focused = assembleFromBank(pool, { ...base, priorityCandidateIds: priority, priorityCap: 2 });
    expect(plain.status).toBe('ASSEMBLED');
    expect(focused.status).toBe('ASSEMBLED');
    if (plain.status !== 'ASSEMBLED' || focused.status !== 'ASSEMBLED') return;
    expect(plain.candidateIds.filter((id) => priority.has(id))).toEqual([]);
    expect(focused.candidateIds).toHaveLength(4);
    expect(focused.candidateIds.slice(0, 2)).toEqual(['b-q8', 'b-q9']);
    // the out-of-band match is never forced in
    expect(focused.candidateIds).not.toContain('b-q10');
    // deterministic
    expect(assembleFromBank(pool, { ...base, priorityCandidateIds: priority, priorityCap: 2 })).toEqual(focused);
  });

  it('independent checks ignore a priority set entirely', () => {
    const pool = [...Array.from({ length: 8 }, (_, i) => cand(Q(i))), cand(MATCH_TEXT(8))];
    const base = { activityType: 'PROVE' as const, itemCount: 4, difficulty: { min: 2, max: 4, target: 3 }, language: 'es', excludeFingerprints: new Set<string>(), reservedCandidateIds: new Set<string>() };
    expect(assembleFromBank(pool, { ...base, priorityCandidateIds: new Set(['b-q8']), priorityCap: 2 })).toEqual(assembleFromBank(pool, base));
  });
});

describe('BANK_PRIORITY -- a cold-miss PRACTICE launch assembled from the validated bank', () => {
  it('the weakness reaches item selection and the session records provenance', async () => {
    h.pool.mockResolvedValue([...Array.from({ length: 8 }, (_, i) => cand(Q(i))), cand(MATCH_TEXT(8))]);
    const res = await deliverCanonicalActivity(PRACTICE_INPUT);
    expect(res).toMatchObject({ status: 'DELIVERED', source: 'BANK' });
    if (res.status !== 'DELIVERED') return;
    expect(res.questions).toHaveLength(4);
    expect(res.questions.map((q) => q.id)).toContain('q8');
    const expected = { version: 'learn-weakness-provenance-v1', learnEvidenceIds: ['ev-learn-1'], weaknesses: [WEAKNESS], misconceptionIds: ['mis-frac-1'], appliedVia: 'BANK_PRIORITY', matchedItemIds: ['b-q8'] };
    expect(res.learnWeaknessProvenance).toEqual(expected);
    expect(provenanceWrites()).toEqual([{ quizId: 'quiz-new', provenance: expected }]);
    // read ONCE for the launch (the assembly reuses the launch's focus)
    expect(evidenceReads()).toHaveLength(1);
  });

  it('no item can be matched -> still recorded as considered, with matchedItemIds []', async () => {
    h.pool.mockResolvedValue(Array.from({ length: 8 }, (_, i) => cand(Q(i))));
    const res = await deliverCanonicalActivity(PRACTICE_INPUT);
    expect(res).toMatchObject({ status: 'DELIVERED', source: 'BANK', learnWeaknessProvenance: { appliedVia: 'BANK_PRIORITY', matchedItemIds: [], weaknesses: [WEAKNESS] } });
    expect(provenanceWrites()).toHaveLength(1);
  });

  it('no LEARN focus -> the delivery is byte-identical to before (no provenance write)', async () => {
    h.evidenceRows = [];
    h.pool.mockResolvedValue(Array.from({ length: 8 }, (_, i) => cand(Q(i))));
    const res = await deliverCanonicalActivity(PRACTICE_INPUT);
    expect(res).toMatchObject({ status: 'DELIVERED', source: 'BANK' });
    expect(res).not.toHaveProperty('learnWeaknessProvenance');
    expect(provenanceWrites()).toEqual([]);
  });
});

describe('CACHE_PRIORITY -- a READY prepared PRACTICE set consumed at launch', () => {
  it('the READY preparation assembles through the same prioritising assembly (worker)', () => {
    const worker = code('src/services/activity-delivery-worker.service.ts');
    expect(worker).toMatch(/assembleActivityForLearner\(\{ studentId: p\.studentId, contract, academic, reservedCandidateIds/);
    const assembly = code('src/services/activity-assembly.service.ts');
    // with no focus handed in, a PRACTICE assembly reads it itself
    expect(assembly).toMatch(/params\.learnFocus !== undefined \? Promise\.resolve\(params\.learnFocus\) : getLearnWeaknessesForConcept\(/);
  });

  it('the consumed set records its re-measured match as provenance', async () => {
    h.consume.mockResolvedValue({ id: 'prep-1', questions: [Q(1), MATCH_TEXT(2), Q(3), Q(4)], candidateIds: ['c-1', 'c-2', 'c-3', 'c-4'] });
    const res = await deliverCanonicalActivity(PRACTICE_INPUT);
    expect(res).toMatchObject({ status: 'DELIVERED', source: 'INVENTORY' });
    const expected = { version: 'learn-weakness-provenance-v1', learnEvidenceIds: ['ev-learn-1'], weaknesses: [WEAKNESS], misconceptionIds: ['mis-frac-1'], appliedVia: 'CACHE_PRIORITY', matchedItemIds: ['c-2'] };
    expect(res.status === 'DELIVERED' && res.learnWeaknessProvenance).toEqual(expected);
    expect(provenanceWrites()).toEqual([{ quizId: 'quiz-new', provenance: expected }]);
    expect(h.pool).not.toHaveBeenCalled();
  });

  it('a READY set prepared BEFORE the LEARN session is never delivered: the LEARN row moves the learner-state fingerprint', () => {
    expect(code('src/services/activity-delivery-context.service.ts')).toMatch(/SELECT id::text FROM learning_evidence WHERE student_id = \$1 AND concept_id = \$2 ORDER BY timestamp DESC, id DESC LIMIT 1\) AS last_evidence_id/);
  });

  it('a RESUMED session is returned as it was created (no second provenance)', async () => {
    h.resume.mockResolvedValue({ quizId: 'quiz-open', questions: [Q(1)] });
    const res = await deliverCanonicalActivity(PRACTICE_INPUT);
    expect(res).toMatchObject({ status: 'DELIVERED', source: 'RESUMED', quizId: 'quiz-open' });
    expect(provenanceWrites()).toEqual([]);
  });
});

describe('pre-generated supply -- PRACTICE bank replenishment', () => {
  const job = (activityType: string): any => ({
    dedupKey: 'bank:c1', payload: { studentId: 's1', subjectId: 'sub1', conceptId: 'c1', activityType, language: 'es', academic: PRACTICE_CONTRACT.academic, difficulty: 3, needed: 3, round: 1 },
  });

  it('PRACTICE candidates are generated with the LEARN weaknesses', async () => {
    await bankReplenishHandler(job('PRACTICE'));
    expect(h.generate).toHaveBeenCalledTimes(1);
    expect(h.generate.mock.calls[0][0]).toMatchObject({ activityType: 'PRACTICE', learnWeaknesses: [WEAKNESS] });
  });

  it('every other activity type is generated exactly as before (no LEARN read, no weaknesses)', async () => {
    for (const t of ['PROVE', 'RETAIN', 'TRANSFER', 'LEARN_CHECK']) {
      h.generate.mockClear();
      h.queries = [];
      await bankReplenishHandler(job(t));
      expect(h.generate.mock.calls[0][0], t).not.toHaveProperty('learnWeaknesses');
      expect(evidenceReads(), t).toEqual([]);
    }
  });

  it('the candidate generator appends them to the PRACTICE guidance only', async () => {
    const { generateActivityCandidates } = await vi.importActual<typeof import('@/services/activity-candidate-generation.service')>('@/services/activity-candidate-generation.service');
    h.practiceGen.mockResolvedValue([]);
    const p = { conceptId: 'c1', studentId: 's1', subjectId: 'sub1', count: 3, difficulty: 3, language: 'es', ibContext: null, parentOperationId: 'op', learnWeaknesses: [WEAKNESS] };
    await generateActivityCandidates({ ...p, activityType: 'PRACTICE' });
    const guidance = h.practiceGen.mock.calls[0][3].guidance as string;
    expect(guidance.startsWith(QUIZ_MODE_CONFIG.topic_practice.guidance)).toBe(true);
    expect(guidance).toContain(`- ${WEAKNESS}`);
    h.practiceGen.mockClear();
    await generateActivityCandidates({ ...p, activityType: 'PRACTICE', learnWeaknesses: [] });
    expect(h.practiceGen.mock.calls[0][3].guidance).toBe(QUIZ_MODE_CONFIG.topic_practice.guidance);
  });
});

describe('untouched: independent checks and standardized Exam Prep', () => {
  it('a PROVE delivery never reads the LEARN focus and records no provenance', async () => {
    h.pool.mockResolvedValue([...Array.from({ length: 8 }, (_, i) => cand(Q(i))), cand(MATCH_TEXT(8))]);
    const res = await deliverCanonicalActivity(PROVE_INPUT);
    expect(res).toMatchObject({ status: 'DELIVERED', source: 'BANK' });
    expect(res).not.toHaveProperty('learnWeaknessProvenance');
    expect(evidenceReads()).toEqual([]);
    expect(provenanceWrites()).toEqual([]);
  });

  it('no standardized Exam Prep module (exam-core, exam bank, assessment snapshot) reads or receives LEARN weaknesses', () => {
    const files = [...walk('src/lib/exam-core'), ...walk('src/lib/assessment-execution'), ...walk('src/lib/assessment-blueprint')].filter((f) => /\.tsx?$/.test(f));
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) expect(code(f), f).not.toMatch(/learn-weakness|weakness-focus|learnWeakness|practiceGuidanceWithLearnWeaknesses/);
  });

  it('the live route reads the focus only for a verified v1 topic_practice, AFTER the standardized NOT_READY gate', () => {
    const route = code('src/app/api/quizzes/generate-and-take/route.ts');
    expect(route).toMatch(/validated\.quizMode === 'topic_practice' && v1Marker && validated\.conceptId\s*\? await getLearnWeaknessesForConcept\(/);
    expect(route.indexOf('getLearnWeaknessesForConcept(validated.studentId')).toBeGreaterThan(route.indexOf('if (!studentRuntimeMayGenerateQuestions(validated.quizMode))'));
    // the weaknesses only ever reach the Practice/Review generator guidance
    expect(route.match(/practiceGuidanceWithLearnWeaknesses\(/g)).toHaveLength(1);
  });

  it('provenance shape', () => {
    expect(buildLearnWeaknessProvenance(FOCUS, 'LIVE_PROMPT', ['q1', 'q1'])).toEqual({
      version: 'learn-weakness-provenance-v1', learnEvidenceIds: ['ev-learn-1'], weaknesses: [WEAKNESS], misconceptionIds: ['mis-frac-1'], appliedVia: 'LIVE_PROMPT', matchedItemIds: ['q1'],
    });
  });
});
