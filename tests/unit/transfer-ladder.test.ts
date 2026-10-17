/**
 * APPLY -- adaptive transfer ladder (transfer-ladder-v1): pure rules + service orchestration with
 * injected fakes (no DB, no AI). Contract: docs/orchestration/OVERNIGHT_2026-10-16_CONTRACTS.md 1.2.
 */
import { describe, it, expect } from 'vitest';
import {
  applyTransferLadderChallenge,
  buildTransferLadderEvidence,
  highestLevelReached,
  initialTransferLadderState,
  isRepeatedContext,
  isTransferChallengePassed,
  replayTransferLadder,
  transferLadderCompetency,
  transferLadderCompletesApply,
  TRANSFER_LADDER_POLICY,
  type TransferLadderChallenge,
  type TransferLadderLevel,
} from '@/lib/transfer-ladder/ladder';
import {
  buildTransferLadderEvidenceInput,
  createTransferLadderService,
  isTransferLadderAuthorized,
  TransferLadderError,
  TRANSFER_LADDER_EVIDENCE_MODE,
  type TransferLadderDeps,
} from '@/services/transfer-ladder.service';
import type { TransferLadderSession, TransferLadderSessionState, TransferLadderStore } from '@/services/transfer-ladder-session.store';
import { canUseAI } from '@/lib/ai-permission-policy';
import { CanonicalDecisionUnavailableError } from '@/lib/pedagogical-decision';

let seq = 0;
function ch(level: TransferLadderLevel, scorePercent: number, certified = true, contextDomain: string | null = `d${++seq}`): TransferLadderChallenge {
  return { level, scorePercent, passed: isTransferChallengePassed(scorePercent), certified, taskId: `t${++seq}`, contextDomain };
}
function run(...cs: TransferLadderChallenge[]) {
  return replayTransferLadder(cs);
}

