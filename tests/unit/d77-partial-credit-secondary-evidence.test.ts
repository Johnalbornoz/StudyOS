/**
 * D77 (approved) -- PARTIAL CREDIT IS SECONDARY EVIDENCE ONLY.
 *
 *   correctness           = CORRECT / INCORRECT (the grader's verdict, never a threshold on a rubric score)
 *   canonicalGateScore    = correct answers / total (integer percent for Learning / Practice / Prove, D74)
 *   rubricScorePercent    = secondary pedagogical signal (feedback, diagnosis, analytics)
 *
 * A rubric score must NEVER turn INCORRECT into CORRECT, change Practice / Prove pass/fail, inflate the canonical
 * gate score, or change the displayed gate score. Covers the grader (composed and legacy-shaped AI replies, the
 * response-contract guard), the audit row (quiz_response_grades.is_correct), the producer, the per-attempt gate,
 * the adapter and the engine, and the display source.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const callModelMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: vi.fn().mockResolvedValue({ rows: [] }), connect: vi.fn() }, query: vi.fn().mockResolvedValue({ rows: [] }) }));
vi.mock('@/lib/ai/adapters/call-model', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/adapters/call-model')>()),
  callModel: (...a: any[]) => callModelMock(...a),
}));

import { composePedagogicalGrade, deterministicEvidence } from '@/lib/grading/pedagogical-grade';
import { gradeAnswer } from '@/services/quiz-generation.service';
import { gradeQuizAnswer } from '@/lib/quiz/grade-question';
import { toGradeRow } from '@/services/quiz-response-audit.service';
import {
  canonicalAttemptGate,
  correctnessScorePercent,
  resolveQuizConceptEvidenceScore,
  resultScoreDisplay,
} from '@/lib/quiz/canonical-gate-score';
import { evaluateCanonicalLearningState, qualifyEvidence, type RawEvidenceItem } from '@/lib/pedagogical-engine';
import { mapStudyUSEvidenceToPedagogicalEvidence } from '@/lib/pedagogical-shadow/evidence-adapter';
import type { StudyUSEvidenceRow } from '@/lib/pedagogical-shadow/types';

const T = (minute: number) => new Date(Date.UTC(2026, 9, 17, 18, minute)).toISOString();
const NUMERIC = { type: 'numeric_problem', question: 'Una máquina produce 84 piezas en 7 horas. ¿Cuántas piezas producirá en 12 horas?', correctAnswer: '144' };
const SHORT = { type: 'short_answer', question: 'Define proporción directa', correctAnswer: 'Cuando una magnitud aumenta, la otra aumenta en la misma razón' };
const aiReply = (o: Record<string, unknown>) => ({
  text: JSON.stringify({ mathematical_correctness: 'CORRECT', requirements: [], reasoning_quality: 'ADEQUATE', conceptual_error: false, misconception: null, error_type: null, did_well: '', to_fix: '', confidence: 0.9, ...o }),
  raw: {}, provider: 'openai', model: 'm',
});
const legacyReply = (o: Record<string, unknown>) => ({ text: JSON.stringify({ feedback: 'x', confidence: 0.8, errorType: 'INCOMPLETE', ...o }), raw: {}, provider: 'openai', model: 'm' });

beforeEach(() => callModelMock.mockReset());

describe('grader: a partial-credit ALMOST is never CORRECT', () => {
  it('composed grade: a MINOR_SLIP on the final value is ALMOST with partial credit < 1 -- the verdict, not the score, decides', () => {
    const g = composePedagogicalGrade(deterministicEvidence(NUMERIC, '143', 'es'), { mathematicalCorrectness: 'MINOR_SLIP', errorType: 'ARITHMETIC' });
    expect(g.finalJudgment).toBe('ALMOST');
    expect(g.score).toBeGreaterThan(0);
    expect(g.score).toBeLessThanOrEqual(0.9);
  });

  it('composed grade: an INCORRECT answer never earns more than 0.5 credit', () => {
    const g = composePedagogicalGrade(deterministicEvidence(NUMERIC, '120', 'es'), { mathematicalCorrectness: 'INCORRECT', errorType: 'PROCEDURAL' });
    expect(g.finalJudgment).toBe('INCORRECT');
    expect(g.score).toBeLessThanOrEqual(0.5);
  });

  it('AI ALMOST (structured reply, MINOR_SLIP) -> correct false, rubric score kept as secondary evidence', async () => {
    callModelMock.mockResolvedValueOnce(aiReply({ mathematical_correctness: 'MINOR_SLIP', error_type: 'ARITHMETIC', requirements: [{ id: 'final_result', met: false }] }));
    const r = await gradeAnswer({ ...NUMERIC, question: NUMERIC.question + ' Explica el planteamiento.', conceptId: 'c', difficulty: 2 } as any, 'Como 84/7 = 12 por hora, 12 por 12 da 143 piezas', 'es');
    expect(r.pedagogical?.finalJudgment).toBe('ALMOST');
    expect(r.correct).toBe(false);
    expect(r.score).toBeGreaterThan(0);
  });

  it('legacy-shaped reply {correct:false, score:0.9} stays INCORRECT with score 0.9 preserved', async () => {
    callModelMock.mockResolvedValueOnce(legacyReply({ correct: false, score: 0.9 }));
    const r = await gradeAnswer({ ...SHORT, conceptId: 'c', difficulty: 2 } as any, 'que suben las dos', 'es');
    expect(r).toMatchObject({ correct: false, score: 0.9 });
  });

  it('legacy-shaped reply with a truthy NON-boolean correct ("true") and score 0.9 is NOT correct (D77 leak fixed)', async () => {
    callModelMock.mockResolvedValueOnce(legacyReply({ correct: 'true', score: 0.9 }));
    const r = await gradeAnswer({ ...SHORT, conceptId: 'c', difficulty: 2 } as any, 'que suben las dos', 'es');
    expect(r.correct).toBe(false);
    expect(r.errorType).toBe('INCOMPLETE');
    expect(r.score).toBe(0.9);
  });

  it('response-contract guard (ANSWER_ONLY): a wrong final value with AI score 0.9 is never repaired to CORRECT', async () => {
    callModelMock.mockResolvedValueOnce(legacyReply({ correct: false, score: 0.9 }));
    const r = await gradeQuizAnswer({ ...SHORT, conceptId: 'c', difficulty: 2, answerFormat: 'text' } as any, 'que bajan las dos', 'es', 'PRACTICE', {});
    expect(r.correct).toBe(false);
    expect(r.score).toBe(0.9);
  });

  it('quiz_response_grades.is_correct follows the verdict, never the score (ALMOST 0.9 -> is_correct false)', () => {
    const row = toGradeRow(
      {
        questionIndex: 0,
        question: { ...NUMERIC, conceptId: 'c', difficulty: 2, answerFormat: 'text' } as any,
        rawAnswer: '143',
        gradeResult: { correct: false, score: 0.9, errorType: 'ARITHMETIC', pedagogical: composePedagogicalGrade(deterministicEvidence(NUMERIC, '143', 'es'), { mathematicalCorrectness: 'MINOR_SLIP' }) } as any,
      },
      'es',
    );
    expect(row).toMatchObject({ isCorrect: false, score: 0.9, finalJudgment: 'ALMOST' });
  });
});

/** Per-item [correct, rubric score] -> the producer's inputs. */
function bucket(items: Array<[boolean, number]>) {
  return { correct: items.filter(([c]) => c).length, gradedTotal: items.length, scoreSum: items.reduce((a, [, s]) => a + s, 0) };
}
const ok: [boolean, number] = [true, 1];
const miss50: [boolean, number] = [false, 0.5];

