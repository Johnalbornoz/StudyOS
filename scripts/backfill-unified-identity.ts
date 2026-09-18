/**
 * F1 -- unified identity backfill runner.
 *
 *   npm run backfill:identity            # DRY RUN (default -- zero writes)
 *   npm run backfill:identity -- --write # explicit WRITE mode
 *
 * Prints before/after counts and any unresolved (orphaned) profile
 * ids -- never any other learner content. See
 * F1_IDENTITY_RECONCILIATION_REPORT.md for a certified run's output.
 */
import { runIdentityBackfill } from '@/services/identity-backfill.service';

async function main() {
  const write = process.argv.includes('--write');
  const dryRun = !write;

  console.log(`\n=== F1 Unified Identity backfill [${dryRun ? 'DRY RUN' : 'WRITE'}] ===`);

  const result = await runIdentityBackfill(dryRun);

  console.log('\n-- before --');
  console.log(result.before);
  console.log('\n-- after --');
  console.log(result.after);
  console.log(`\n  users created:        ${result.usersCreated}`);
  console.log(`  user_roles created:   ${result.userRolesCreated}`);
  console.log(`  students mapped:      ${result.studentsMapped}`);
  console.log(`  profiles mapped:      ${result.profilesMapped}`);
  console.log(`  unresolved (orphan) profile ids: ${result.orphanedProfileIds.length}`);
  if (result.orphanedProfileIds.length > 0) {
    console.log(`  ${JSON.stringify(result.orphanedProfileIds)}`);
  }
  if (dryRun) {
    console.log('\nDry run only -- no rows written. Re-run with --write to apply.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });
