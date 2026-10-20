/**
 * CF-IB-AAHL-01-R1 convergence: the Content Factory SHORT_RESPONSE revision vs the governed Track B renders. Pure.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { LIBRARY } from '@/lib/assessment-instance/library/catalogue';
import { CF_FIRST_DELIVERY_CANDIDATE, CF_IB_AAHL_01, CF_IB_AAHL_01_R1, CF_QUADRATIC_MINIMUM_ENTRY, ENVELOPE_QUADRATIC_MINIMUM, QUADRATIC_MINIMUM_VALUE } from '@/lib/assessment-instance/library/cf-ib-aahl-01';
import { parameterSetsOf, PLANNING_BANDS } from '@/lib/assessment-instance/library/parametric';
import { certifyCell, governLibrary } from '@/lib/assessment-instance/v52/library-batch';
import { convergeR1 } from '@/lib/exam-bank/cf-r1-convergence';

const raw = readFileSync(join(process.cwd(), 'docs/exams/content-factory/CF-IB-AAHL-01-R1/CF-IB-AAHL-01-R1_CANDIDATE_PACKAGE.json'));
const R1 = JSON.parse(raw.toString('utf8'));
const g = governLibrary(undefined, [...LIBRARY, CF_QUADRATIC_MINIMUM_ENTRY]);
const certified = PLANNING_BANDS.flatMap((band) => certifyCell(CF_QUADRATIC_MINIMUM_ENTRY, CF_QUADRATIC_MINIMUM_ENTRY.targets[0], band, 10, g, CF_IB_AAHL_01.batchId).certified);
const paramsOf = (i: { seed: string; difficultyBand: string }) => {
  const rk = /@rk=(.+)$/.exec(i.seed)![1];
  return PLANNING_BANDS.flatMap((b) => parameterSetsOf(QUADRATIC_MINIMUM_VALUE, b)).find((p) => QUADRATIC_MINIMUM_VALUE.recognitionKey(p) === rk)!;
};
const result = convergeR1(R1, certified, paramsOf as never, ENVELOPE_QUADRATIC_MINIMUM);

describe('CF_IB_AAHL_01_R1_ACCEPTED', () => {
  it('the package is the pinned R1, a revision of the pinned CF-IB-AAHL-01', () => {
    expect(createHash('sha256').update(raw).digest('hex')).toBe(CF_IB_AAHL_01_R1.packageSha256);
    expect(R1).toMatchObject({ batchId: 'CF-IB-AAHL-01-R1', revisionOf: { batchId: 'CF-IB-AAHL-01', packageSha256: CF_IB_AAHL_01.packageSha256 } });
    expect(R1.candidates).toHaveLength(30);
  });
  it('all 30 R1 candidates equal the governed renders on every identity field', () => {
    expect(result.verdicts.filter((v) => v.mismatches.length > 0)).toEqual([]);
    expect({ accepted: result.accepted, matched: result.matched }).toEqual({ accepted: true, matched: 30 });
  });
  it('governance-owned deltas are named, never silent: rubric code label, seed; the envelope differs only by the command term composition requires', () => {
    for (const v of result.verdicts) {
      expect(v.deltas.map((d) => d.field).sort()).toEqual(['rubricCode', 'seed']);
      expect(v.deltas.find((d) => d.field === 'rubricCode')).toMatchObject({ r1: 'KEY', governed: expect.stringMatching(/^A[234]$/) });
    }
    expect(result.envelopeDelta).toEqual({ r1ProposalHash: '2d2c398df24bba3d4041ba172f2d1247a238846306824e5ab7167e95f010de16', governedHash: expect.any(String), explainedBy: ['commandTerms: governed ["find"], proposal []'], explained: true });
  });
  it('FIRST_IB_ITEM_MATCHES_R1: the DEV item is the R1 candidate of the same parameter set', () => {
    const first = certified.find((i) => i.seed.includes(`/${CF_FIRST_DELIVERY_CANDIDATE}`))!;
    const v = result.verdicts.find((x) => x.trackBInstanceId === first.instanceId)!;
    expect(v).toMatchObject({ recognitionId: 'tf.math.quadratic.minimum-value|4|-10|27', mismatches: [] });
    expect(CF_IB_AAHL_01_R1.firstDeliveryCandidate).toBe(v.r1CandidateId);
  });
  it('a tampered R1 candidate fails closed', () => {
    const bad = { ...R1, candidates: R1.candidates.map((c: any, k: number) => (k === 0 ? { ...c, key: { ...c.key, answers: ['999'] } } : c)) };
    const r = convergeR1(bad, certified, paramsOf as never, ENVELOPE_QUADRATIC_MINIMUM);
    expect(r.accepted).toBe(false);
    expect(r.verdicts[0].mismatches).toEqual(['key']);
  });
});
