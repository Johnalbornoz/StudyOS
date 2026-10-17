/**
 * LEARN guided understanding (operator rule 2026-10-16) -- the pure bounds/state machine, the evidence payload
 * (contract 1.1, exact shape), the interaction validation, the PRACTICE carry-over and the canonical launch target.
 */
import { describe, it, expect } from 'vitest';
import {
  LEARN_MIN_INTERACTIONS,
  LEARN_MAX_INTERACTIONS,
  decideTurnOutcome,
  buildLearnGuidedEvidence,
  collectWeaknesses,
  toLearnQuestion,
  toClientInteraction,
  practiceGuidanceWithLearnWeaknesses,
  weaknessesFromEvidenceMetadata,
  type LearnInteractionRecord,
} from '@/lib/learn-guided/policy';
import { resolveCanonicalLaunch, LEARN_GUIDED_PATH } from '@/lib/pedagogical-decision/canonical-session-launch';

const Q = (difficulty = 2) => ({ id: 'q', conceptId: 'c', type: 'multiple_choice' as const, answerFormat: 'single_choice' as const, question: 'Q?', options: [{ id: 'A', text: 'a' }, { id: 'B', text: 'b' }, { id: 'C', text: 'c' }], correctAnswer: 'A', explanation: 'because', difficulty });
const rec = (correct: boolean, weakness: string | null = null, misconceptionId: string | null = null): LearnInteractionRecord => ({
  question: Q(), askedAt: '2026-10-16T00:00:00Z', answer: correct ? 'A' : 'B', answeredAt: '2026-10-16T00:00:01Z', correct, partial: false, weakness, misconceptionId,
});

describe('bounds: 4..7, no percentage gate', () => {
  it('the governed constants', () => {
    expect(LEARN_MIN_INTERACTIONS).toBe(4);
    expect(LEARN_MAX_INTERACTIONS).toBe(7);
  });
  it('a model close before 4 is ignored', () => {
    for (const n of [1, 2, 3]) {
      expect(decideTurnOutcome({ answeredCount: n, lastAnswerCorrect: true, aiCloseRecommended: true })).toEqual({ closed: false, closedBy: null, overridden: 'CLOSE_BEFORE_MIN_IGNORED' });
    }
  });
  it('between 4 and 6 the AI decides (closedBy AI)', () => {
    for (const n of [4, 5, 6]) {
      expect(decideTurnOutcome({ answeredCount: n, lastAnswerCorrect: true, aiCloseRecommended: true })).toEqual({ closed: true, closedBy: 'AI', overridden: null });
      expect(decideTurnOutcome({ answeredCount: n, lastAnswerCorrect: true, aiCloseRecommended: false }).closed).toBe(false);
    }
  });
  it('a wrong answer is always followed by another interaction (until the cap)', () => {
    expect(decideTurnOutcome({ answeredCount: 5, lastAnswerCorrect: false, aiCloseRecommended: true })).toEqual({ closed: false, closedBy: null, overridden: 'CLOSE_AFTER_WRONG_IGNORED' });
  });
  it('7 always closes (CAP), whatever the model says or the answers were', () => {
    for (const [correct, ai] of [[true, true], [true, false], [false, false], [false, true]] as const) {
      const o = decideTurnOutcome({ answeredCount: 7, lastAnswerCorrect: correct, aiCloseRecommended: ai });
      expect(o.closed).toBe(true);
      expect(o.closedBy).toBe('CAP');
    }
  });
  it('a full state-machine run: all correct + AI close at 4 -> AI/4; all wrong -> CAP/7', () => {
    const run = (answers: boolean[], aiCloseAt: (n: number) => boolean) => {
      for (let n = 1; n <= 10; n++) {
        const o = decideTurnOutcome({ answeredCount: n, lastAnswerCorrect: answers[n - 1] ?? false, aiCloseRecommended: aiCloseAt(n) });
        if (o.closed) return { n, closedBy: o.closedBy };
      }
      return null;
    };
    expect(run([true, true, true, true], () => true)).toEqual({ n: 4, closedBy: 'AI' });
    expect(run([true, false, true, false, true], (n) => n >= 3)).toEqual({ n: 5, closedBy: 'AI' });
    expect(run(Array(7).fill(false), () => true)).toEqual({ n: 7, closedBy: 'CAP' });
    expect(run(Array(7).fill(true), () => false)).toEqual({ n: 7, closedBy: 'CAP' });
  });
});

