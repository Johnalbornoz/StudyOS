/**
 * D78 / D78A -- PRACTICE base level + bounded +1 exposure (operator decisions 2026-10-17).
 *
 *  - strong signal = the existing one: latest Practice >= 80 with no critical misconception;
 *  - 3-item session: normal = 3 at base; strong = 2 at base + 1 at base+1; 2-item session: never +1;
 *  - base = earned level, floor 2, persistent cap 3; it rises by +1 ONLY after a >= 80 session
 *    (no critical misconception) that already carried the base+1 item AND answered it correct (D78A);
 *  - nothing lowers the base: < 60 / critical misconception only suppresses the next +1, and
 *    REINFORCE targets the current base;
 *  - never beyond base+1; a correct level-4 item at base 3 never makes the base 4.
 *
 * Pure policy + assembly + mocked worker/delivery (no DB, no provider).
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
  depthAt: vi.fn(),
  enqueue: vi.fn(),
  inFlight: vi.fn(),
  resume: vi.fn(),
  storeQuiz: vi.fn(),
  practiceGen: vi.fn(),
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
  countValidBankDepthAtLevel: (...a: any[]) => h.depthAt(...a),
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
vi.mock('@/services/activity-candidate-generation.service', () => ({ generateActivityCandidates: vi.fn() }));
vi.mock('@/services/subject-generation-context.service', () => ({ getSubjectIBContext: async () => null, resolveLanguageForSubject: async () => 'es' }));
vi.mock('@/services/learn-weakness.service', () => ({ getLearnWeaknessesForConcept: async () => null, recordLearnWeaknessProvenance: vi.fn() }));
vi.mock('@/services/ask-confidence.service', () => ({ computeAskConfidenceFlags: async () => new Map() }));
vi.mock('@/services/quiz-generation.service', async (orig) => ({
  ...(await orig<typeof import('@/services/quiz-generation.service')>()),
  generatePracticeQuestions: (...a: any[]) => h.practiceGen(...a),
}));
vi.mock('@/services/quiz-persistence.service', async (orig) => ({
  ...(await orig<typeof import('@/services/quiz-persistence.service')>()),
  findResumableCanonicalSession: (...a: any[]) => h.resume(...a),
  storeQuiz: (...a: any[]) => h.storeQuiz(...a),
}));

import {
  computePracticeExposure,
  evaluateCanonicalLearningState,
  practiceMixForItemCount,
  practiceSessionBaseLevel,
  resolvePracticeBase,
  resolveProveDifficulty,
  resolveReinforceDifficulty,
  PRACTICE_MAX_BASE,
} from '@/lib/pedagogical-engine';
import { buildActivityContract } from '@/lib/pedagogical-engine/activity-contract';
import type { PracticeExposure, RawEvidenceItem } from '@/lib/pedagogical-engine/types';
import { assembleFromBank, countValidCandidates, practiceMixFallback, type BankCandidate } from '@/lib/activity-delivery/assembly';
import { activityContractFingerprint, deliveryPracticeMix, type ActivityContract } from '@/lib/activity-delivery/contract';
import { mapStudyUSEvidenceToPedagogicalEvidence, parsePracticeExposure } from '@/lib/pedagogical-shadow/evidence-adapter';
import { combinePracticeMix, generatePracticePlusOneItems } from '@/services/practice-mix-generation.service';
import { prepareInventoryHandler } from '@/services/activity-delivery-worker.service';
import { deliverCanonicalActivity, type DeliveryInput } from '@/services/activity-delivery.service';

// ---------------------------------------------------------------- evidence fixtures
let seq = 0;
const at = (m: number) => new Date(Date.UTC(2026, 9, 17, 8, m)).toISOString();
const P = (scorePercent: number, o: { difficulty?: number; exposure?: PracticeExposure; misconception?: boolean; itemCount?: number } = {}): RawEvidenceItem => {
  seq++;
  const itemCount = o.itemCount ?? 3;
  return {
    id: `p${seq}`, activityType: 'PRACTICE', timestamp: at(seq), itemCount, correctCount: Math.round((scorePercent / 100) * itemCount), scorePercent,
    independent: false, difficulty: o.difficulty ?? o.exposure?.baseLevel ?? 2, hasCriticalMisconception: o.misconception ?? false,
    ...(o.exposure ? { practiceExposure: o.exposure } : {}),
  };
};
const X = (baseLevel: number, plusOneItems = 0, plusOneCorrect = 0): PracticeExposure => ({ baseLevel, plusOneItems, plusOneLevel: plusOneItems > 0 ? baseLevel + 1 : null, plusOneCorrect });
const mix3 = (ev: RawEvidenceItem[]) => {
  const r = resolvePracticeBase(ev);
  return practiceMixForItemCount(r.base, r.exposure.plusOneEligible, 3, r.exposure.reasonCode).items;
};

describe('D78 policy -- base + exposure (resolvePracticeBase)', () => {
  it('no Practice evidence: base 2 (default), no +1', () => {
    const r = resolvePracticeBase([]);
    expect(r).toMatchObject({ base: 2, target: 2, reasonCode: 'PRACTICE_BASE_DEFAULT', exposure: { plusOneEligible: false, reasonCode: 'PRACTICE_EXPOSURE_NONE' } });
    expect(mix3([])).toEqual([{ level: 2, count: 3 }]);
  });

  it('weak (< 60): base only, the +1 is suppressed', () => {
    const r = resolvePracticeBase([P(33)]);
    expect(r.base).toBe(2);
    expect(r.exposure).toMatchObject({ plusOneEligible: false, reasonCode: 'PRACTICE_EXPOSURE_SUPPRESSED' });
    expect(mix3([P(33)])).toEqual([{ level: 2, count: 3 }]);
  });

  it('normal (60-79): base unchanged, no +1 (strong signal not met)', () => {
    const ev = [P(67, { exposure: X(2) })];
    const r = resolvePracticeBase(ev);
    expect(r).toMatchObject({ base: 2, reasonCode: 'PRACTICE_BASE_MAINTAINED', exposure: { plusOneEligible: false, reasonCode: 'PRACTICE_EXPOSURE_NONE' } });
    expect(mix3(ev)).toEqual([{ level: 2, count: 3 }]);
  });

  it('strong (latest >= 80, no misconception): 3-item session = 2 at base + 1 at base+1', () => {
    const ev = [P(100, { exposure: X(2) })];
    const r = resolvePracticeBase(ev);
    expect(r).toMatchObject({ base: 2, target: 2, exposure: { plusOneEligible: true, plusOneLevel: 3, reasonCode: 'PRACTICE_EXPOSURE_PLUS_ONE' } });
    expect(mix3(ev)).toEqual([{ level: 2, count: 2 }, { level: 3, count: 1 }]);
  });

  it('a 2-item session never carries a +1 item; other sizes are all at base', () => {
    expect(practiceMixForItemCount(2, true, 2, 'PRACTICE_EXPOSURE_PLUS_ONE').items).toEqual([{ level: 2, count: 2 }]);
    expect(practiceMixForItemCount(3, true, 4, 'PRACTICE_EXPOSURE_PLUS_ONE').items).toEqual([{ level: 3, count: 4 }]);
    expect(practiceMixForItemCount(2, false, 3, 'PRACTICE_EXPOSURE_NONE').items).toEqual([{ level: 2, count: 3 }]);
  });

  it('the base does NOT rise after a strong session without the +1 item (legacy or exposure-free)', () => {
    expect(resolvePracticeBase([P(100)]).base).toBe(2); // legacy row, no exposure record
    expect(resolvePracticeBase([P(100, { exposure: X(2, 0, 0) })]).base).toBe(2);
  });

  it('D78A: >= 80 with the +1 item answered correct -> base +1', () => {
    const r = resolvePracticeBase([P(100, { exposure: X(2) }), P(100, { exposure: X(2, 1, 1) })]);
    expect(r).toMatchObject({ base: 3, reasonCode: 'PRACTICE_BASE_EARNED_AFTER_EXPOSURE', exposure: { plusOneEligible: true, plusOneLevel: 4 } });
  });

  it('D78A: >= 80 with the +1 item answered INCORRECT -> base unchanged, the next session still carries the +1 item', () => {
    // a 5-item record at 80% (4/5) whose one base+1 item was the miss
    const ev = [P(100, { exposure: X(2) }), P(80, { exposure: X(2, 1, 0), itemCount: 5 })];
    const r = resolvePracticeBase(ev);
    expect(r).toMatchObject({ base: 2, reasonCode: 'PRACTICE_BASE_MAINTAINED', exposure: { plusOneEligible: true, plusOneLevel: 3 } });
    expect(mix3(ev)).toEqual([{ level: 2, count: 2 }, { level: 3, count: 1 }]);
  });

  it('the operator example: S1 2,2,2 -> 100 -> S2 2,2,3 -> 100 -> S3 3,3,4 (base 3) -> 100 -> base stays 3, sessions 3,3,4', () => {
    const s1 = P(100, { exposure: X(2) });
    expect(mix3([s1])).toEqual([{ level: 2, count: 2 }, { level: 3, count: 1 }]);
    const s2 = P(100, { exposure: X(2, 1, 1) });
    expect(resolvePracticeBase([s1, s2]).base).toBe(3);
    expect(mix3([s1, s2])).toEqual([{ level: 3, count: 2 }, { level: 4, count: 1 }]);
    const s3 = P(100, { exposure: X(3, 1, 1) });
    const r = resolvePracticeBase([s1, s2, s3]);
    expect(r).toMatchObject({ base: 3, reasonCode: 'PRACTICE_BASE_MAINTAINED' });
    expect(mix3([s1, s2, s3])).toEqual([{ level: 3, count: 2 }, { level: 4, count: 1 }]);
  });

  it('cap: base 3 + a correct level-4 item never makes the base 4; the persistent base max is 3', () => {
    expect(PRACTICE_MAX_BASE).toBe(3);
    const ev = Array.from({ length: 6 }, () => P(100, { exposure: X(3, 1, 1) }));
    expect(resolvePracticeBase(ev).base).toBe(3);
    // even a legacy row administered at 4 counts as base 3
    expect(resolvePracticeBase([P(100, { difficulty: 4 })]).base).toBe(3);
    expect(practiceSessionBaseLevel({ difficulty: 4 })).toBe(3);
  });

  it('never beyond base+1: every mix level is within [base, base+1]', () => {
    for (const base of [2, 3])
      for (const eligible of [true, false])
        for (const n of [2, 3]) {
          const m = practiceMixForItemCount(base, eligible, n, 'PRACTICE_EXPOSURE_NONE');
          for (const i of m.items) expect(i.level === base || i.level === base + 1).toBe(true);
          expect(m.items.reduce((a, i) => a + i.count, 0)).toBe(n);
        }
  });

  it('downgrades removed: < 60 or a critical misconception keeps the earned base and suppresses the +1', () => {
    const earned = [P(100, { exposure: X(2) }), P(100, { exposure: X(2, 1, 1) })];
    const low = resolvePracticeBase([...earned, P(33, { exposure: X(3, 1, 0) })]);
    expect(low).toMatchObject({ base: 3, exposure: { plusOneEligible: false, reasonCode: 'PRACTICE_EXPOSURE_SUPPRESSED' } });
    const mis = resolvePracticeBase([...earned, P(100, { exposure: X(3, 1, 1), misconception: true })]);
    expect(mis).toMatchObject({ base: 3, exposure: { plusOneEligible: false, reasonCode: 'PRACTICE_EXPOSURE_SUPPRESSED' } });
    // a misconception session never earns a rise either
    expect(resolvePracticeBase([P(100, { exposure: X(2, 1, 1), misconception: true })]).base).toBe(2);
    // a later legacy row at a lower level never lowers the base
    expect(resolvePracticeBase([...earned, P(100, { difficulty: 2 })]).base).toBe(3);
  });

  it('REINFORCE targets the CURRENT base (not base-1), clamped into [1,3]', () => {
    expect(resolveReinforceDifficulty(3)).toEqual({ target: 3, reasonCode: 'REINFORCE_AT_CURRENT_PRACTICE_BASE' });
    expect(resolveReinforceDifficulty(2).target).toBe(2);
    const c = buildActivityContract('PRACTICE', 'REINFORCE', resolveReinforceDifficulty(3));
    expect(c?.difficulty).toMatchObject({ target: 3, min: 1, max: 3 });
    expect(c?.practiceMix?.items).toEqual([{ level: 3, count: 3 }]);
  });

  it('exposure is computed from what was served, with BINARY correctness', () => {
    expect(computePracticeExposure(2, [{ difficulty: 2, correct: true }, { difficulty: 2, correct: false }, { difficulty: 3, correct: true }])).toEqual({ baseLevel: 2, plusOneItems: 1, plusOneLevel: 3, plusOneCorrect: 1 });
    expect(computePracticeExposure(3, [{ difficulty: 3, correct: true }, { difficulty: 3, correct: true }, { difficulty: 4, correct: false }])).toEqual({ baseLevel: 3, plusOneItems: 1, plusOneLevel: 4, plusOneCorrect: 0 });
    expect(computePracticeExposure(2, [{ difficulty: 2, correct: true }, { difficulty: 2, correct: true }, { difficulty: 2, correct: true }])).toEqual({ baseLevel: 2, plusOneItems: 0, plusOneLevel: null, plusOneCorrect: 0 });
  });
});

// ---------------------------------------------------------------- full engine
const LEARN = (): RawEvidenceItem[] => [78, 80, 100].map((s) => {
  seq++;
  return { id: `l${seq}`, activityType: 'LEARN_CHECK' as const, timestamp: at(seq), itemCount: 5, correctCount: 0, scorePercent: s, independent: false, difficulty: 2, hasCriticalMisconception: false };
});
const decide = (evidence: RawEvidenceItem[], activeCriticalMisconception = false) =>
  evaluateCanonicalLearningState({ conceptId: 'c1', studentId: 's1', now: at(59), evidence, activeCriticalMisconception });

describe('D78 engine -- contract carries base + mix; Prove derivation', () => {
  it('PRACTICE contract: difficulty.target = base, practiceMix = the session mix', () => {
    const d = decide([...LEARN(), P(100, { exposure: X(2) })]);
    expect(d.stage).toBe('PRACTICE');
    expect(d.activityContract?.difficulty).toMatchObject({ target: 2, min: 2, max: 4, reasonCode: 'PRACTICE_BASE_MAINTAINED' });
    expect(d.activityContract?.practiceMix).toMatchObject({ baseLevel: 2, plusOneEligible: true, items: [{ level: 2, count: 2 }, { level: 3, count: 1 }] });
  });

  it('an active critical misconception -> REINFORCE at the current base, no +1', () => {
    const d = decide([...LEARN(), P(100, { exposure: X(2) }), P(100, { exposure: X(2, 1, 1) })], true);
    expect(d.intervention).toBe('REINFORCE');
    expect(d.activityContract?.difficulty).toMatchObject({ target: 3, reasonCode: 'REINFORCE_AT_CURRENT_PRACTICE_BASE' });
    expect(d.activityContract?.practiceMix?.items).toEqual([{ level: 3, count: 3 }]);
  });

  it('Prove: a session with the +1 item counts at its BASE (one level-4 item at base 3 never makes Prove "practice at 4")', () => {
    // even if a row's aggregate difficulty were recorded as 4, its exposure base (3) is what qualifies
    const ev = [...LEARN(), P(100, { exposure: X(2) }), P(100, { exposure: X(2, 1, 1) }), P(100, { exposure: X(3, 1, 1), difficulty: 4 })];
    const d = decide(ev);
    expect(d.stage).toBe('PROVE');
    expect(d.activityContract?.difficulty.target).toBe(3);
    // legacy rows (no exposure) keep their administered difficulty -- history is not rewritten
    const legacy = decide([...LEARN(), P(100, { difficulty: 4 }), P(100, { difficulty: 4 }), P(100, { difficulty: 4 })]);
    expect(legacy.stage).toBe('PROVE');
    expect(legacy.activityContract?.difficulty.target).toBe(4);
    expect(resolveProveDifficulty(3).target).toBe(3);
  });
});

// ---------------------------------------------------------------- adapter
describe('D78 adapter -- metadata.practiceExposure -> RawEvidenceItem.practiceExposure', () => {
  const row = (practiceExposure: unknown) => ({
    id: 'r1', sourceType: 'PRACTICE_QUIZ', result: 'correct' as const, scorePercent: 100, difficulty: 2, timestamp: at(1), hintsUsed: 0, aiAssistanceType: 'NONE',
    activityType: 'PRACTICE', itemCount: 3, correctCount: 3, practiceExposure,
  });
  it('a valid record is mapped; a legacy row has none', () => {
    expect(mapStudyUSEvidenceToPedagogicalEvidence([row({ baseLevel: 2, plusOneItems: 1, plusOneLevel: 3, plusOneCorrect: 1 })]).items[0].practiceExposure).toEqual(X(2, 1, 1));
    expect(mapStudyUSEvidenceToPedagogicalEvidence([row(undefined)]).items[0].practiceExposure).toBeUndefined();
  });
  it('a malformed record fails closed (treated as legacy: no exposure, no rise)', () => {
    expect(parsePracticeExposure({ baseLevel: 2, plusOneItems: 1, plusOneLevel: 4, plusOneCorrect: 1 })).toBeNull();
    expect(parsePracticeExposure({ baseLevel: 2, plusOneItems: 1, plusOneLevel: 3, plusOneCorrect: 2 })).toBeNull();
    expect(parsePracticeExposure('x')).toBeNull();
    const r = mapStudyUSEvidenceToPedagogicalEvidence([row({ baseLevel: 2, plusOneItems: 1 })]);
    expect(r.items[0].practiceExposure).toBeUndefined();
    expect(r.warnings.join(' ')).toMatch(/practiceExposure is malformed/);
  });
});

// ---------------------------------------------------------------- bank assembly
const Q = (i: number, difficulty: number): any => ({
  id: `q${i}`, conceptId: 'c1', type: 'numeric_problem', answerFormat: 'text', difficulty,
  question: `${i + 3} zorbl${i}s cuestan ${i * 7 + 11} flur${i}s. ¿Cuánto cuestan ${i + 9}?`, correctAnswer: String(i), explanation: 'e',
});
const cand = (i: number, difficulty: number, over: Partial<BankCandidate> = {}): BankCandidate => ({
  id: `b${i}`, question: Q(i, difficulty), difficulty, contentFingerprint: `fp${i}`, transferDepth: null, usageCount: 0, delivered: false, lastDeliveredAt: null, ...over,
});
const REQ = (mix: { baseLevel: number; items: Array<{ level: number; count: number }> }) => ({
  activityType: 'PRACTICE' as const, itemCount: 3, difficulty: { min: 2, max: 4, target: mix.baseLevel }, language: 'es',
  excludeFingerprints: new Set<string>(), reservedCandidateIds: new Set<string>(), practiceMix: mix,
});
const levels = (r: ReturnType<typeof assembleFromBank>, pool: BankCandidate[]) =>
  r.status === 'ASSEMBLED' ? r.candidateIds.map((id) => pool.find((c) => c.id === id)!.difficulty).sort() : null;
const STRONG2 = { baseLevel: 2, items: [{ level: 2, count: 2 }, { level: 3, count: 1 }] };
const NORMAL2 = { baseLevel: 2, items: [{ level: 2, count: 3 }] };
const STRONG3 = { baseLevel: 3, items: [{ level: 3, count: 2 }, { level: 4, count: 1 }] };

describe('D78 bank assembly -- exact per-level counts, controlled fallback', () => {
  it('strong: exactly 2 at base + 1 at base+1 (even when base items are less used)', () => {
    const pool = [cand(1, 2), cand(2, 2), cand(3, 2), cand(4, 2), cand(5, 3, { usageCount: 5, delivered: true, lastDeliveredAt: 1 }), cand(6, 4)];
    expect(levels(assembleFromBank(pool, REQ(STRONG2)), pool)).toEqual([2, 2, 3]);
  });

  it('normal: all at base, a base+1 item is never served (no +1 for a non-strong learner)', () => {
    const pool = [cand(1, 3), cand(2, 3), cand(3, 2), cand(4, 2), cand(5, 2), cand(6, 4)];
    expect(levels(assembleFromBank(pool, REQ(NORMAL2)), pool)).toEqual([2, 2, 2]);
  });

  it('base 3 strong: 3,3,4 -- never a level above base+1', () => {
    const pool = [cand(1, 3), cand(2, 3), cand(3, 4), cand(4, 4), cand(5, 3)];
    expect(levels(assembleFromBank(pool, REQ(STRONG3)), pool)).toEqual([3, 3, 4]);
    const pool2 = [cand(1, 2), cand(2, 2), cand(3, 2), cand(4, 4)];
    // base 2: a level-4 item is base+2 -> inadmissible
    expect(levels(assembleFromBank(pool2, REQ(STRONG2)), pool2)).toEqual([2, 2, 2]);
  });

  it('no valid base+1 item -> controlled fallback to base items (never blocks)', () => {
    const pool = [cand(1, 2), cand(2, 2), cand(3, 2)];
    const r = assembleFromBank(pool, REQ(STRONG2));
    expect(levels(r, pool)).toEqual([2, 2, 2]);
    expect(practiceMixFallback(STRONG2, [2, 2, 2])).toEqual({ reasons: ['PRACTICE_MIX_PLUS_ONE_UNAVAILABLE'], planned: STRONG2.items, served: [{ level: 2, count: 3 }] });
    expect(practiceMixFallback(STRONG2, [3, 2, 2])).toBeNull();
  });

  it('base slots are never filled with a harder item; short = SHORT (emergency generation at base)', () => {
    const pool = [cand(1, 2), cand(2, 3), cand(3, 3)];
    expect(assembleFromBank(pool, REQ(STRONG2))).toMatchObject({ status: 'SHORT' });
    expect(assembleFromBank(pool, REQ(NORMAL2))).toMatchObject({ status: 'SHORT' });
  });

  it('REINFORCE band (1-3): base slots short of base items take the nearest LOWER level', () => {
    const pool = [cand(1, 3), cand(2, 2), cand(3, 1), cand(4, 2)];
    const req = { ...REQ({ baseLevel: 3, items: [{ level: 3, count: 3 }] }), difficulty: { min: 1, max: 3, target: 3 } };
    expect(levels(assembleFromBank(pool, req), pool)).toEqual([2, 2, 3]);
    expect(practiceMixFallback(req.practiceMix, [3, 2, 2])?.reasons).toEqual(['PRACTICE_MIX_BASE_FILLED_BELOW_BASE']);
  });

  it('bank depth counts only the levels the mix admits', () => {
    const pool = [cand(1, 2), cand(2, 3), cand(3, 4)];
    expect(countValidCandidates(pool, REQ(NORMAL2))).toBe(1);
    expect(countValidCandidates(pool, REQ(STRONG2))).toBe(2);
    expect(countValidCandidates(pool, { difficulty: { min: 2, max: 4, target: 2 }, excludeFingerprints: new Set() })).toBe(3); // no mix: D76 band unchanged
  });
});

// ---------------------------------------------------------------- contract fingerprint
describe('D78 contract -- the mix is part of the fingerprint', () => {
  const base: ActivityContract = {
    conceptId: 'c1', activityType: 'PRACTICE', language: 'es', academic: { curriculum: null, programme: 'none', year: null, subjectGroup: null, level: null },
    difficulty: { min: 2, max: 4, target: 2 }, itemCount: 3, independence: false, policyVersion: 'v1',
  };
  it('a set prepared for another mix is never compatible', () => {
    const strong = activityContractFingerprint({ ...base, practiceMix: STRONG2 });
    const normal = activityContractFingerprint({ ...base, practiceMix: NORMAL2 });
    expect(strong).not.toBe(normal);
    expect(strong).not.toBe(activityContractFingerprint(base));
  });
  it('a contract without a mix keeps its fingerprint (no churn for other activities)', () => {
    expect(activityContractFingerprint({ ...base, practiceMix: undefined })).toBe(activityContractFingerprint(base));
  });
  it('deliveryPracticeMix re-sizes the engine mix for the delivered count (2 items -> no +1)', () => {
    const m = practiceMixForItemCount(2, true, 3, 'PRACTICE_EXPOSURE_PLUS_ONE');
    expect(deliveryPracticeMix(m, 3)).toEqual(STRONG2);
    expect(deliveryPracticeMix(m, 2)).toEqual({ baseLevel: 2, items: [{ level: 2, count: 2 }] });
    expect(deliveryPracticeMix(undefined, 3)).toBeUndefined();
  });
});

// ---------------------------------------------------------------- live generation
describe('D78 live / emergency generation -- per-item levels', () => {
  beforeEach(() => h.practiceGen.mockReset());
  it('the +1 item replaces one base item only when the generator really produced it at base+1', () => {
    const baseSet = [Q(1, 2), Q(2, 2), Q(3, 2)];
    expect(combinePracticeMix(baseSet, [Q(9, 3)], 3, 1, 3).map((q) => q.difficulty)).toEqual([2, 2, 3]);
    expect(combinePracticeMix(baseSet, [Q(9, 2)], 3, 1, 3).map((q) => q.difficulty)).toEqual([2, 2, 2]);
    expect(combinePracticeMix(baseSet, [], 3, 1, 3).map((q) => q.difficulty)).toEqual([2, 2, 2]);
  });
  it('asks the certified generator for the +1 item AT base+1, never throws', async () => {
    h.practiceGen.mockResolvedValueOnce([Q(9, 3)]);
    const out = await generatePracticePlusOneItems('c1', 's1', 'sub1', { guidance: 'g', language: 'es' }, { level: 3, count: 1 });
    expect(out).toHaveLength(1);
    expect(h.practiceGen.mock.calls[0][3]).toMatchObject({ count: 1, difficulty: 3 });
    h.practiceGen.mockRejectedValueOnce(new Error('boom'));
    await expect(generatePracticePlusOneItems('c1', 's1', 'sub1', {}, { level: 3, count: 1 })).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------- replenishment + delivery (mocked)
describe('D78 replenishment + delivery', () => {
  const TARGET = { studentId: 's1', subjectId: 'sub1', conceptId: 'c1' };
  const job = (payload: any): any => ({ id: 'j1', kind: 'PREPARE_INVENTORY', dedupKey: 'prepare:s1:c1', payload, attempts: 1, maxAttempts: 3 });
  beforeEach(() => {
    for (const f of Object.values(h)) f.mockReset();
    h.query.mockResolvedValue({ rows: [] });
    h.reconcile.mockResolvedValue({ readyCompatible: 2, usedSlots: [0, 1] });
    h.reserved.mockResolvedValue(new Set());
    h.spare.mockResolvedValue(0);
    h.inFlight.mockResolvedValue(0);
    h.enqueue.mockResolvedValue(true);
    h.depth.mockResolvedValue(9);
    h.resume.mockResolvedValue(null);
    h.storeQuiz.mockResolvedValue('quiz-new');
    h.consume.mockResolvedValue(null);
    h.launch.mockReturnValue({ launchStatus: 'READY', launchParams: { mode: 'topic_practice' } });
  });
  const decisionWith = (mix: any) =>
    h.decision.mockResolvedValue({
      decision: { activityContract: { difficulty: { min: 2, max: 4, target: mix.baseLevel }, itemCount: { min: 2, max: 3 }, independence: false, practiceMix: mix }, policyVersion: 'v1', canonicalRevision: 'r' },
    });

  it('a strong learner with no valid base+1 item: one BANK_REPLENISH batch is requested AT base+1', async () => {
    decisionWith(practiceMixForItemCount(2, true, 3, 'PRACTICE_EXPOSURE_PLUS_ONE'));
    h.depthAt.mockResolvedValue(0);
    const r = await prepareInventoryHandler(job(TARGET));
    const plus = h.enqueue.mock.calls.filter((c) => c[0] === 'BANK_REPLENISH' && String(c[1]).includes(':plus3'));
    expect(plus).toHaveLength(1);
    expect(plus[0][2]).toMatchObject({ difficulty: 3, needed: 3, activityType: 'PRACTICE' });
    expect(r).toMatchObject({ ok: true, result: { plusOne: { level: 3, validPlusOne: 0 } } });
  });

  it('enough base+1 items, or a normal learner: no +1 replenishment', async () => {
    decisionWith(practiceMixForItemCount(2, true, 3, 'PRACTICE_EXPOSURE_PLUS_ONE'));
    h.depthAt.mockResolvedValue(2);
    await prepareInventoryHandler(job(TARGET));
    expect(h.enqueue.mock.calls.filter((c) => String(c[1]).includes(':plus'))).toHaveLength(0);
    h.enqueue.mockClear();
    decisionWith(practiceMixForItemCount(2, false, 3, 'PRACTICE_EXPOSURE_NONE'));
    await prepareInventoryHandler(job(TARGET));
    expect(h.depthAt).toHaveBeenCalledTimes(1);
    expect(h.enqueue.mock.calls.filter((c) => String(c[1]).includes(':plus'))).toHaveLength(0);
  });

  const INPUT = (practiceMix: any): DeliveryInput => ({
    studentId: 's1', subjectId: 'sub1', conceptId: 'c1', quizMode: 'topic_practice', activityType: 'PRACTICE',
    academic: { curriculum: null, programme: 'none', year: null, subjectGroup: null, level: null }, canonicalRevision: 'r',
    v1Marker: {
      pedagogicalPolicyVersion: 'v1', canonicalRevision: 'r', canonicalStage: 'PRACTICE', canonicalActivityType: 'PRACTICE', itemCount: { min: 2, max: 3, authorized: 3 },
      difficulty: { min: 2, max: 4, target: 2 }, assistanceAllowed: true, independence: false, supportLevel: 'ASSISTED', minimumScorePercent: 80,
    },
    contract: {
      conceptId: 'c1', activityType: 'PRACTICE', language: 'es', academic: { curriculum: null, programme: 'none', year: null, subjectGroup: null, level: null },
      difficulty: { min: 2, max: 4, target: 2 }, itemCount: 3, independence: false, policyVersion: 'v1', practiceMix,
    },
  });
  const fallbackWrites = () => h.query.mock.calls.filter((c) => String(c[0]).includes('practiceMixFallback'));

  it('a BANK delivery without the planned base+1 item is delivered and records practiceMixFallback (never blocked)', async () => {
    h.assemble.mockResolvedValue({ status: 'ASSEMBLED', questions: [Q(1, 2), Q(2, 2), Q(3, 2)], candidateIds: ['b1', 'b2', 'b3'], poolSize: 3, learnFocus: null, validDepth: 9 });
    const res = await deliverCanonicalActivity(INPUT(STRONG2));
    expect(res).toMatchObject({ status: 'DELIVERED', source: 'BANK' });
    expect(fallbackWrites()).toHaveLength(1);
    expect(JSON.parse(fallbackWrites()[0][1][1])).toMatchObject({ reasons: ['PRACTICE_MIX_PLUS_ONE_UNAVAILABLE'] });
  });

  it('a delivery matching its mix records nothing', async () => {
    h.assemble.mockResolvedValue({ status: 'ASSEMBLED', questions: [Q(1, 2), Q(2, 2), Q(3, 3)], candidateIds: ['b1', 'b2', 'b3'], poolSize: 3, learnFocus: null, validDepth: 9 });
    await deliverCanonicalActivity(INPUT(STRONG2));
    expect(fallbackWrites()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- D79 / D80 (approved 2026-10-17)
describe('D80 -- practiceMixFallback never creates +1 evidence or a base promotion', () => {
  it('planned 2,2,3 but served 2,2,2 (no valid base+1 supply): the exposure records 0 +1 items', () => {
    // what the session ACTUALLY served is what the evidence records -- the fallback base item is not a +1 item
    expect(computePracticeExposure(2, [{ difficulty: 2, correct: true }, { difficulty: 2, correct: true }, { difficulty: 2, correct: true }])).toEqual({ baseLevel: 2, plusOneItems: 0, plusOneLevel: null, plusOneCorrect: 0 });
  });
  it('a 100% fallback session (no +1 served) never promotes the persistent base; the next session still plans the +1', () => {
    const ev = [P(100, { exposure: X(2) }), P(100, { exposure: computePracticeExposure(2, [{ difficulty: 2, correct: true }, { difficulty: 2, correct: true }, { difficulty: 2, correct: true }]) })];
    const r = resolvePracticeBase(ev);
    expect(r.base).toBe(2);
    expect(r.exposure.plusOneEligible).toBe(true);
    expect(mix3(ev)).toEqual(expect.arrayContaining([expect.objectContaining({ level: 3 })]));
  });
  it('repeated fallbacks at base 3 never make the base 4 (persistent max 3)', () => {
    const ev = [P(100, { exposure: X(2) }), P(100, { exposure: X(2, 1, 1) }), ...Array.from({ length: 4 }, () => P(100, { exposure: X(3) }))];
    expect(resolvePracticeBase(ev).base).toBe(3);
  });
});

describe('D79 -- PROVE level mix (OPERATOR_DECISION_REQUIRED: no governed level-4 count for PROVE exists)', () => {
  it('without the decision, PROVE keeps its single target: base-3 Practice evidence -> PROVE level 3 (never forced higher, never a guessed mix)', () => {
    const ev = [...LEARN(), P(100, { exposure: X(2) }), P(100, { exposure: X(2, 1, 1) }), P(100, { exposure: X(3, 1, 1) })];
    const d = decide(ev);
    expect(d.stage).toBe('PROVE');
    expect(d.activityContract?.difficulty.target).toBe(3);
    expect((d.activityContract as any)?.proveMix).toBeUndefined();
  });
  it('the persistent Practice base never persists as 4 even with correct level-4 exposures', () => {
    const ev = [P(100, { exposure: X(2) }), P(100, { exposure: X(2, 1, 1) }), P(100, { exposure: X(3, 1, 1) }), P(100, { exposure: X(3, 1, 1) })];
    expect(resolvePracticeBase(ev).base).toBe(3);
  });
});
