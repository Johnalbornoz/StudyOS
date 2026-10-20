/**
 * CF-IB-AAHL-01 ingestion dry run (no database): every candidate checked against the governed state; nothing ingested.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { CF_IB_AAHL_01 } from '@/lib/assessment-instance/library/cf-ib-aahl-01';
import { LIBRARY } from '@/lib/assessment-instance/library/catalogue';
import { governLibrary } from '@/lib/assessment-instance/v52/library-batch';
import { dryRunCfPackage, revisionAcceptance } from '@/lib/exam-bank/cf-package-validation';
import { CF_QUADRATIC_MINIMUM_ENTRY } from '@/lib/assessment-instance/library/cf-ib-aahl-01';
import { certifyCell } from '@/lib/assessment-instance/v52/library-batch';

const root = process.cwd();
const bytes = readFileSync(join(root, 'docs/exams/content-factory/CF-IB-AAHL-01/CF-IB-AAHL-01_CANDIDATE_PACKAGE.json'));
const supply = JSON.parse(readFileSync(join(root, 'docs/exams/question-factory/v52/QF52_CERTIFIED_SUPPLY.json'), 'utf8')) as { rows: any[] };
const existing = new Set(supply.rows.map((r) => `${r.content.lineage.adapterId}|${r.content.question}`));
const report = dryRunCfPackage(bytes, CF_IB_AAHL_01.packageSha256, existing);

describe('IB_PACKAGE_DRY_RUN', () => {
  it('validates the pinned package: 10 constructs, 300 candidates', () => {
    expect(report).toMatchObject({ packageSha256: CF_IB_AAHL_01.packageSha256, constructs: 10, candidates: 300 });
  });
  it('content checks pass for every candidate: identity, scoring (both evaluators agree), lineage, rights, duplicates, projection 3', () => {
    for (const check of ['PACKAGE_HASH', 'IDENTITY', 'SCORING_POLICY', 'LINEAGE_COMPLETE', 'RIGHTS_PROVENANCE', 'NOT_A_DUPLICATE', 'PROJECTION'] as const) expect(report.failuresByCheck[check], check).toBeUndefined();
  });
  it('governance: concepts resolve through the governed correspondence; only the format (all 300) and one bucket refuse -- fail closed', () => {
    // the package declares Content Factory ids (math.ib.*); Track B owns concept identity and resolves each core
    // through its governed correspondence -- the declared id is reported, never adopted
    expect(report.failuresByCheck).toEqual({ FORMAT_OFFERED: 300, BUCKET_CERTIFIED: 30 });
    expect(report.accepted).toBe(0);
    expect(report.certificationEligible).toBe(0);
    const qmin = report.byConstruct.find((k) => k.construct === 'QUADRATIC_MINIMUM_VALUE')!;
    expect(qmin).toMatchObject({ conceptStableId: 'math.alg.quadratics', declaredConcept: 'math.alg.quadratics', failedChecks: ['FORMAT_OFFERED'] });
    expect(qmin.firstDetail.FORMAT_OFFERED).toBe('NUMERIC_ENTRY not in MATH_EXPRESSION/SHORT_RESPONSE/EXTENDED_RESPONSE');
    // the inverse-function construct: the human-certified functions bucket (D02) places only quadratics -- not re-placed by automation
    const inv = report.byConstruct.find((k) => k.construct === 'INVERSE_FUNCTION_VALUE')!;
    expect(inv).toMatchObject({ conceptStableId: 'math.fun.rational-functions-inverses', declaredConcept: 'math.ib.rational-functions-and-inverses', failedChecks: ['BUCKET_CERTIFIED', 'FORMAT_OFFERED'] });
  });
  it('IB_PACKAGE_IDEMPOTENCY: a second identical run gives the identical report and ingests nothing', () => {
    expect(dryRunCfPackage(bytes, CF_IB_AAHL_01.packageSha256, existing).reportDigest).toBe(report.reportDigest);
  });
  it('a tampered package fails PACKAGE_HASH for every candidate', () => {
    const tampered = Buffer.from(bytes.toString().replace('Find the sum to infinity', 'Find  the sum to infinity'));
    expect(dryRunCfPackage(tampered, CF_IB_AAHL_01.packageSha256, existing).failuresByCheck.PACKAGE_HASH).toBe(300);
  });
  it('the IB Paper 2 adapter is governed (automated pilot)', () => {
    const p2 = governLibrary(undefined, LIBRARY).adapters.find((d) => d.objectId === 'IB.MATH_AA_HL.P2')!;
    expect(p2.state).toBe('AUTOMATED_CERTIFIED_PILOT');
  });
});

describe('package status and the SHORT_RESPONSE revision acceptance', () => {
  it('the 300-candidate package is CONTENT_VALID / GOVERNANCE_PENDING / FORMAT_REPROJECTION_REQUIRED', () => {
    expect(report.status).toEqual({ content: 'CONTENT_VALID', governance: 'GOVERNANCE_PENDING', format: 'FORMAT_REPROJECTION_REQUIRED' });
  });
  it('a revised candidate is accepted only if it equals the governed render; any difference is named', () => {
    const pkg = JSON.parse(bytes.toString()) as { candidates: any[] };
    const cell = certifyCell(CF_QUADRATIC_MINIMUM_ENTRY, CF_QUADRATIC_MINIMUM_ENTRY.targets[0], 'CHALLENGE', 10, governLibrary(undefined, [...LIBRARY, CF_QUADRATIC_MINIMUM_ENTRY]), CF_IB_AAHL_01.batchId);
    for (const i of cell.certified) {
      const original = pkg.candidates.find((c) => i.seed.includes(c.candidateId));
      // the delivered NUMERIC_ENTRY candidate differs only by its format and its rubric code shape
      expect(revisionAcceptance(original, i).differences).toEqual(['format']);
      // the expected revision: same content, IB SHORT_RESPONSE with answer marks
      const revised = { ...original, learner: { ...original.learner, itemType: 'SHORT_RESPONSE' }, rubric: [{ code: `A${original.learner.marks}`, kind: 'ANSWER', marks: original.learner.marks, criterion: original.key.answers[0] }] };
      expect(revisionAcceptance(revised, i)).toEqual({ accepted: true, differences: [] });
      expect(revisionAcceptance({ ...revised, key: { answers: ['1'] } }, i)).toEqual({ accepted: false, differences: ['key'] });
    }
  });
});
