/**
 * Track A -- seed display labels (es / en) for canonical concepts.
 * Identity stays the canonical id; this only adds localized labels so the
 * Learning Plan shows "Ecuaciones lineales" to a Spanish learner and
 * "Linear Equations" to an English one. Keyed by the canonical NAME (ids
 * differ per environment); unknown names are reported, never invented.
 *
 * DEV only (DB fingerprint guard). Dry-run by default; --apply upserts.
 *   npx tsx --env-file=.env.local scripts/operations/seed-canonical-localizations.ts [--apply]
 */
import { createHash } from 'crypto';
import { Client } from 'pg';
import { CANONICAL_CONCEPT_LABELS } from '../../src/lib/learning-plan/canonical-concept-labels';

const DEV_DB_FINGERPRINT = '2a29b99ee14a22b4';

// The governed labels live with the app (they are also its display fallback): one source for the seed and the UI.
const LABELS = CANONICAL_CONCEPT_LABELS;

async function main() {
  const apply = process.argv.includes('--apply');
  const url = new URL(process.env.DATABASE_URL ?? '');
  const fp = createHash('sha256').update(`${url.hostname}|${url.pathname.slice(1)}`).digest('hex').slice(0, 16);
  // DEV by default; another non-production target only when named explicitly (SEED_ALLOW_FP=<its fingerprint>).
  if (fp === '6671e7382d808d06') throw new Error('Refusing: PRODUCTION database');
  if (fp !== DEV_DB_FINGERPRINT && process.env.SEED_ALLOW_FP !== fp) throw new Error(`Refusing: DB fingerprint ${fp} is not DEV ${DEV_DB_FINGERPRINT} (set SEED_ALLOW_FP=${fp} to target it explicitly)`);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const concepts = await client.query(`SELECT id, name FROM canonical_concepts WHERE status = 'ACTIVE'`);
    const unknown: string[] = [];
    let upserts = 0;
    await client.query('BEGIN');
    for (const c of concepts.rows) {
      const labels = LABELS[c.name];
      if (!labels) {
        unknown.push(c.name);
        continue;
      }
      for (const [language, label] of [['es', labels[0]], ['en', labels[1]]] as const) {
        const r = await client.query(
          `INSERT INTO canonical_concept_localizations (canonical_concept_id, language, label) VALUES ($1, $2, $3)
           ON CONFLICT (canonical_concept_id, language) DO UPDATE SET label = EXCLUDED.label, updated_at = now()
           WHERE canonical_concept_localizations.label IS DISTINCT FROM EXCLUDED.label`,
          [c.id, language, label]
        );
        upserts += r.rowCount ?? 0;
      }
    }
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    console.log(JSON.stringify({ db: fp, mode: apply ? 'APPLIED' : 'DRY_RUN (rolled back)', concepts: concepts.rows.length, labelsWritten: upserts, unknown }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
