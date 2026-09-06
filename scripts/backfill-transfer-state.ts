/**
 * Phase 7 Step 7C3 -- historical concept_transfer_state backfill runner.
 *
 *   npm run backfill:transfer            # DRY RUN (default -- zero concept_transfer_state writes)
 *   npm run backfill:transfer -- --write # explicit WRITE mode
 *   npm run backfill:transfer -- --write --resume <runId>
 *   npm run backfill:transfer -- --student <uuid>   # scope to one student
 *
 * Loops batches until the run is COMPLETE. Prints concise aggregate
 * metrics only -- never a student/concept id, never learner content.
 */
import { runTransferStateBackfill, type TransferBackfillResult } from '@/services/transfer-backfill.service';
import { db } from '@/lib/db';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const write = process.argv.includes('--write');
  const dryRun = !write;
  const studentId = arg('--student');
  let runId = arg('--resume');

  console.log(`\n=== Transfer State backfill  [${dryRun ? 'DRY RUN' : 'WRITE'}] ===`);
  if (studentId) console.log(`  scope: single student`);
  if (runId) console.log(`  resuming run ${runId}`);

  let last: TransferBackfillResult | null = null;
  let batches = 0;
  do {
    last = await runTransferStateBackfill({ dryRun, studentId, runId });
    runId = last.runId;
    batches += 1;
  } while (!last.done && batches < 100000);

  const m = last!.metrics;
  console.log(`\n  runId              ${last!.runId}`);
  console.log(`  status             ${last!.status}   batches=${batches}`);
  console.log(`  pairsScanned       ${m.pairsScanned}`);
  console.log(`  totalEvidenceRows  ${m.totalEvidenceRows}`);
  console.log(`  invalidEvidenceRows${m.invalidEvidenceRows}`);
  console.log(`  proposedInserts    ${m.proposedInserts}   (dry-run)`);
  console.log(`  proposedUpdates    ${m.proposedUpdates}   (dry-run)`);
  console.log(`  semanticNoops      ${m.semanticNoops}`);
  console.log(`  rowsWritten        ${m.rowsWritten}   (write mode)`);
  console.log(`  failedPairs        ${m.failedPairs}`);
  console.log(`  scoreMismatches    ${m.scoreMismatches}`);
  console.log(`  midSuccessTotal    ${m.midSuccessCountTotal}`);
  console.log(`  farSuccessTotal    ${m.farSuccessCountTotal}`);
  console.log(`  nonEmptyNovelty    ${m.nonEmptyNoveltyStateRows}`);
  console.log(`  depthCounts        ${JSON.stringify(m.depthCounts)}`);
  console.log(`  policyVersion      ${JSON.stringify(m.policyVersionCounts)}`);

  const gateFail =
    m.failedPairs > 0 || m.scoreMismatches > 0 || m.depthCounts.GENERALIZED > 0 || m.depthCounts.ROBUST > 0;
  console.log(`\n  HARD GATES: failedPairs=${m.failedPairs} scoreMismatches=${m.scoreMismatches} GENERALIZED=${m.depthCounts.GENERALIZED} ROBUST=${m.depthCounts.ROBUST}`);
  console.log(gateFail ? '  >>> GATE FAILURE -- do not proceed.' : '  >>> gates OK');

  await db.end?.();
  process.exit(gateFail ? 1 : 0);
}

main().catch((e) => {
  console.error('backfill runner failed:', e);
  process.exit(1);
});
