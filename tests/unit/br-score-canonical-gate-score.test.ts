/**
 * BR-SCORE P1-01 -- the canonical Practice / Prove gate score is the binary correctness score the learner sees.
 *
 * Browser E2E (candidate DB, QA Student A, "Ecuaciones lineales"): Practice shown 2/3 = 67% was persisted as 83 and
 * passed the latest >= 80 rule; Prove shown 6/10 = 60% was persisted as 79; Prove shown 8/10 = 80% was persisted as
 * 90. Cause: generate-and-take persisted the MEAN of per-item rubric scores (0.5 credit for an INCORRECT item).
 *
 * Covers the producer (resolveQuizConceptEvidenceScore), the per-attempt gate (canonicalAttemptGate), the adapter
 * (mapStudyUSEvidenceToPedagogicalEvidence -> real engine), the display source (resultScoreDisplay) and the results
 * headline (resolveActivityOutcome), plus source pins on the route and the results page.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  canonicalAttemptGate,
  correctnessScorePercent,
  isCorrectnessGatedActivity,
  resolveQuizConceptEvidenceScore,
  resultScoreDisplay,
} from '@/lib/quiz/canonical-gate-score';
import { evaluateCanonicalLearningState, qualifyEvidence, type RawEvidenceItem } from '@/lib/pedagogical-engine';
import { mapStudyUSEvidenceToPedagogicalEvidence } from '@/lib/pedagogical-shadow/evidence-adapter';
import type { StudyUSEvidenceRow } from '@/lib/pedagogical-shadow/types';
import { resolveActivityOutcome } from '@/lib/experience/learning-session';

const T = (minute: number) => new Date(Date.UTC(2026, 9, 17, 18, minute)).toISOString();

/** A learning_evidence row as generate-and-take wrote it on the candidate DB (stored score = rubric mean). */
const row = (over: Partial<StudyUSEvidenceRow>): StudyUSEvidenceRow => ({
  id: 'r',
  sourceType: 'PRACTICE_QUIZ',
  result: 'correct',
  scorePercent: 100,
  difficulty: 2,
  timestamp: T(0),
  hintsUsed: 0,
  aiAssistanceType: 'NONE',
  activityType: 'PRACTICE',
  itemCount: 3,
  correctCount: 3,
  ...over,
});

/** Per-item rubric scores of a quiz -> the producer's inputs. */
function bucket(scores: Array<[correct: boolean, score: number]>) {
  return { correct: scores.filter(([c]) => c).length, gradedTotal: scores.length, scoreSum: scores.reduce((a, [, s]) => a + s, 0) };
}
const ok: [boolean, number] = [true, 1];
const half: [boolean, number] = [false, 0.5];

describe('producer: resolveQuizConceptEvidenceScore persists the correctness score for gated stages', () => {
  it('Practice 2/3 with a 0.5-credit miss is 67, never >= 80 (rubric 83 preserved separately)', () => {
    const r = resolveQuizConceptEvidenceScore({ activityType: 'PRACTICE', ...bucket([half, ok, ok]) });
    expect(r).toMatchObject({ scorePercent: 67, rubricScorePercent: 83, scoreBasis: 'CORRECTNESS' });
    expect(r.scorePercent).toBeLessThan(80);
  });

  it('Prove 6/10 (candidate attempt 1: 0.5, 0.5, 0, 0.9 + 6 correct) is 60, rubric 79', () => {
    const r = resolveQuizConceptEvidenceScore({ activityType: 'SOLO_CHECK', quizMode: 'canonical_prove', ...bucket([half, half, [false, 0], [false, 0.9], ok, ok, ok, ok, ok, ok]) });
    expect(r).toMatchObject({ scorePercent: 60, rubricScorePercent: 79, scoreBasis: 'CORRECTNESS' });
  });

  it('Prove 7/10 is 70 and Prove 8/10 (candidate attempt 2) is 80, rubric 90', () => {
    expect(resolveQuizConceptEvidenceScore({ activityType: 'SOLO_CHECK', ...bucket([half, half, half, ok, ok, ok, ok, ok, ok, ok]) }).scorePercent).toBe(70);
    const eight = resolveQuizConceptEvidenceScore({ activityType: 'SOLO_CHECK', ...bucket([ok, half, half, ok, ok, ok, ok, ok, ok, ok]) });
    expect(eight).toMatchObject({ scorePercent: 80, rubricScorePercent: 90 });
  });

  it('an unanswered item stays in the denominator (8 correct of 9 answered, 10 administered = 80)', () => {
    expect(resolveQuizConceptEvidenceScore({ activityType: 'SOLO_CHECK', correct: 8, gradedTotal: 9, scoreSum: 8, administeredCount: 10 }).scorePercent).toBe(80);
    expect(resolveQuizConceptEvidenceScore({ activityType: 'SOLO_CHECK', correct: 7, gradedTotal: 9, scoreSum: 8.5, administeredCount: 10 }).scorePercent).toBe(70);
  });

  it('non-gated activities keep the CV2-07 rubric mean unchanged', () => {
    expect(resolveQuizConceptEvidenceScore({ activityType: 'CUMULATIVE_ASSESSMENT', ...bucket([half, ok, ok]) })).toMatchObject({ scorePercent: 83, scoreBasis: 'RUBRIC_MEAN' });
    expect(isCorrectnessGatedActivity('DIAGNOSTIC_CHECK')).toBe(false);
    expect(isCorrectnessGatedActivity('RETENTION_CHECK')).toBe(true);
    expect(isCorrectnessGatedActivity(null, 'canonical_prove')).toBe(true);
  });
});

