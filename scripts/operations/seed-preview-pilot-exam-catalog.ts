/**
 * F15-C1 -- CLI entrypoint for the Pilot-only exam-catalog seed. See
 * src/lib/assessment/pilot-catalog-seed.service.ts for the full
 * implementation, safety rationale, and scope -- this file is only the
 * dry-run/--write argument handling and console report.
 *
 * Usage (run against whatever DATABASE_URL --env-file points at --
 * e.g. a local/dev database):
 *   npx tsx --env-file=.env.local scripts/operations/seed-preview-pilot-exam-catalog.ts            # DRY RUN (default, zero writes)
 *   npx tsx --env-file=.env.local scripts/operations/seed-preview-pilot-exam-catalog.ts --write     # WRITE
 *
 * This script is NEVER run by this agent against Preview's own
 * DATABASE_URL (a Vercel secret this agent will not materialize
 * locally) -- for Preview, the identical logic runs instead through a
 * temporary Preview-only API route
 * (src/app/api/diagnostics/seed-pilot-exam-catalog/route.ts), inside
 * Vercel's own runtime, using the environment's own already-present
 * DATABASE_URL, exactly the same pattern already established for this
 * program's Preview DB diagnostics.
 */
import { runPilotExamCatalogSeed, AbortSeed } from '@/lib/assessment/pilot-catalog-seed.service';

async function main() {
  const write = process.argv.includes('--write');
  const dryRun = !write;

  console.log(`\n=== F15-C1 Pilot Exam Catalog Seed [${dryRun ? 'DRY RUN' : 'WRITE'}] ===`);
  console.log('Pilot configuration / non-official fixture -- not an official College Board or PAA specification.\n');

  const result = await runPilotExamCatalogSeed(write);

  console.log('protectedTableCountsBefore:', JSON.stringify(result.protectedTableCountsBefore));
  console.log('canonicalSubjectToCreate:', JSON.stringify(result.canonicalSubjectToCreate));
  console.log('canonicalConceptToCreate:', JSON.stringify(result.canonicalConceptToCreate));
  console.log('\npilotExamCatalogEntitiesToCreate:');
  for (const step of result.pilotExamCatalogEntitiesToCreate) {
    console.log(`  [${step.action}] ${step.entity}: ${step.detail}`);
  }
  console.log('\nFull plan (including canonical-catalog steps):');
  for (const step of result.plan) {
    console.log(`  [${step.action}] ${step.entity}: ${step.detail}`);
  }
  if (dryRun) {
    console.log('\nDry run only -- no rows written. Re-run with --write to apply.');
  } else {
    console.log('\nWrite complete. Re-run without --write (or with --write again) to confirm idempotency (should report EXISTS for everything above and mint zero new rows).');
    console.log('\nmanifestCreated (this run only):', JSON.stringify(result.manifestCreated, null, 2));
  }
  console.log(`\nmathCanonicalSubject: ${result.mathCanonicalSubject ? `"${result.mathCanonicalSubject.name}" (${result.mathCanonicalSubject.id})` : '(not yet created -- dry run)'}`);
  console.log(`canonicalConcept used: "${result.canonicalConceptName}" (${result.canonicalConceptId || '(not yet created -- dry run)'})`);
  console.log(`mappingPublished: ${result.mappingPublished}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    if (err instanceof AbortSeed) {
      console.error(`\nABORTED: ${err.message}\n`);
      process.exit(1);
    }
    console.error('Seed failed:', err);
    process.exit(1);
  });
