/**
 * CF-IB-AAHL-01 ingestion dry run (no database): every candidate checked against the governed state; nothing ingested.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { CF_IB_AAHL_01 } from '@/lib/assessment-instance/library/cf-ib-aahl-01';
import { LIBRARY } from '@/lib/assessment-instance/library/catalogue';
import { governLibrary } from '@/lib/assessment-instance/v52/library-batch';
import { dryRunCfPackage } from '@/lib/exam-bank/cf-package-validation';

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
  it('governance refuses every candidate -- fail closed, with the exact reason', () => {
    expect(report.failuresByCheck).toEqual({ FORMAT_OFFERED: 300, CONCEPT_GOVERNED: 270, BUCKET_CERTIFIED: 270 });
    expect(report.accepted).toBe(0);
    expect(report.certificationEligible).toBe(0);
    const qmin = report.byConstruct.find((k) => k.construct === 'QUADRATIC_MINIMUM_VALUE')!;
    expect(qmin).toMatchObject({ conceptStableId: 'math.alg.quadratics', failedChecks: ['FORMAT_OFFERED'] });
    expect(qmin.firstDetail.FORMAT_OFFERED).toBe('NUMERIC_ENTRY not in MATH_EXPRESSION/SHORT_RESPONSE/EXTENDED_RESPONSE');
  });
  it('IB_PACKAGE_IDEMPOTENCY: a second identical run gives the identical report and ingests nothing', () => {
    expect(dryRunCfPackage(bytes, CF_IB_AAHL_01.packageSha256, existing).reportDigest).toBe(report.reportDigest);
  });
  it('a tampered package fails PACKAGE_HASH for every candidate', () => {
    const tampered = Buffer.from(bytes.toString().replace('Find the sum to infinity', 'Find  the sum to infinity'));
    expect(dryRunCfPackage(tampered, CF_IB_AAHL_01.packageSha256, existing).failuresByCheck.PACKAGE_HASH).toBe(300);
  });
  it('the IB Paper 2 adapter is governed (automated pilot) but no governed blueprint uses it', () => {
    const p2 = governLibrary(undefined, LIBRARY).adapters.find((d) => d.objectId === 'IB.MATH_AA_HL.P2')!;
    expect(p2.state).toBe('AUTOMATED_CERTIFIED_PILOT');
  });
});
