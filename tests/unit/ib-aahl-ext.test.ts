/**
 * IB 6/9 -> 9/9: the three Track B constructs for aahl.p1.extended ('show that'), aahl.p2.trigonometry and
 * aahl.p2.extended ('find'). Deterministic keys with an independent check, governed concepts reused (no new identity),
 * certified 30/30 per construct, scored by the canonical contract at runtime.
 */
import { describe, expect, it } from 'vitest';
import { IB_AAHL_EXT_CONSTRUCTS } from '@/lib/assessment-instance/library/ib-aahl-ext.constructs';
import { IB_AAHL_EXT_ENTRIES } from '@/lib/assessment-instance/library/ib-aahl-ext.adoption';
import { LIBRARY_EXTENSION_BATCHES, PUBLICATION_APPLICABILITY, PUBLICATION_BLUEPRINTS, PUBLICATION_LIBRARY } from '@/lib/assessment-instance/library/catalogue';
import { PLANNING_BANDS, rational, sameRational } from '@/lib/assessment-instance/library/parametric';
import { certifyCell, governLibrary } from '@/lib/assessment-instance/v52/library-batch';
import { scoringBankContentOf } from '@/lib/exam-bank/scoring-projection';
import { examItemFromApproved } from '@/lib/exam-core/items';
import { gradeExamItem } from '@/lib/exam-core/item-grading';

describe('IB extension constructs', () => {
  it.each(IB_AAHL_EXT_CONSTRUCTS.map((c) => [c.construct, c] as const))('%s: every band has parameter sets; every key holds by the independent check, is a positive integer and is no modelled misconception', (_n, c: any) => {
    for (const band of PLANNING_BANDS) {
      const sets = c.enumerate(band);
      expect(sets.length, band).toBeGreaterThanOrEqual(30);
      for (const p of sets) {
        const k = rational(Number(c.answer(p)));
        expect(k.d === 1 && k.n > 0 && c.keyHolds(p, k) && c.bandIssues(band, p).length === 0).toBe(true);
        expect(c.misconceptionAnswers(p).some((m: any) => m.value && sameRational(m.value, k))).toBe(false);
      }
    }
  });
  it('the "show that" item states the stationary points and asks for the minimum the learner can key', () => {
    const c = IB_AAHL_EXT_CONSTRUCTS[0];
    const p = c.enumerate('CHALLENGE')[0];
    expect(c.present(p, 'en')).toMatch(/^Consider the curve y = .+\. Show that the curve has stationary points where x = −?\d+ and x = \d+\. Hence find the y-coordinate of the local minimum point of the curve\.$/);
  });
  it('targets: P1 show that / P2 find; governed concepts reused (no new identity)', () => {
    expect(IB_AAHL_EXT_ENTRIES.map((e) => [e.targets[0].adapterId, e.targets[0].commandTerm, e.core.family.primaryConcepts[0].stableId])).toEqual([
      ['IB.MATH_AA_HL.P1', 'show that', 'math.calc.differentiation'], ['IB.MATH_AA_HL.P2', 'find', 'math.trig.ratios'], ['IB.MATH_AA_HL.P2', 'find', 'math.fun.exponential'],
    ]);
  });
  const g = governLibrary(undefined, PUBLICATION_LIBRARY, PUBLICATION_BLUEPRINTS, PUBLICATION_APPLICABILITY);
  const batch = LIBRARY_EXTENSION_BATCHES.find((b) => b.batchId === 'TB-IB-AAHL-EXT-A1')!;
  it('every cell certifies (10 per band) and the Exam Core scores the certified item with the canonical contract', async () => {
    for (const e of batch.entries) for (const band of PLANNING_BANDS) {
      const cell = certifyCell(e, e.targets[0], band, 10, g, batch.batchId);
      expect(cell.certified, `${e.core.constructFamilyId} ${band}`).toHaveLength(10);
      const i = cell.certified[0];
      const item = examItemFromApproved({ id: 'v', learning_objective_id: 'lo', content: scoringBankContentOf(i) })!;
      expect((await gradeExamItem(item, i.key.answers[0], 'en')).evaluation.score).toBe(i.marks);
      expect((await gradeExamItem(item, `\\frac{${Number(i.key.answers[0]) * 2}}{2}`, 'en')).evaluation.score).toBe(i.marks);
      expect((await gradeExamItem(item, String(Number(i.key.answers[0]) + 1), 'en')).evaluation.score).toBe(0);
    }
  });
});
