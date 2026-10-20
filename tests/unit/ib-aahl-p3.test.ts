/**
 * IB 9/9 -> 10/10: the Track B investigation construct for aahl.p3.investigation ('show that ... hence'), Paper 3's own
 * component (IB.MATH_AA_HL.P3), EXTENDED_RESPONSE with answer marks on ONE exact value. Governed concept reused
 * (Sequences and series, GOVERNED_PILOT), certified per band, scored by the canonical contract at runtime.
 */
import { describe, expect, it } from 'vitest';
import { IB_AAHL_P3_CONSTRUCTS } from '@/lib/assessment-instance/library/ib-aahl-p3.constructs';
import { IB_AAHL_P3_ENTRIES } from '@/lib/assessment-instance/library/ib-aahl-p3.adoption';
import { LIBRARY_EXTENSION_BATCHES, PUBLICATION_APPLICABILITY, PUBLICATION_BLUEPRINTS, PUBLICATION_LIBRARY } from '@/lib/assessment-instance/library/catalogue';
import { PLANNING_BANDS, rational, sameRational } from '@/lib/assessment-instance/library/parametric';
import { certifyCell, governLibrary } from '@/lib/assessment-instance/v52/library-batch';
import { bankProjectionFor, scoringBankContentOf } from '@/lib/exam-bank/scoring-projection';
import { examItemFromApproved } from '@/lib/exam-core/items';
import { gradeExamItem } from '@/lib/exam-core/item-grading';

describe('IB Paper 3 investigation construct', () => {
  const c: any = IB_AAHL_P3_CONSTRUCTS[0];
  it('every band has parameter sets of that band only; every key holds by the independent check, is a positive integer and is no modelled misconception', () => {
    for (const band of PLANNING_BANDS) {
      const sets = c.enumerate(band);
      expect(sets.length, band).toBeGreaterThanOrEqual(30);
      for (const p of sets) {
        const k = rational(Number(c.answer(p)));
        expect(k.d === 1 && k.n > 0 && c.keyHolds(p, k) && c.bandIssues(band, p).length === 0).toBe(true);
        expect(c.keyHolds(p, rational(k.n + 1))).toBe(false);
        expect(c.misconceptionAnswers(p).some((m: any) => m.value && sameRational(m.value, k))).toBe(false);
        for (const other of PLANNING_BANDS.filter((b) => b !== band)) expect(c.bandIssues(other, p).length).toBeGreaterThan(0);
      }
    }
  });
  it('the item asks the learner to show the general sum, then the "hence" value', () => {
    expect(c.present(c.enumerate('STANDARD')[0], 'en')).toMatch(/Show that the total number of tiles in the first n rows is \(n\/2\)\(\d+ \+ \d+\(n − 1\)\)\. Hence find the number of rows that use exactly \d+ tiles in total\.$/);
  });
  it('target: P3 show that, EXTENDED_RESPONSE, the governed concept reused (no new identity)', () => {
    expect(IB_AAHL_P3_ENTRIES.map((e) => [e.targets[0].adapterId, e.targets[0].commandTerm, e.targets[0].responseFormat, e.targets[0].objectiveCode, e.core.family.primaryConcepts[0].stableId])).toEqual([
      ['IB.MATH_AA_HL.P3', 'show that', 'EXTENDED_RESPONSE', 'aahl.p3.investigation', 'math.alg.sequences-series'],
    ]);
  });
  const g = governLibrary(undefined, PUBLICATION_LIBRARY, PUBLICATION_BLUEPRINTS, PUBLICATION_APPLICABILITY);
  const batch = LIBRARY_EXTENSION_BATCHES.find((b) => b.batchId === 'TB-IB-AAHL-P3-A1')!;
  it('every cell certifies (10 per band), publishes by projection 3, and the Exam Core scores it with the canonical contract', async () => {
    for (const e of batch.entries) for (const band of PLANNING_BANDS) {
      const cell = certifyCell(e, e.targets[0], band, 10, g, batch.batchId);
      expect(cell.certified, band).toHaveLength(10);
      const i = cell.certified[0];
      expect(bankProjectionFor(i).refusal).toBeNull();
      const item = examItemFromApproved({ id: 'v', learning_objective_id: 'lo', content: scoringBankContentOf(i) })!;
      expect((await gradeExamItem(item, i.key.answers[0], 'en')).evaluation.score).toBe(i.marks);
      expect((await gradeExamItem(item, String(Number(i.key.answers[0]) + 1), 'en')).evaluation.score).toBe(0);
    }
  });
});