describe('gate: an INCORRECT answer with rubric 50 contributes 0 correct', () => {
  it('three INCORRECT-with-rubric-50 Practice items -> gate 0, rubric 50 (secondary only)', () => {
    const r = resolveQuizConceptEvidenceScore({ activityType: 'PRACTICE', ...bucket([miss50, miss50, miss50]) });
    expect(r).toMatchObject({ scorePercent: 0, rubricScorePercent: 50, scoreBasis: 'CORRECTNESS' });
    expect(canonicalAttemptGate('PRACTICE', 0, 3)).toMatchObject({ scorePercent: 0, passed: false });
  });

  it('the gate score is invariant to the rubric: same correct count, any partial credit -> same score and verdict', () => {
    for (const stage of ['PRACTICE', 'PROVE'] as const) {
      const total = stage === 'PRACTICE' ? 3 : 10;
      for (let correct = 0; correct <= total; correct++) {
        const scores = new Set<number>();
        const verdicts = new Set<boolean>();
        for (const credit of [0, 0.25, 0.5, 0.9]) {
          const items: Array<[boolean, number]> = Array.from({ length: total }, (_, i) => (i < correct ? ok : [false, credit]));
          const r = resolveQuizConceptEvidenceScore({ activityType: stage === 'PRACTICE' ? 'PRACTICE' : 'SOLO_CHECK', ...bucket(items) });
          scores.add(r.scorePercent);
          verdicts.add(canonicalAttemptGate(stage, bucket(items).correct, total).passed);
        }
        expect(scores.size, `${stage} ${correct}/${total}`).toBe(1);
        expect([...scores][0]).toBe(correctnessScorePercent(correct, total));
        expect(verdicts.size, `${stage} ${correct}/${total}`).toBe(1);
      }
    }
  });
});