describe('transfer-ladder-v1 pure rules', () => {
  it('starts at NEAR, open, with no challenges', () => {
    const s = initialTransferLadderState();
    expect(s).toEqual({ challenges: [], currentLevel: 'NEAR', closed: false, closeReason: null });
    expect(TRANSFER_LADDER_POLICY).toMatchObject({ minChallenges: 3, maxChallenges: 5, passScorePercent: 80 });
  });

  it('pass threshold is >= 80 inclusive (no 70% gate)', () => {
    expect(isTransferChallengePassed(80)).toBe(true);
    expect(isTransferChallengePassed(79)).toBe(false);
    expect(isTransferChallengePassed(70)).toBe(false);
    expect(isTransferChallengePassed(Number.NaN)).toBe(false);
  });

  it('a certified pass moves up one level; a fail stays at the same level', () => {
    expect(run(ch('NEAR', 90)).currentLevel).toBe('MID');
    expect(run(ch('NEAR', 50)).currentLevel).toBe('NEAR');
    expect(run(ch('NEAR', 90), ch('MID', 85)).currentLevel).toBe('FAR');
    expect(run(ch('NEAR', 90), ch('MID', 40)).currentLevel).toBe('MID');
  });

  it('never lowers the level, even after repeated failures', () => {
    const s = run(ch('NEAR', 90), ch('MID', 10), ch('MID', 0), ch('MID', 20));
    expect(s.currentLevel).toBe('MID');
    expect(s.challenges.every((c, i) => i === 0 || c.level !== 'NEAR')).toBe(true);
  });

  it('an uncertified pass does not raise the level and does not count as the level reached', () => {
    const s = run(ch('NEAR', 95, false));
    expect(s.currentLevel).toBe('NEAR');
    expect(highestLevelReached(s.challenges)).toBeNull();
    const s2 = run(ch('NEAR', 95), ch('MID', 95, false));
    expect(s2.currentLevel).toBe('MID');
    expect(highestLevelReached(s2.challenges)).toBe('NEAR');
  });

  it('closes at a certified FAR pass (challenge 3 at the earliest)', () => {
    const s = run(ch('NEAR', 90), ch('MID', 90), ch('FAR', 90));
    expect(s.closed).toBe(true);
    expect(s.closeReason).toBe('FAR_DEMONSTRATED');
    expect(highestLevelReached(s.challenges)).toBe('FAR');
  });

  it('an uncertified FAR pass does not close the attempt', () => {
    const s = run(ch('NEAR', 90), ch('MID', 90), ch('FAR', 90, false));
    expect(s.closed).toBe(false);
    expect(s.currentLevel).toBe('FAR');
  });

  it('closes at 5 challenges, never before 3', () => {
    expect(run(ch('NEAR', 0), ch('NEAR', 0)).closed).toBe(false);
    expect(run(ch('NEAR', 0), ch('NEAR', 0), ch('NEAR', 0)).closed).toBe(false);
    const five = run(ch('NEAR', 0), ch('NEAR', 0), ch('NEAR', 0), ch('NEAR', 0), ch('NEAR', 90));
    expect(five.closed).toBe(true);
    expect(five.closeReason).toBe('MAX_CHALLENGES');
    expect(() => applyTransferLadderChallenge(five, ch('MID', 90))).toThrow(/ALREADY_CLOSED/);
  });

  it('rejects a challenge at a level the ladder did not require (no fabricated levels)', () => {
    expect(() => run(ch('MID', 90))).toThrow(/LEVEL_MISMATCH/);
    expect(() => run(ch('NEAR', 50), ch('MID', 90))).toThrow(/LEVEL_MISMATCH/);
  });

  it('rejects an inconsistent passed flag', () => {
    expect(() => applyTransferLadderChallenge(initialTransferLadderState(), { level: 'NEAR', scorePercent: 50, passed: true, certified: true, taskId: 'x', contextDomain: null })).toThrow(/INCONSISTENT/);
  });

  it('NEAR-only -> LOW / in process; MID -> MEDIUM; FAR -> HIGH', () => {
    expect(transferLadderCompetency(null)).toBe('LOW');
    expect(transferLadderCompetency('NEAR')).toBe('LOW');
    expect(transferLadderCompletesApply('NEAR')).toBe(false);
    expect(transferLadderCompletesApply(null)).toBe(false);
    expect(transferLadderCompetency('MID')).toBe('MEDIUM');
    expect(transferLadderCompletesApply('MID')).toBe(true);
    expect(transferLadderCompetency('FAR')).toBe('HIGH');
    expect(transferLadderCompletesApply('FAR')).toBe(true);
  });

  it('NEAR-only attempt: NEAR passed, MID failed 4 times -> highest NEAR, closed at 5', () => {
    const s = run(ch('NEAR', 85), ch('MID', 60), ch('MID', 70), ch('MID', 79), ch('MID', 10));
    expect(s.closed).toBe(true);
    expect(highestLevelReached(s.challenges)).toBe('NEAR');
  });

  it('MID attempt: reaches MID, fails FAR until 5', () => {
    const s = run(ch('NEAR', 85), ch('MID', 82), ch('FAR', 60), ch('FAR', 50), ch('FAR', 79));
    expect(s.closed).toBe(true);
    expect(highestLevelReached(s.challenges)).toBe('MID');
  });

  it('evidence payload has exactly the contract shape', () => {
    const cs = [ch('NEAR', 90, true, 'cooking'), ch('MID', 50, true, 'sports'), ch('MID', 81, false, null)];
    const payload = buildTransferLadderEvidence(cs);
    expect(Object.keys(payload).sort()).toEqual(['challenges', 'highestLevelReached', 'version']);
    expect(payload.version).toBe('transfer-ladder-v1');
    expect(payload.highestLevelReached).toBe('NEAR');
    for (const c of payload.challenges) {
      expect(Object.keys(c).sort()).toEqual(['certified', 'contextDomain', 'level', 'passed', 'scorePercent', 'taskId']);
    }
    expect(payload.challenges[2]).toEqual({ level: 'MID', scorePercent: 81, passed: true, certified: false, taskId: cs[2].taskId, contextDomain: null });
  });

  it('isRepeatedContext compares domains and scenario labels, case/accents-insensitive', () => {
    expect(isRepeatedContext({ contextDomain: 'Cocina', context: 'x' }, [{ contextDomain: 'cocina', context: 'y' }])).toBe(true);
    expect(isRepeatedContext({ contextDomain: null, context: 'Física del fútbol' }, [{ contextDomain: 'sports', context: 'fisica del futbol' }])).toBe(true);
    expect(isRepeatedContext({ contextDomain: 'finance', context: 'Banco' }, [{ contextDomain: 'cooking', context: 'Receta' }])).toBe(false);
  });
});

