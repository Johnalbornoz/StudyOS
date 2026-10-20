/**
 * TRACK B -- CF-IB-AAHL-01 ingestion DRY RUN + IB pilot readiness. NO DATABASE: nothing is read from or written to any
 * database; the package is validated against the governed state held in code. Run twice; the two reports must be
 * byte-identical (an identical second ingestion creates 0 identities / rows).
 *
 *   npx tsx scripts/operations/exam-bank/cf-package-dry-run.ts [--out docs/audits/exam-bank/evidence/CF_IB_AAHL_01_DRY_RUN.json]
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

async function main(): Promise<number> {
  const at = process.argv.indexOf('--out'); const out = at > 0 ? process.argv[at + 1] : null;
  const { dryRunCfPackage } = await import('@/lib/exam-bank/cf-package-validation');
  const { CF_IB_AAHL_01 } = await import('@/lib/assessment-instance/library/cf-ib-aahl-01');
  const { evaluateExamBankReadiness, MODE_REQUIREMENTS } = await import('@/lib/exam-bank/readiness/bank-readiness');
  const { RUNTIME_CAPABILITIES } = await import('@/lib/exam-bank/readiness/bank-readiness-adapter');
  const root = process.cwd();
  const bytes = readFileSync(join(root, 'docs/exams/content-factory/CF-IB-AAHL-01/CF-IB-AAHL-01_CANDIDATE_PACKAGE.json'));
  const supply = JSON.parse(readFileSync(join(root, 'docs/exams/question-factory/v52/QF52_CERTIFIED_SUPPLY.json'), 'utf8')) as { rows: any[] };
  const existing = new Set(supply.rows.map((r) => `${r.content.lineage.adapterId}|${r.content.question}`));
  const first = dryRunCfPackage(bytes, CF_IB_AAHL_01.packageSha256, existing);
  const second = dryRunCfPackage(bytes, CF_IB_AAHL_01.packageSha256, existing);
  const idempotent = first.reportDigest === second.reportDigest;

  // IB pilot readiness: the 9 governed pilot positions, and the four states of supply
  const pkg = JSON.parse(bytes.toString()) as { candidates: any[] };
  const ib = supply.rows.filter((r) => r.content.lineage.systemId === 'IB');
  const BUCKETS = [['aahl.p1.algebra', 1], ['aahl.p1.functions', 1], ['aahl.p1.calculus', 2], ['aahl.p1.extended', 1], ['aahl.p2.statistics', 2], ['aahl.p2.trigonometry', 1], ['aahl.p2.extended', 1]] as const;
  const bucketOf = (bucketId: string) => /\/(aahl\.p\d\.[a-z]+)#/.exec(bucketId)?.[1] ?? bucketId;
  const rows = [
    ...ib.map((r) => ({ itemId: r.itemInstanceId, contentDigest: r.content.lineage.digest, bucketIds: [bucketOf(r.content.lineage.bucketId)], certification: 'AUTOMATED_CERTIFIED_PILOT' as const, lineageComplete: true, rights: 'CLEARED' as const, responseFormat: 'SHORT_RESPONSE_MARKED_ON_WORKING', stimulusKind: null, stimulusId: null, retired: false, difficulty: null })),
    ...pkg.candidates.map((c) => ({ itemId: c.candidateId, contentDigest: c.contentDigest, bucketIds: [bucketOf(c.lineage.bucketId)], certification: 'DRAFT' as const, lineageComplete: true, rights: 'CLEARED' as const, responseFormat: c.learner.itemType, stimulusKind: null, stimulusId: null, retired: false, difficulty: null })),
  ];
  const readiness = evaluateExamBankReadiness({
    blueprint: { assessmentSystem: 'IB', assessmentVersion: '0-2-0-illustrative', profile: 'MATH_AA_HL', component: null, blueprintId: 'v2.ib.math-aa-hl/pilot', blueprintVersion: 'P1-5+P2-4', buckets: BUCKETS.map(([b, n]) => ({ bucketId: b, requiredPositions: n, allowedFormats: null })) },
    mode: MODE_REQUIREMENTS.SECTION_PRACTICE, scope: 'PILOT_PREVIEW', capabilities: RUNTIME_CAPABILITIES, supply: rows,
  });
  const states = {
    CERTIFIED_CANDIDATE: first.certificationEligible, CANDIDATE_REFUSED: first.candidates - first.certificationEligible,
    CERTIFIED_NOT_DELIVERABLE: ib.length, BANK_DELIVERABLE: 0, RUNTIME_READY: readiness.runtimeEligibleItemCount,
  };
  const report = { ...first, idempotency: { runs: 2, reportDigests: [first.reportDigest, second.reportDigest], identical: idempotent, rowsWritten: 0, identitiesCreated: 0 }, ibPilotReadiness: { states, engine: { status: readiness.status, coveredPositions: readiness.coveredPositions, requiredPositions: readiness.requiredPositions, blockingReasons: readiness.blockingReasons, buckets: readiness.buckets.map((b) => ({ bucketId: b.bucketId, required: b.requiredPositions, certified: b.certifiedItemCount, runtimeEligible: b.runtimeEligibleItemCount, excluded: b.excluded })) } } };
  if (out) writeFileSync(join(root, out), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`package ${first.packageSha256 === first.expectedSha256 ? 'PINNED' : 'MISMATCH'} · ${first.constructs} constructs · ${first.candidates} candidates · accepted ${first.accepted} · certification-eligible ${first.certificationEligible}`);
  for (const k of first.byConstruct) console.log(`  ${k.construct.padEnd(34)} ${k.bucketId.split('/').pop()?.padEnd(22)} ${k.conceptStableId.padEnd(38)} accepted ${k.accepted}/${k.candidates}  failed: ${k.failedChecks.join(', ') || '-'}`);
  console.log(`failures by check: ${JSON.stringify(first.failuresByCheck)}`);
  console.log(`idempotent: ${idempotent} (${first.reportDigest.slice(0, 16)}) · IB pilot readiness ${readiness.status} ${readiness.coveredPositions}/${readiness.requiredPositions} · states ${JSON.stringify(states)}`);
  return idempotent ? 0 : 1;
}
main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(1); });
