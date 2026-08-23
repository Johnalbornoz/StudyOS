import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ db: { query: vi.fn() } }));

import { buildBestNextAction, factsForItem, type TodayItem } from '@/services/today-plan.service';

function item(overrides: Partial<TodayItem>): TodayItem {
  return {
    conceptId: 'c1',
    subjectId: 'subj1',
    subjectName: 'Physics',
    label: 'Centripetal Force',
    masteryScore: 60,
    reason: 'low_mastery',
    urgencyTier: 'critical',
    ...overrides,
  } as TodayItem;
}

describe('factsForItem (reusable Why This? layer -- Gap 5)', () => {
  it('produces an examSoon fact for exam_soon', () => {
    const facts = factsForItem(item({ reason: 'exam_soon', daysUntilExam: 3 }));
    expect(facts).toEqual([{ kind: 'examSoon', daysUntilExam: 3 }]);
  });

  it('produces a learningDebt fact for learning_debt (severe debt case)', () => {
    const facts = factsForItem(item({ reason: 'learning_debt', debtSeverity: 5 }));
    expect(facts).toEqual([{ kind: 'learningDebt', debtSeverity: 5 }]);
  });

  it('produces a forgettingRisk fact for forgetting_risk (high forgetting risk case)', () => {
    const facts = factsForItem(item({ reason: 'forgetting_risk', forgettingRisk: 85, daysSincePractice: 40 }));
    expect(facts).toEqual([{ kind: 'forgettingRisk', forgettingRisk: 85, daysSincePractice: 40 }]);
  });

  it('produces an independenceGap fact for independence_gap', () => {
    const facts = factsForItem(item({ reason: 'independence_gap', unassistedAccuracy: 40, masteryScore: 70 }));
    expect(facts).toEqual([{ kind: 'independenceGap', unassistedAccuracy: 40, masteryScore: 70 }]);
  });

  it('produces a lowMastery fact for low_mastery', () => {
    const facts = factsForItem(item({ reason: 'low_mastery', masteryScore: 22 }));
    expect(facts).toEqual([{ kind: 'lowMastery', masteryScore: 22 }]);
  });

  it('never invents a fact for a reason that was not the trigger (no exam fact on a non-exam item)', () => {
    const facts = factsForItem(item({ reason: 'low_mastery', masteryScore: 22, daysUntilExam: 1 }));
    expect(facts).toEqual([{ kind: 'lowMastery', masteryScore: 22 }]);
  });
});

describe('buildBestNextAction (Next Best Action v1)', () => {
  it('is null with no items anywhere (no upcoming exam, no debt, nothing at all)', () => {
    expect(buildBestNextAction([], [], [])).toBeNull();
  });

  it('picks the first critical-tier item over anything in thisWeek/canWait (tier strictly wins)', () => {
    const critical = item({ conceptId: 'critical-1', reason: 'exam_soon', daysUntilExam: 1 });
    const thisWeek = item({ conceptId: 'week-1', reason: 'learning_debt', debtSeverity: 5 });
    const result = buildBestNextAction([critical], [thisWeek], []);
    expect(result?.item.conceptId).toBe('critical-1');
  });

  it('falls back to thisWeek when critical is empty', () => {
    const thisWeek = item({ conceptId: 'week-1', reason: 'forgetting_risk', forgettingRisk: 70 });
    const result = buildBestNextAction([], [thisWeek], [item({ conceptId: 'wait-1' })]);
    expect(result?.item.conceptId).toBe('week-1');
  });

  it('falls back to canWait only when both critical and thisWeek are empty (no exam / low urgency case)', () => {
    const canWait = item({ conceptId: 'wait-1', reason: 'low_mastery', masteryScore: 55 });
    const result = buildBestNextAction([], [], [canWait]);
    expect(result?.item.conceptId).toBe('wait-1');
  });

  it('breaks ties within a tier by taking the first item deterministically (stable, not random)', () => {
    const a = item({ conceptId: 'a', reason: 'low_mastery', masteryScore: 40 });
    const b = item({ conceptId: 'b', reason: 'low_mastery', masteryScore: 40 });
    const result = buildBestNextAction([a, b], [], []);
    expect(result?.item.conceptId).toBe('a');
  });

  it('carries the matching facts for whichever item wins (competing signals resolved by tier, facts reflect the winner only)', () => {
    const critical = item({ conceptId: 'critical-1', reason: 'independence_gap', unassistedAccuracy: 45, masteryScore: 75 });
    const result = buildBestNextAction([critical], [item({ conceptId: 'week-1', reason: 'exam_soon', daysUntilExam: 2 })], []);
    expect(result?.facts).toEqual([{ kind: 'independenceGap', unassistedAccuracy: 45, masteryScore: 75 }]);
  });
});