const row = (over: Partial<StudyUSEvidenceRow>): StudyUSEvidenceRow => ({
  id: 'r', sourceType: 'PRACTICE_QUIZ', result: 'correct', scorePercent: 100, difficulty: 2, timestamp: T(0), hintsUsed: 0, aiAssistanceType: 'NONE', activityType: 'PRACTICE', itemCount: 3, correctCount: 3,
  ...over,
});

describe('P1 regressions kept (gate == engine)', () => {
  it('Practice 2/3 = 67 cannot pass latest >= 80 even when the stored score is the rubric mean 83', () => {
    const learned: RawEvidenceItem = { id: 'learn', activityType: 'LEARN_CHECK', timestamp: T(0), itemCount: 6, correctCount: 5, scorePercent: 83, independent: false, difficulty: 1.5, hasCriticalMisconception: false };
    const mapped = mapStudyUSEvidenceToPedagogicalEvidence([
      row({ id: 'a', timestamp: T(5) }),
      row({ id: 'b', timestamp: T(7) }),
      row({ id: 'c', scorePercent: 83, correctCount: 2, timestamp: T(9) }),
    ]);
    expect(mapped.items.map((i) => i.scorePercent)).toEqual([100, 100, 67]);
    const d = evaluateCanonicalLearningState({ conceptId: 'c', studentId: 's', now: T(20), evidence: [learned, ...mapped.items], activeCriticalMisconception: false });
    expect(d.requirements.find((r) => r.stage === 'PRACTICE')!.status).toBe('UNSATISFIED');
  });

  it.each([
    [6, 79, 60, false],
    [7, 85, 70, false],
    [8, 90, 80, true],
  ])('Prove %d/10 (stored rubric %d) -> %d, pass %s', (correct, stored, expected, pass) => {
    const mapped = mapStudyUSEvidenceToPedagogicalEvidence([row({ id: 'p', sourceType: 'SOLO_VERIFICATION', activityType: 'SOLO_CHECK', scorePercent: stored, itemCount: 10, correctCount: correct, difficulty: 3 })]);
    expect(mapped.items[0].scorePercent).toBe(expected);
    expect(qualifyEvidence(mapped.items[0], { targetStage: 'PROVE', prerequisiteSatisfied: true }).result === 'QUALIFIES').toBe(pass);
    expect(canonicalAttemptGate('PROVE', correct, 10)).toMatchObject({ scorePercent: expected, passed: pass });
  });
});

describe('displayed == gate == persisted', () => {
  it.each([
    ['PRACTICE', [miss50, ok, ok], 67],
    ['PRACTICE', [miss50, miss50, miss50], 0],
    ['PROVE', [miss50, miss50, [false, 0.9], [false, 0.9], ok, ok, ok, ok, ok, ok], 60],
    ['PROVE', [miss50, miss50, [false, 0.9], ok, ok, ok, ok, ok, ok, ok], 70],
    ['PROVE', [miss50, [false, 0.9], ok, ok, ok, ok, ok, ok, ok, ok], 80],
  ] as const)('%s %j -> %d on screen, at the gate and in the evidence', (stage, items, expected) => {
    const b = bucket(items as unknown as Array<[boolean, number]>);
    const persisted = resolveQuizConceptEvidenceScore({ activityType: stage === 'PRACTICE' ? 'PRACTICE' : 'SOLO_CHECK', ...b, administeredCount: b.gradedTotal });
    const gate = canonicalAttemptGate(stage, b.correct, b.gradedTotal);
    const displayed = resultScoreDisplay({ canonicalGate: gate, results: { correctCount: b.correct, totalQuestions: b.gradedTotal, score: correctnessScorePercent(b.correct, b.gradedTotal) } });
    expect([displayed.scorePercent, gate.scorePercent, persisted.scorePercent]).toEqual([expected, expected, expected]);
    expect(persisted.rubricScorePercent).toBeGreaterThanOrEqual(expected);
  });
});
