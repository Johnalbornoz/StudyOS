import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ db: { query: vi.fn() } }));

import { nbaPriority, type TodayItem } from '@/services/today-plan.service';

function item(overrides: Partial<TodayItem>): TodayItem {
  return {
    conceptId: 'c1',
    subjectId: 's1',
    subjectName: 'Physics HL',
    label: 'Concept',
    masteryScore: 80,
    reason: 'low_mastery',
    urgencyTier: 'can_wait',
    ...overrides,
  };
}

describe('nbaPriority (NBA v2)', () => {
  it('prerequisite gap beats the symptom it causes (low mastery on the target concept)', () => {
    const prerequisiteGap = item({ reason: 'prerequisite_gap', unlockValue: 20 });
    const symptomLowMastery = item({ reason: 'low_mastery', masteryScore: 10 });
    expect(nbaPriority(prerequisiteGap)).toBeGreaterThan(nbaPriority(symptomLowMastery));
  });

  it('prerequisite gap beats a plain learning debt on a different concept', () => {
    const prerequisiteGap = item({ reason: 'prerequisite_gap', unlockValue: 0 });
    const learningDebt = item({ reason: 'learning_debt', debtSeverity: 5 });
    expect(nbaPriority(prerequisiteGap)).toBeGreaterThan(nbaPriority(learningDebt));
  });

  it('active remediation outranks a confirmed prerequisite gap and a non-critical exam', () => {
    const activeRemediation = item({ reason: 'active_remediation' });
    const prerequisiteGap = item({ reason: 'prerequisite_gap', unlockValue: 500 });
    const examSoon = item({ reason: 'exam_soon', daysUntilExam: 5 });
    expect(nbaPriority(activeRemediation)).toBeGreaterThan(nbaPriority(prerequisiteGap));
    expect(nbaPriority(activeRemediation)).toBeGreaterThan(nbaPriority(examSoon));
  });

  it('an abandoned remediation (started weeks ago, never resumed) scores exactly the same 2000 as one started today -- Phase 2 has no time-based decay, by design', () => {
    // TodayItem carries no "started/opened at" field for active_remediation,
    // so there is nothing for nbaPriority to read that would let an old,
    // abandoned repair silently rank differently from a fresh one -- this
    // pins that invariant explicitly rather than leaving it implicit.
    const fresh = item({ reason: 'active_remediation', remediationPathId: 'path-fresh' });
    const abandoned = item({ reason: 'active_remediation', remediationPathId: 'path-abandoned' });
    expect(nbaPriority(fresh)).toBe(2000);
    expect(nbaPriority(abandoned)).toBe(2000);
    expect(nbaPriority(fresh)).toBe(nbaPriority(abandoned));
  });

  it('an imminent exam (<=2 days) is the one thing that outranks active remediation', () => {
    const activeRemediation = item({ reason: 'active_remediation' });
    const imminentExam = item({ reason: 'exam_soon', daysUntilExam: 1 });
    expect(nbaPriority(imminentExam)).toBeGreaterThan(nbaPriority(activeRemediation));
  });

  it('a non-critical exam does not outrank active remediation', () => {
    const activeRemediation = item({ reason: 'active_remediation' });
    const examInAWeek = item({ reason: 'exam_soon', daysUntilExam: 6 });
    expect(nbaPriority(activeRemediation)).toBeGreaterThan(nbaPriority(examInAWeek));
  });

  it('a bigger Learning Unlock Value ranks a prerequisite gap higher than a smaller one', () => {
    const bigUnlock = item({ reason: 'prerequisite_gap', unlockValue: 300 });
    const smallUnlock = item({ reason: 'prerequisite_gap', unlockValue: 5 });
    expect(nbaPriority(bigUnlock)).toBeGreaterThan(nbaPriority(smallUnlock));
  });

  it('recurring misconceptions rank by occurrence count', () => {
    const seenOften = item({ reason: 'recurring_misconception', occurrenceCount: 6 });
    const seenTwice = item({ reason: 'recurring_misconception', occurrenceCount: 2 });
    expect(nbaPriority(seenOften)).toBeGreaterThan(nbaPriority(seenTwice));
  });

  it('diagnosis required ranks above forgetting risk and independence gap but below learning debt', () => {
    const diagnosisRequired = item({ reason: 'diagnosis_required' });
    const forgettingRisk = item({ reason: 'forgetting_risk', forgettingRisk: 90 });
    const independenceGap = item({ reason: 'independence_gap', unassistedAccuracy: 10 });
    const learningDebt = item({ reason: 'learning_debt', debtSeverity: 1 });
    expect(nbaPriority(diagnosisRequired)).toBeGreaterThan(nbaPriority(forgettingRisk));
    expect(nbaPriority(diagnosisRequired)).toBeGreaterThan(nbaPriority(independenceGap));
    expect(nbaPriority(learningDebt)).toBeGreaterThan(nbaPriority(diagnosisRequired));
  });

  it('tie determinism: two items with identical scores keep their original relative order after a stable sort', () => {
    const a = item({ conceptId: 'first', reason: 'low_mastery', masteryScore: 40 });
    const b = item({ conceptId: 'second', reason: 'low_mastery', masteryScore: 40 });
    const list = [a, b];
    list.sort((x, y) => nbaPriority(y) - nbaPriority(x));
    expect(list.map((i) => i.conceptId)).toEqual(['first', 'second']);
  });

  it('lower mastery ranks higher within the plain low_mastery reason', () => {
    const worse = item({ reason: 'low_mastery', masteryScore: 20 });
    const better = item({ reason: 'low_mastery', masteryScore: 55 });
    expect(nbaPriority(worse)).toBeGreaterThan(nbaPriority(better));
  });
});
