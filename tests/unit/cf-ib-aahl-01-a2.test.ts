/**
 * CF-IB-AAHL-01-A2: the eight further Content Factory constructs re-projected into IB SHORT_RESPONSE. The Track B copy
 * of the construct code reproduces every one of the 300 package candidates; every A2 instance is its package candidate
 * with only the response format changed; the human-certified functions bucket is not touched. Pure.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { LIBRARY, LIBRARY_EXTENSION_BATCHES, PUBLICATION_APPLICABILITY, PUBLICATION_BLUEPRINTS, PUBLICATION_LIBRARY } from '@/lib/assessment-instance/library/catalogue';
import { CF_IB_AAHL_01 } from '@/lib/assessment-instance/library/cf-ib-aahl-01';
import { CF_IB_AAHL_01_CONSTRUCTS } from '@/lib/assessment-instance/library/cf-ib-aahl-01.constructs';
import { CF_IB_AAHL_01_ADOPTED } from '@/lib/assessment-instance/library/cf-ib-aahl-01.adoption';
import { PLANNING_BANDS } from '@/lib/assessment-instance/library/parametric';
import { certifyCell, governLibrary } from '@/lib/assessment-instance/v52/library-batch';
import { revisionAcceptance } from '@/lib/exam-bank/cf-package-validation';
import { bankProjectionFor, scoringBankContentOf } from '@/lib/exam-bank/scoring-projection';
import { examItemFromApproved } from '@/lib/exam-core/items';
import { gradeExamItem } from '@/lib/exam-core/item-grading';

const raw = readFileSync(join(process.cwd(), 'docs/exams/content-factory/CF-IB-AAHL-01/CF-IB-AAHL-01_CANDIDATE_PACKAGE.json'));
const PKG = JSON.parse(raw.toString('utf8')) as { candidates: any[] };
const g = governLibrary(undefined, PUBLICATION_LIBRARY, PUBLICATION_BLUEPRINTS, PUBLICATION_APPLICABILITY);
const A2 = LIBRARY_EXTENSION_BATCHES.find((b) => b.batchId === 'CF-IB-AAHL-01-A2')!;
const certified = A2.entries.flatMap((e) => PLANNING_BANDS.flatMap((band) => certifyCell(e, e.targets[0], band, 10, g, A2.batchId).certified));
const BUCKET = (i: { bucketId: string }) => /\/(aahl\.p\d\.[a-z]+)#/.exec(i.bucketId)![1];

describe('CF-IB-AAHL-01-A2', () => {
  it('the Track B copy of the CF construct code reproduces all 300 pinned package candidates (prompt and key)', () => {
    expect(createHash('sha256').update(raw).digest('hex')).toBe(CF_IB_AAHL_01.packageSha256);
    const mismatches = PKG.candidates.filter((c) => { const k = CF_IB_AAHL_01_CONSTRUCTS.find((x) => x.construct === c.lineage.construct)! as any; return k.present(c.parameterSet, 'en') !== c.learner.prompt || k.answer(c.parameterSet) !== c.key.answers[0]; });
    expect({ candidates: PKG.candidates.length, mismatches: mismatches.length }).toEqual({ candidates: 300, mismatches: 0 });
  });
  it('eight constructs, every core and envelope automated-pilot governed; the inverse-function construct is not adopted', () => {
    expect(CF_IB_AAHL_01_ADOPTED).toHaveLength(8);
    expect(A2.entries).toBe(CF_IB_AAHL_01_ADOPTED);
    expect(CF_IB_AAHL_01_ADOPTED.some((e) => e.construct.construct === 'INVERSE_FUNCTION_VALUE')).toBe(false);
    for (const e of CF_IB_AAHL_01_ADOPTED) {
      expect(g.cores.find((d) => d.objectId === e.core.constructFamilyId)!.state, e.core.constructFamilyId).toBe('AUTOMATED_CERTIFIED_PILOT');
      expect(g.envelopes.find((d) => d.objectId === e.envelope.rendererVersion)!.state, e.envelope.rendererVersion).toBe('AUTOMATED_CERTIFIED_PILOT');
    }
    expect(LIBRARY).toHaveLength(10);
  });
  it('240 certified instances, each EXACTLY its package candidate except the response format (SHORT_RESPONSE)', () => {
    expect(certified).toHaveLength(240);
    for (const i of certified) {
      const cand = PKG.candidates.find((c) => i.seed.includes(c.candidateId))!;
      expect(revisionAcceptance(cand, i).differences, i.seed).toEqual(['format']);
      expect({ format: i.format, state: i.certificationState, bucket: i.bucketId, concept: i.conceptId }).toEqual({ format: 'SHORT_RESPONSE', state: 'AUTOMATED_CERTIFIED_PILOT', bucket: cand.lineage.bucketId, concept: expect.any(String) });
      expect(bankProjectionFor(i)).toEqual({ version: 'exam-bank-projection-3', refusal: null });
    }
  });
  it('buckets: P1 algebra 60, P1 calculus 120, P2 statistics 60; nothing in the human-certified functions bucket', () => {
    const by: Record<string, number> = {};
    for (const i of certified) by[BUCKET(i)] = (by[BUCKET(i)] ?? 0) + 1;
    expect(by).toEqual({ 'aahl.p1.algebra': 60, 'aahl.p1.calculus': 120, 'aahl.p2.statistics': 60 });
    expect(new Set(certified.filter((i) => BUCKET(i) === 'aahl.p2.statistics').map((i) => i.adapterId))).toEqual(new Set(['IB.MATH_AA_HL.P2']));
  });
  it('the Exam Core scores a sample of every construct with the canonical contract: key full marks, misconceptions 0', async () => {
    for (const e of CF_IB_AAHL_01_ADOPTED) {
      const i = certified.find((x) => x.coreId === e.core.constructFamilyId && x.difficultyBand === 'HIGH')!;
      const cand = PKG.candidates.find((c) => i.seed.includes(c.candidateId))!;
      const item = examItemFromApproved({ id: 'v', learning_objective_id: 'lo', content: scoringBankContentOf(i) })!;
      const key = await gradeExamItem(item, i.key.answers[0], 'en');
      expect({ core: i.coreId, score: key.evaluation.score, max: key.maxMarks }).toEqual({ core: i.coreId, score: i.marks, max: i.marks });
      for (const m of cand.misconceptions as { value: string }[]) {
        if (m.value === i.key.answers[0]) continue;
        expect((await gradeExamItem(item, m.value, 'en')).evaluation.score, `${i.coreId} ${m.value}`).toBe(0);
      }
    }
  });
});