describe('per-attempt gate: canonicalAttemptGate', () => {
  it('Prove: exactly 10; 6/10 = 60 FAIL, 7/10 = 70 FAIL, 8/10 = 80 PASS; 9/9 is not a Prove pass', () => {
    expect(canonicalAttemptGate('PROVE', 6, 10)).toMatchObject({ scorePercent: 60, passed: false, passPercent: 80 });
    expect(canonicalAttemptGate('PROVE', 7, 10)).toMatchObject({ scorePercent: 70, passed: false });
    expect(canonicalAttemptGate('PROVE', 8, 10)).toMatchObject({ scorePercent: 80, passed: true });
    expect(canonicalAttemptGate('PROVE', 9, 9).passed).toBe(false);
  });

  it('Practice: 2/3 = 67 FAIL, 3/3 = 100 PASS', () => {
    expect(canonicalAttemptGate('PRACTICE', 2, 3)).toMatchObject({ scorePercent: 67, passed: false });
    expect(canonicalAttemptGate('PRACTICE', 3, 3)).toMatchObject({ scorePercent: 100, passed: true });
  });
});

describe('adapter: the engine gates on the correctness score, derived from the row counts', () => {
  it('candidate rows (stored 79 / 90 for 6/10 / 8/10) map to 60 / 80; the engine fails 60 and 70 and passes 80', () => {
    const mapped = mapStudyUSEvidenceToPedagogicalEvidence([
      row({ id: 'p1', sourceType: 'SOLO_VERIFICATION', activityType: 'SOLO_CHECK', scorePercent: 79, itemCount: 10, correctCount: 6, difficulty: 3 }),
      row({ id: 'p2', sourceType: 'SOLO_VERIFICATION', activityType: 'SOLO_CHECK', scorePercent: 90, itemCount: 10, correctCount: 8, difficulty: 3, timestamp: T(5) }),
      row({ id: 'p3', sourceType: 'SOLO_VERIFICATION', activityType: 'SOLO_CHECK', scorePercent: 85, itemCount: 10, correctCount: 7, difficulty: 3, timestamp: T(9) }),
    ]);
    expect(mapped.items.map((i) => [i.id, i.scorePercent])).toEqual([['p1', 60], ['p2', 80], ['p3', 70]]);
    expect(mapped.warnings.filter((w) => w.includes('BR-SCORE P1-01'))).toHaveLength(3);
    const ctx = { targetStage: 'PROVE' as const, prerequisiteSatisfied: true };
    expect(qualifyEvidence(mapped.items[0], ctx)).toMatchObject({ result: 'DOES_NOT_QUALIFY', reasonCode: 'FAILED_ATTEMPT' });
    expect(qualifyEvidence(mapped.items[2], ctx)).toMatchObject({ result: 'DOES_NOT_QUALIFY', reasonCode: 'FAILED_ATTEMPT' });
    expect(qualifyEvidence(mapped.items[1], ctx).result).toBe('QUALIFIES');
  });

  it('candidate Practice window (stored 100, 100, 83 for 3/3, 3/3, 2/3) does NOT satisfy PRACTICE: latest is 67', () => {
    const learned: RawEvidenceItem = {
      id: 'learn', activityType: 'LEARN_CHECK', timestamp: T(0), itemCount: 6, correctCount: 5, scorePercent: 83, independent: false, difficulty: 1.5, hasCriticalMisconception: false,
    };
    const mapped = mapStudyUSEvidenceToPedagogicalEvidence([
      row({ id: 'pr1', scorePercent: 100, correctCount: 3, timestamp: T(5) }),
      row({ id: 'pr2', scorePercent: 100, correctCount: 3, timestamp: T(7) }),
      row({ id: 'pr3', scorePercent: 83, correctCount: 2, timestamp: T(9) }),
    ]);
    expect(mapped.items.map((i) => i.scorePercent)).toEqual([100, 100, 67]);
    const d = evaluateCanonicalLearningState({ conceptId: 'c', studentId: 's', now: T(20), evidence: [learned, ...mapped.items], activeCriticalMisconception: false });
    expect(d.stage).toBe('PRACTICE');
    expect(d.requirements.find((r) => r.stage === 'PRACTICE')!.status).toBe('UNSATISFIED');
  });

  it('a legacy row WITHOUT both counts is never re-scored (stored score is used as before)', () => {
    const mapped = mapStudyUSEvidenceToPedagogicalEvidence([row({ id: 'legacy', scorePercent: 83, itemCount: 3, correctCount: undefined })]);
    expect(mapped.items[0].scorePercent).toBe(83);
    expect(mapped.warnings.some((w) => w.includes('BR-SCORE'))).toBe(false);
  });
});