/* ---------------------------------------------------------------- *
 * Service orchestration with fakes                                  *
 * ---------------------------------------------------------------- */

const STUDENT = '11111111-1111-4111-8111-111111111111';
const CONCEPT = '22222222-2222-4222-8222-222222222222';
const SUBJECT = '33333333-3333-4333-8333-333333333333';

function memoryStore(): TransferLadderStore & { rows: Map<string, TransferLadderSession>; completed: string[] } {
  const rows = new Map<string, TransferLadderSession>();
  const completed: string[] = [];
  return {
    rows,
    completed,
    async create({ id, studentId, conceptId, subjectId, language, state }) {
      rows.set(id, { id, studentId, conceptId, subjectId, language, status: 'active', isExpired: false, state: structuredClone(state) });
    },
    async findActive(studentId, conceptId) {
      for (const r of rows.values()) if (r.studentId === studentId && r.conceptId === conceptId && r.status === 'active') return structuredClone(r);
      return null;
    },
    async load(id) {
      const r = rows.get(id);
      return r ? structuredClone(r) : null;
    },
    async save(id, state, expectedRevision) {
      const r = rows.get(id);
      if (!r || r.status !== 'active' || r.state.revision !== expectedRevision) return false;
      r.state = structuredClone(state);
      return true;
    },
    async complete(id) {
      const r = rows.get(id)!;
      r.status = 'completed';
      completed.push(id);
    },
    async markExpired(id) {
      const r = rows.get(id);
      if (r && r.status === 'active') r.status = 'expired';
    },
    async conceptLabel() {
      return 'Proporcionalidad directa';
    },
  };
}

interface Fakes {
  scores: number[];
  /** per generated candidate: certify? (true = MID/FAR dims that pass validateTransferDistanceNovelty) */
  certify?: boolean[];
  domains?: string[];
  decision?: { stage: string; actionState: string };
}

function makeDeps(f: Fakes) {
  const store = memoryStore();
  let gen = 0;
  let id = 0;
  const generated: Array<{ level: string; avoid: string[] }> = [];
  const persisted: any[] = [];
  const evidence: any[] = [];
  const scores = [...f.scores];
  const deps: TransferLadderDeps = {
    store,
    canonicalEnabled: () => true,
    getDecision: async () => ({ stage: 'TRANSFER', actionState: 'EXECUTABLE', canonicalRevision: 'rev-1', ...(f.decision ?? {}) }) as any,
    generate: async (_label, _ctx, level, _lang, _ai, options) => {
      const i = gen++;
      generated.push({ level, avoid: [...options.avoidContexts] });
      const certify = f.certify ? f.certify[i] ?? true : true;
      const domain = f.domains ? f.domains[i] : `domain-${i}`;
      const dims = certify ? (level === 'NEAR' ? ['CONTEXT'] : level === 'MID' ? ['REPRESENTATION'] : ['CONSTRAINT']) : level === 'NEAR' ? [] : ['CONTEXT'];
      return {
        distance: level,
        context: `Scenario ${i}`,
        prompt: `Unique prompt number ${i} about ${domain} with ${'x'.repeat(i + 1)}`,
        noveltyDimensions: dims as any,
        transferModality: 'STRUCTURAL',
        targetConceptIds: [],
        contextDomain: domain,
        generatorPromptVersion: 'v2',
        modelAnswer: `Model answer ${i}`,
      };
    },
    recentFingerprints: async () => [],
    resolveKnownConceptIds: async () => [],
    persistTask: async (input) => {
      persisted.push(input);
    },
    grade: async () => {
      const s = scores.shift();
      if (s === undefined) throw new Error('no more scores');
      if (s < 0) return { score: 0, feedback: 'Error grading answer. Please try again.', errorType: null } as any; // fallback: no pedagogical grade
      return { score: s / 100, feedback: `fb ${s}`, errorType: s >= 80 ? null : 'CONCEPTUAL', pedagogical: {}, aiExecution: { aiExecutionId: `ai-${s}` } };
    },
    writeEvidence: async (input) => {
      evidence.push(input);
      return { oldMastery: 0, newMastery: 0, delta: 0, confidenceScore: 0, eventId: 'e' } as any;
    },
    newId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
    now: () => '2026-10-16T00:00:00.000Z',
  };
  return { deps, store, generated, persisted, evidence };
}