describe('evidence payload -- contract 1.1, exact shape', () => {
  it('AI close at 4: one LEARN_CHECK row with learnSession, assisted, PRACTICE mode, no score gate', () => {
    const interactions = [rec(true), rec(false, 'confunde numerador y denominador', 'm-1'), rec(true), rec(true)];
    const ev = buildLearnGuidedEvidence({ sessionId: 's-1', interactions, closedBy: 'AI', canonical: { pedagogicalPolicyVersion: 'pv', canonicalRevision: 'rev', canonicalStage: 'LEARN' } });
    expect(ev).toEqual({
      sourceType: 'LEARN_GUIDED',
      result: 'correct',
      scorePercent: 75,
      difficulty: 2,
      aiAssistanceType: 'TUTOR_GUIDANCE',
      hintsUsed: 0,
      learningMode: 'COACH',
      operationKey: 'LEARN_GUIDED:s-1',
      metadata: {
        activityType: 'LEARN_CHECK',
        evidenceMode: 'PRACTICE',
        independenceEligible: false,
        learnSession: { version: 'learn-guided-v1', interactionCount: 4, closedBy: 'AI', weaknesses: ['confunde numerador y denominador'], misconceptionIds: ['m-1'] },
        itemCount: 4,
        correctCount: 3,
        sessionId: 's-1',
        pedagogicalPolicyVersion: 'pv',
        canonicalRevision: 'rev',
        canonicalStage: 'LEARN',
        canonicalActivityType: 'LEARN_CHECK',
      },
    });
  });
  it('CAP at 7 with every answer wrong still writes a valid row (diagnostic score, never a gate); misconceptionIds omitted when none', () => {
    const ev = buildLearnGuidedEvidence({ sessionId: 's-2', interactions: Array.from({ length: 7 }, () => rec(false, 'x')), closedBy: 'CAP' });
    expect(ev.metadata.learnSession).toEqual({ version: 'learn-guided-v1', interactionCount: 7, closedBy: 'CAP', weaknesses: ['x'] });
    expect(ev.scorePercent).toBe(0);
    expect(ev.metadata).not.toHaveProperty('pedagogicalPolicyVersion');
  });
  it('an out-of-bounds row is never built', () => {
    expect(() => buildLearnGuidedEvidence({ sessionId: 's', interactions: [rec(true), rec(true), rec(true)], closedBy: 'AI' })).toThrow(/LEARN_GUIDED_BOUNDS/);
    expect(() => buildLearnGuidedEvidence({ sessionId: 's', interactions: Array.from({ length: 8 }, () => rec(true)), closedBy: 'CAP' })).toThrow(/LEARN_GUIDED_BOUNDS/);
    expect(() => buildLearnGuidedEvidence({ sessionId: 's', interactions: Array.from({ length: 5 }, () => rec(true)), closedBy: 'CAP' })).toThrow(/CAP close at 5/);
  });
  it('an unanswered pending interaction is not counted', () => {
    const interactions = [rec(true), rec(true), rec(true), rec(true), { question: Q(), askedAt: 'x' }];
    expect(buildLearnGuidedEvidence({ sessionId: 's', interactions, closedBy: 'AI' }).metadata.learnSession.interactionCount).toBe(4);
  });
});

describe('weaknesses', () => {
  it('deduplicated (case/space-insensitive), bounded, kept even when later resolved', () => {
    expect(collectWeaknesses([{ weakness: ' Confunde  A y B ' }, { weakness: 'confunde a y b' }, { weakness: null }, { weakness: 'otra' }])).toEqual(['Confunde A y B', 'otra']);
    expect(collectWeaknesses(Array.from({ length: 9 }, (_, i) => ({ weakness: `w${i}` })))).toHaveLength(5);
  });
  it('PRACTICE guidance: additive, byte-identical without weaknesses', () => {
    expect(practiceGuidanceWithLearnWeaknesses('BASE', [])).toBe('BASE');
    const g = practiceGuidanceWithLearnWeaknesses('BASE', ['confunde A y B']);
    expect(g.startsWith('BASE\n\n')).toBe(true);
    expect(g).toContain('- confunde A y B');
  });
  it('read back from the evidence metadata (object or string), only for learn-guided-v1', () => {
    const meta = { activityType: 'LEARN_CHECK', learnSession: { version: 'learn-guided-v1', weaknesses: ['w1', '', 3] } };
    expect(weaknessesFromEvidenceMetadata(meta)).toEqual(['w1']);
    expect(weaknessesFromEvidenceMetadata(JSON.stringify(meta))).toEqual(['w1']);
    expect(weaknessesFromEvidenceMetadata({ learnSession: { version: 'other', weaknesses: ['w'] } })).toEqual([]);
    expect(weaknessesFromEvidenceMetadata(null)).toEqual([]);
  });
});