describe('display == gate == persisted canonical score', () => {
  it.each([
    ['PRACTICE', [half, ok, ok], 67],
    ['PROVE', [half, half, [false, 0], [false, 0.9], ok, ok, ok, ok, ok, ok], 60],
    ['PROVE', [half, half, half, ok, ok, ok, ok, ok, ok, ok], 70],
    ['PROVE', [ok, half, half, ok, ok, ok, ok, ok, ok, ok], 80],
  ] as const)('%s %j -> %d everywhere', (stage, items, expected) => {
    const b = bucket(items as unknown as Array<[boolean, number]>);
    const persisted = resolveQuizConceptEvidenceScore({ activityType: stage === 'PRACTICE' ? 'PRACTICE' : 'SOLO_CHECK', ...b, administeredCount: b.gradedTotal });
    const gate = canonicalAttemptGate(stage, b.correct, b.gradedTotal);
    const displayed = resultScoreDisplay({ canonicalGate: gate, results: { correctCount: b.correct, totalQuestions: b.gradedTotal, score: correctnessScorePercent(b.correct, b.gradedTotal) } });
    const adapted = mapStudyUSEvidenceToPedagogicalEvidence([
      row({ activityType: stage === 'PRACTICE' ? 'PRACTICE' : 'SOLO_CHECK', scorePercent: persisted.scorePercent, itemCount: b.gradedTotal, correctCount: b.correct, difficulty: 3 }),
    ]).items[0].scorePercent;
    expect(displayed.source).toBe('CANONICAL_GATE');
    expect([displayed.scorePercent, gate.scorePercent, persisted.scorePercent, adapted]).toEqual([expected, expected, expected, expected]);
  });
});

describe('results headline follows the pass rule', () => {
  const req = (status: string) => ({ stage: 'PRACTICE', requirements: [{ stage: 'PRACTICE', status }] });
  it('a 100% Practice whose window is not complete is never "Not yet"; a failed one is', () => {
    expect(resolveActivityOutcome({ kind: 'train', canonicalResultsStatus: 'OK', canonicalResults: req('UNSATISFIED'), attemptPassed: true })).toBe('RECORDED');
    expect(resolveActivityOutcome({ kind: 'train', canonicalResultsStatus: 'OK', canonicalResults: req('UNSATISFIED'), attemptPassed: false })).toBe('NOT_YET');
    expect(resolveActivityOutcome({ kind: 'train', canonicalResultsStatus: 'OK', canonicalResults: req('UNSATISFIED') })).toBe('NOT_YET');
  });
});

describe('source pins', () => {
  const root = process.cwd();
  const route = readFileSync(join(root, 'src/app/api/quizzes/generate-and-take/route.ts'), 'utf8');
  const page = readFileSync(join(root, 'src/app/dashboard/quiz/page.tsx'), 'utf8');
  it('the producer persists resolveQuizConceptEvidenceScore, never the raw rubric mean, and returns canonicalGate', () => {
    expect(route).toContain('resolveQuizConceptEvidenceScore(');
    expect(route).not.toContain('Math.round((bucket.scoreSum / bucket.total) * 100)');
    expect(route).toMatch(/rubricScorePercent: evidenceScore\.rubricScorePercent/);
    expect(route).toMatch(/\n\s+canonicalGate,\n/);
  });
  it('the results page renders the score from resultScoreDisplay and hides the legacy sufficiency panel for v1', () => {
    expect(page).toContain('const resultDisplay = resultScoreDisplay(results);');
    expect(page).not.toContain('{results.results.score}%');
    expect(page).toContain('{!isCanonicalV1 && results.proveSufficiency && (');
    expect(page).toContain('attemptPassed: results.canonicalGate ? results.canonicalGate.passed === true : null');
  });
});
