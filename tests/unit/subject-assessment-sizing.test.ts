import { describe, expect, it } from 'vitest';
import { mockQuestionCount, planSubjectMock, planSubjectTest, planGroupAssessment, distributeUniform, subjectAssessmentScorePercent, subjectAssessmentPassed } from '@/lib/subject-assessment/sizing';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `c${i + 1}`);
const sum = (d: Record<string, number>) => Object.values(d).reduce((a, b) => a + b, 0);

describe('subject mock: the operator count table, uniform and representative', () => {
  it('1 -> 5; 2-5 cap 10; 6-10 cap 20; 11-15 cap 30; all subject cap 50', () => {
    expect(mockQuestionCount(1, false).count).toBe(5);
    expect([2, 3, 4, 5].map((n) => mockQuestionCount(n, false).count)).toEqual([4, 6, 8, 10]);
    expect([6, 8, 10].map((n) => mockQuestionCount(n, false).count)).toEqual([12, 16, 20]);
    expect([11, 15].map((n) => mockQuestionCount(n, false).count)).toEqual([22, 30]);
    expect(mockQuestionCount(20, true)).toEqual({ count: 40, band: 'ALL_SUBJECT' });
    expect(mockQuestionCount(40, true)).toEqual({ count: 50, band: 'ALL_SUBJECT' });
    expect(mockQuestionCount(20, false).band).toBe('OVER_15_PARTIAL');
  });
  it('the distribution is uniform and covers every concept while the cap allows', () => {
    const p = planSubjectMock(ids(7), false);
    expect(p.questionCount).toBe(14);
    expect(Object.values(p.distribution)).toEqual([2, 2, 2, 2, 2, 2, 2]);
    const all = planSubjectMock(ids(30), true);
    expect(sum(all.distribution)).toBe(50);
    expect(Object.keys(all.distribution)).toHaveLength(30);
    expect(Math.max(...Object.values(all.distribution)) - Math.min(...Object.values(all.distribution))).toBeLessThanOrEqual(1);
    expect(planSubjectMock(ids(1), false).distribution).toEqual({ c1: 5 });
  });
});

describe('APPROVED 2026-10-17: mock with 16+ manually selected concepts (OVER_15_PARTIAL) = ~2/concept, max 50', () => {
  for (const [n, count] of [[18, 36], [22, 44], [30, 50]] as const) {
    it(`${n} concepts -> ${count} questions, every concept at least once, uniform`, () => {
      const p = planSubjectMock(ids(n), false);
      expect(p.band).toBe('OVER_15_PARTIAL');
      expect(p.rule).toBe('MOCK_OVER_15_PARTIAL');
      expect(p.questionCount).toBe(count);
      expect(sum(p.distribution)).toBe(count);
      expect(Object.keys(p.distribution)).toEqual(ids(n));
      expect(Math.min(...Object.values(p.distribution))).toBeGreaterThanOrEqual(1);
      expect(Math.max(...Object.values(p.distribution)) - Math.min(...Object.values(p.distribution))).toBeLessThanOrEqual(1);
      expect(p.uncovered).toEqual([]);
    });
  }
  it('30 concepts: each gets 1 first, then the 20 remaining follow the uniform coverage in subject order', () => {
    const p = planSubjectMock(ids(30), false);
    expect(ids(30).map((c) => p.distribution[c])).toEqual([...Array(20).fill(2), ...Array(10).fill(1)]);
  });
  it('the >= 1 guarantee holds for every selection up to 50 concepts (partial or whole subject)', () => {
    for (let n = 1; n <= 50; n++) for (const all of [false, true]) {
      const p = planSubjectMock(ids(n), all);
      expect(Object.keys(p.distribution)).toHaveLength(n);
      expect(Math.min(...Object.values(p.distribution))).toBeGreaterThanOrEqual(1);
      expect(sum(p.distribution)).toBe(p.questionCount);
      expect(p.questionCount).toBeLessThanOrEqual(50);
    }
  });
  it('beyond 50 concepts the existing behaviour stays: 50 covered once, the rest uncovered (refused by the caller)', () => {
    const p = planSubjectMock(ids(55), false);
    expect(p.questionCount).toBe(50);
    expect(Object.values(p.distribution).every((x) => x === 1)).toBe(true);
    expect(p.uncovered).toEqual(['c51', 'c52', 'c53', 'c54', 'c55']);
  });
});

describe('subject test: adaptive, every concept at least once, min 4, max 50', () => {
  it('one per concept, a second for concepts with need; never fewer than 4', () => {
    const p = planSubjectTest([{ conceptId: 'a', needsReinforcement: true }, { conceptId: 'b', needsReinforcement: false }, { conceptId: 'c', needsReinforcement: false }]);
    expect(p.distribution).toEqual({ a: 2, b: 1, c: 1 });
    expect(p.questionCount).toBe(4);
    const one = planSubjectTest([{ conceptId: 'a', needsReinforcement: false }]);
    expect(one.questionCount).toBe(4);
  });
  it('max 50; more than 50 concepts cannot all be covered (refused by the caller)', () => {
    const big = planSubjectTest(ids(40).map((conceptId) => ({ conceptId, needsReinforcement: true })));
    expect(big.questionCount).toBe(50);
    expect(Object.keys(big.distribution)).toHaveLength(40);
    expect(planSubjectTest(ids(51).map((conceptId) => ({ conceptId, needsReinforcement: false }))).uncovered).toHaveLength(1);
  });
  it('teacher group plans ignore per-student Knowledge State', () => {
    expect(planGroupAssessment('TEST', ids(3), false).distribution).toEqual({ c1: 2, c2: 1, c3: 1 });
    expect(planGroupAssessment('MOCK', ids(3), false).questionCount).toBe(6);
  });
});

describe('score and pass', () => {
  it('unanswered stays in the denominator; 80 inclusive', () => {
    expect(subjectAssessmentScorePercent(14, 20)).toBe(70);
    expect(subjectAssessmentPassed(80)).toBe(true);
    expect(subjectAssessmentPassed(79.9)).toBe(false);
    expect(distributeUniform(['a', 'b'], 5)).toEqual({ a: 3, b: 2 });
  });
});