describe('interactions', () => {
  it('validates each allowed type into a gradeable question', () => {
    expect(toLearnQuestion({ type: 'multiple_choice', question: 'What is it?', options: [{ id: 'A', text: '1' }, { id: 'B', text: '2' }, { id: 'C', text: '3' }, { id: 'D', text: '4' }], correctAnswer: 'B', explanation: 'e', difficulty: 9 }, 'c', 'i')).toMatchObject({ answerFormat: 'single_choice', correctAnswer: 'B', difficulty: 5 });
    expect(toLearnQuestion({ type: 'true_false', question: 'Is it so?', options: [{ id: 'true', text: 'V' }, { id: 'false', text: 'F' }], correctAnswer: 'False', explanation: 'e', difficulty: 2 }, 'c', 'i')).toMatchObject({ correctAnswer: 'false' });
    expect(toLearnQuestion({ type: 'short_answer', question: 'Name it.', options: [], correctAnswer: 'x', explanation: 'e', difficulty: 2 }, 'c', 'i')).toMatchObject({ answerFormat: 'text' });
  });
  it('rejects malformed interactions', () => {
    expect(toLearnQuestion({ type: 'matching', question: 'x?????', correctAnswer: 'a', explanation: 'e' }, 'c', 'i')).toBeNull();
    expect(toLearnQuestion({ type: 'multiple_choice', question: 'What is it?', options: [{ id: 'A', text: '1' }, { id: 'B', text: '2' }, { id: 'C', text: '3' }], correctAnswer: 'Z', explanation: 'e' }, 'c', 'i')).toBeNull();
    expect(toLearnQuestion({ type: 'multiple_choice', question: 'What is it?', options: [{ id: 'A', text: '1' }, { id: 'A', text: '2' }, { id: 'C', text: '3' }], correctAnswer: 'A', explanation: 'e' }, 'c', 'i')).toBeNull();
    expect(toLearnQuestion({ type: 'short_answer', question: 'Name it.', correctAnswer: 'x', explanation: '' }, 'c', 'i')).toBeNull();
    expect(toLearnQuestion(null, 'c', 'i')).toBeNull();
  });
  it('the client never sees the answer key or the explanation', () => {
    const view = toClientInteraction(Q(), 0);
    expect(JSON.stringify(view)).not.toContain('because');
    expect(view).not.toHaveProperty('correctAnswer');
    expect(view).not.toHaveProperty('explanation');
  });
});

describe('canonical LEARN launch -> the guided page (other stages untouched)', () => {
  const decision = (activityType: string, extra: Record<string, unknown> = {}) =>
    ({
      policyVersion: 'pv', canonicalRevision: 'rev', stage: activityType === 'LEARN_CHECK' ? 'LEARN' : 'PRACTICE', actionState: 'EXECUTABLE', intervention: null,
      waitingReason: null, nextEligibleAt: null,
      activityContract: { activityType, itemCount: activityType === 'LEARN_CHECK' ? null : { min: 2, max: 3 }, difficulty: { min: 1, max: 3, target: 2 } },
      ...extra,
    }) as any;
  it('LEARN_CHECK -> /dashboard/learn/guided with the same launch params', () => {
    const s = resolveCanonicalLaunch({ subjectId: 'sub', conceptId: 'con', decision: decision('LEARN_CHECK') });
    expect(s.launchStatus).toBe('READY');
    expect(s.launchTarget!.startsWith(`${LEARN_GUIDED_PATH}?`)).toBe(true);
    expect(s.launchTarget).toContain('conceptId=con');
    expect(s.launchTarget).toContain('subjectId=sub');
    expect(s.launchParams.mode).toBe('canonical_learn_check');
  });
  it('PRACTICE keeps its quiz launch', () => {
    const s = resolveCanonicalLaunch({ subjectId: 'sub', conceptId: 'con', decision: decision('PRACTICE') });
    expect(s.launchTarget).not.toContain(LEARN_GUIDED_PATH);
  });
});