async function playAll(f: Fakes) {
  const h = makeDeps(f);
  const svc = createTransferLadderService(h.deps);
  let view = await svc.start({ studentId: STUDENT, conceptId: CONCEPT, subjectId: SUBJECT, language: 'es' });
  const results: any[] = [];
  while (!view.summary) {
    expect(view.pending).not.toBeNull();
    // the learner never sees the model answer while the attempt is open
    expect(JSON.stringify(view)).not.toContain('Model answer');
    const session = (await svc.load(view.sessionId))!;
    const r = await svc.answer(session, 'my answer');
    results.push(r.result);
    view = r.view;
  }
  return { ...h, view, results };
}

describe('transfer-ladder service (fakes)', () => {
  it('APPLY is independent: its evidence mode denies hints / Tutor-style assistance', () => {
    expect(TRANSFER_LADDER_EVIDENCE_MODE).toBe('INDEPENDENT');
    expect(canUseAI({ evidenceMode: TRANSFER_LADDER_EVIDENCE_MODE, feature: 'HINT' })).toBe(false);
    expect(canUseAI({ evidenceMode: TRANSFER_LADDER_EVIDENCE_MODE, feature: 'ASK_AI' })).toBe(false);
  });

  it('authorization: only TRANSFER + EXECUTABLE', () => {
    expect(isTransferLadderAuthorized({ stage: 'TRANSFER', actionState: 'EXECUTABLE' } as any)).toBe(true);
    expect(isTransferLadderAuthorized({ stage: 'TRANSFER', actionState: 'WAITING' } as any)).toBe(false);
    expect(isTransferLadderAuthorized({ stage: 'RETAIN', actionState: 'EXECUTABLE' } as any)).toBe(false);
  });

  it('refuses to start when the decision is not TRANSFER/EXECUTABLE, the gate is off, or the decision is unavailable -- zero AI calls', async () => {
    const a = makeDeps({ scores: [], decision: { stage: 'PROVE', actionState: 'EXECUTABLE' } });
    await expect(createTransferLadderService(a.deps).start({ studentId: STUDENT, conceptId: CONCEPT, subjectId: SUBJECT, language: 'es' })).rejects.toMatchObject({ code: 'TRANSFER_NOT_AUTHORIZED', status: 409 });
    expect(a.generated).toHaveLength(0);
    const b = makeDeps({ scores: [] });
    b.deps.canonicalEnabled = () => false;
    await expect(createTransferLadderService(b.deps).start({ studentId: STUDENT, conceptId: CONCEPT, subjectId: SUBJECT, language: 'es' })).rejects.toMatchObject({ code: 'TRANSFER_NOT_AUTHORIZED' });
    const c = makeDeps({ scores: [] });
    c.deps.getDecision = async () => {
      throw new CanonicalDecisionUnavailableError('x' as any);
    };
    await expect(createTransferLadderService(c.deps).start({ studentId: STUDENT, conceptId: CONCEPT, subjectId: SUBJECT, language: 'es' })).rejects.toMatchObject({ code: 'CANONICAL_DECISION_UNAVAILABLE', status: 503 });
    expect(b.generated.length + c.generated.length).toBe(0);
  });

  it('NEAR -> MID -> FAR in 3 challenges: closes early with FAR / HIGH and writes ONE evidence row', async () => {
    const r = await playAll({ scores: [90, 85, 80] });
    expect(r.generated.map((g) => g.level)).toEqual(['NEAR', 'MID', 'FAR']);
    expect(r.view.summary!.highestLevelReached).toBe('FAR');
    expect(r.view.summary!.competency).toBe('HIGH');
    expect(r.view.summary!.applyCompleted).toBe(true);
    expect(r.view.summary!.challenges.map((c) => c.modelAnswer)).toEqual(['Model answer 0', 'Model answer 1', 'Model answer 2']);
    expect(r.evidence).toHaveLength(1);
    expect(r.store.completed).toHaveLength(1);
    expect(r.persisted.map((p) => [p.transferDistance, p.noveltyValidationPassed])).toEqual([['NEAR', true], ['MID', true], ['FAR', true]]);
  });

  it('a failed challenge stays at the same level with a DIFFERENT context (avoid list carries prior contexts)', async () => {
    const r = await playAll({ scores: [50, 90, 85, 90] });
    expect(r.generated.map((g) => g.level)).toEqual(['NEAR', 'NEAR', 'MID', 'FAR']);
    expect(r.generated[1].avoid).toEqual(expect.arrayContaining(['domain-0', 'Scenario 0']));
    const domains = r.view.summary!.challenges.map((c) => c.context);
    expect(new Set(domains).size).toBe(domains.length);
    expect(r.view.summary!.highestLevelReached).toBe('FAR');
  });

  it('regenerates once when a candidate repeats a context of this attempt, and fails closed after the bounded budget', async () => {
    // candidate 1 (NEAR retry) repeats domain of candidate 0 -> regenerated (candidate 2)
    const r = await playAll({ scores: [50, 90, 85, 90], domains: ['cooking', 'cooking', 'sports', 'finance', 'music'] });
    expect(r.view.summary!.challenges.map((c) => c.level)).toEqual(['NEAR', 'NEAR', 'MID', 'FAR']);
    expect(r.persisted.map((p) => p.contextDomain)).toEqual(['cooking', 'sports', 'finance', 'music']);

    const h = makeDeps({ scores: [50], domains: ['cooking', 'cooking', 'Cooking'] });
    const svc = createTransferLadderService(h.deps);
    const v = await svc.start({ studentId: STUDENT, conceptId: CONCEPT, subjectId: SUBJECT, language: 'es' });
    const { view } = await svc.answer((await svc.load(v.sessionId))!, 'a');
    expect(view.pending).toBeNull();
    expect(view.nextUnavailable).toBe('APPLY_CHALLENGE_NOT_NOVEL_ENOUGH');
    expect(h.generated).toHaveLength(3); // 1 + bounded 2
  });

  it('an uncertified pass is served and recorded but does not raise the level', async () => {
    // candidate 0 NEAR uncertified twice (both calls), so the uncertified fallback is served
    const r = await playAll({ scores: [95, 90, 85, 80], certify: [false, false, true, true, true] });
    expect(r.view.summary!.challenges.map((c) => [c.level, c.passed, c.countsTowardLevel])).toEqual([
      ['NEAR', true, false],
      ['NEAR', true, true],
      ['MID', true, true],
      ['FAR', true, true],
    ]);
    expect(r.results[0].countsTowardLevel).toBe(false);
    expect(r.persisted[0].noveltyValidationPassed).toBe(false);
    const ladder = r.evidence[0].metadata.transferLadder;
    expect(ladder.challenges[0]).toMatchObject({ level: 'NEAR', passed: true, certified: false });
  });

  it('NEAR-only: closes at 5 with highest NEAR, LOW, not completed, no rollback semantics in the payload', async () => {
    const r = await playAll({ scores: [90, 10, 20, 30, 40] });
    expect(r.generated.map((g) => g.level)).toEqual(['NEAR', 'MID', 'MID', 'MID', 'MID']);
    expect(r.view.summary!.highestLevelReached).toBe('NEAR');
    expect(r.view.summary!.competency).toBe('LOW');
    expect(r.view.summary!.applyCompleted).toBe(false);
    expect(r.evidence[0].evidence.result).toBe('partial');
  });

  it('MID: closes at 5 with MEDIUM', async () => {
    const r = await playAll({ scores: [90, 85, 10, 79, 60] });
    expect(r.view.summary!.highestLevelReached).toBe('MID');
    expect(r.view.summary!.competency).toBe('MEDIUM');
    expect(r.evidence[0].evidence.result).toBe('correct');
  });

  it('nothing passed: highest null', async () => {
    const r = await playAll({ scores: [10, 10, 10, 10, 10] });
    expect(r.view.summary!.highestLevelReached).toBeNull();
    expect(r.evidence[0].metadata.transferLadder.highestLevelReached).toBeNull();
    expect(r.evidence[0].evidence.result).toBe('incorrect');
  });

  it('evidence write input: activityType TRANSFER, transferLadder per contract, independent, canonical attribution, idempotent identity', async () => {
    const r = await playAll({ scores: [90, 50, 85, 80] });
    const input = r.evidence[0];
    expect(input.identity).toEqual({ operationType: 'TRANSFER_LADDER', operationId: r.view.sessionId, conceptId: CONCEPT });
    expect(input.telemetry).toEqual({ activityType: 'transfer', learningMode: 'SOLO', hintsUsed: 0, aiAssistanceType: 'NONE' });
    expect(input.evidence.sourceType).toBe('SOLO_VERIFICATION');
    expect(input.metadata).toMatchObject({
      activityType: 'TRANSFER',
      evidenceMode: 'INDEPENDENT',
      assisted: false,
      pedagogicalPolicyVersion: 'studyus-canonical-v1',
      canonicalRevision: 'rev-1',
      canonicalStage: 'TRANSFER',
      canonicalActivityType: 'TRANSFER',
      itemCount: 4,
      correctCount: 3,
      sourceConceptId: CONCEPT,
    });
    expect(input.metadata.transferChallenges).toBeUndefined(); // never the legacy 3-challenge breakdown
    expect(input.metadata.transferLadder).toEqual({
      version: 'transfer-ladder-v1',
      challenges: r.persisted.map((p, i) => ({
        level: ['NEAR', 'MID', 'MID', 'FAR'][i],
        scorePercent: [90, 50, 85, 80][i],
        passed: [true, false, true, true][i],
        certified: true,
        taskId: p.id,
        contextDomain: p.contextDomain,
      })),
      highestLevelReached: 'FAR',
    });
  });

  it('a grader outage never fails a challenge: the challenge stays open (503)', async () => {
    const h = makeDeps({ scores: [-1, 90] });
    const svc = createTransferLadderService(h.deps);
    const v = await svc.start({ studentId: STUDENT, conceptId: CONCEPT, subjectId: SUBJECT, language: 'es' });
    await expect(svc.answer((await svc.load(v.sessionId))!, 'a')).rejects.toMatchObject({ code: 'APPLY_GRADING_UNAVAILABLE', status: 503 });
    const again = await svc.answer((await svc.load(v.sessionId))!, 'a');
    expect(again.result).toMatchObject({ index: 1, level: 'NEAR', passed: true });
  });

  it('resume returns the same pending challenge (no extra generation); an expired attempt yields no evidence', async () => {
    const h = makeDeps({ scores: [90] });
    const svc = createTransferLadderService(h.deps);
    const v1 = await svc.start({ studentId: STUDENT, conceptId: CONCEPT, subjectId: SUBJECT, language: 'es' });
    const v2 = await svc.start({ studentId: STUDENT, conceptId: CONCEPT, subjectId: SUBJECT, language: 'es' });
    expect(v2.sessionId).toBe(v1.sessionId);
    expect(v2.pending!.taskId).toBe(v1.pending!.taskId);
    expect(h.generated).toHaveLength(1);
    h.store.rows.get(v1.sessionId)!.isExpired = true;
    await expect(svc.answer((await svc.load(v1.sessionId))!, 'a')).rejects.toMatchObject({ code: 'APPLY_SESSION_EXPIRED', status: 410 });
    expect(h.evidence).toHaveLength(0);
  });

  it('a stale concurrent answer is refused (optimistic revision)', async () => {
    const h = makeDeps({ scores: [90, 90] });
    const svc = createTransferLadderService(h.deps);
    const v = await svc.start({ studentId: STUDENT, conceptId: CONCEPT, subjectId: SUBJECT, language: 'es' });
    const stale = (await svc.load(v.sessionId))!;
    const fresh = (await svc.load(v.sessionId))!;
    await svc.answer(fresh, 'a');
    await expect(svc.answer(stale, 'b')).rejects.toBeInstanceOf(TransferLadderError);
  });

  it('a closed attempt whose evidence write failed is finalized on resume (idempotent identity)', async () => {
    const h = makeDeps({ scores: [90, 90, 90] });
    let fail = true;
    const write = h.deps.writeEvidence;
    h.deps.writeEvidence = async (input) => {
      if (fail) {
        fail = false;
        throw new Error('db down');
      }
      return write(input);
    };
    const svc = createTransferLadderService(h.deps);
    let v = await svc.start({ studentId: STUDENT, conceptId: CONCEPT, subjectId: SUBJECT, language: 'es' });
    v = (await svc.answer((await svc.load(v.sessionId))!, 'a')).view;
    v = (await svc.answer((await svc.load(v.sessionId))!, 'a')).view;
    await expect(svc.answer((await svc.load(v.sessionId))!, 'a')).rejects.toMatchObject({ code: 'EVIDENCE_PERSISTENCE_FAILED' });
    const resumed = await svc.start({ studentId: STUDENT, conceptId: CONCEPT, subjectId: SUBJECT, language: 'es' });
    expect(resumed.summary!.highestLevelReached).toBe('FAR');
    expect(h.evidence).toHaveLength(1);
  });

  it('buildTransferLadderEvidenceInput is a pure function of the stored state', () => {
    const state: TransferLadderSessionState = {
      kind: 'TRANSFER_LADDER', version: 'transfer-ladder-v1', revision: 3, conceptLabel: 'c', learnedContext: 'l',
      attribution: { pedagogicalPolicyVersion: 'studyus-canonical-v1', canonicalRevision: 'r', canonicalStage: 'TRANSFER', canonicalActivityType: 'TRANSFER' },
      closedAt: 'x',
      challenges: [
        { index: 1, level: 'NEAR', taskId: 'a', context: 'c1', contextDomain: 'd1', prompt: 'p', modelAnswer: 'm', certified: true, certificationReason: 'CERTIFIED', servedAt: 's', graded: { scorePercent: 80, passed: true, feedback: '', errorType: null, answer: 'x', answeredAt: 't', aiExecutionId: null } },
      ],
    };
    const session: TransferLadderSession = { id: 'apply-1', studentId: STUDENT, conceptId: CONCEPT, subjectId: SUBJECT, language: 'es', status: 'active', isExpired: false, state };
    expect(buildTransferLadderEvidenceInput(session)).toEqual(buildTransferLadderEvidenceInput(structuredClone(session)));
    expect(buildTransferLadderEvidenceInput(session).metadata!.transferLadder).toEqual({
      version: 'transfer-ladder-v1',
      challenges: [{ level: 'NEAR', scorePercent: 80, passed: true, certified: true, taskId: 'a', contextDomain: 'd1' }],
      highestLevelReached: 'NEAR',
    });
  });
});
