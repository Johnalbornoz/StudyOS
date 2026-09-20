/**
 * F15-C1 -- GET /api/diagnostics/preview-db
 *
 * TEMPORARY, Preview-only runtime diagnostic to resolve a real,
 * live-observed contradiction during Pilot gate closure: the operator
 * ran `npm run db:migrate` against Preview's own `DATABASE_URL` (all
 * 17 migrations applied, ledger confirms "nothing to do"), yet the
 * deployed Preview application still fails with
 * `relation "users" does not exist`. This route answers one question
 * only -- is the RUNTIME deployment actually talking to the SAME
 * database the operator just migrated? -- without ever exposing the
 * connection string, hostname, or any credential.
 *
 * Safety:
 *   - 404s outside `VERCEL_ENV === 'preview'` (never reachable on
 *     Production or local dev).
 *   - Never returns DATABASE_URL, hostname, username, password, port,
 *     or the raw connection string in any form.
 *   - The fingerprint is a one-way SHA-256 hash (first 16 hex chars)
 *     of `${hostname}|${databaseName}`, computed server-side from the
 *     ALREADY-IN-USE `process.env.DATABASE_URL` this same runtime
 *     already connects with via `@/lib/db` -- this route reads no new
 *     secret, it only derives a non-reversible comparison value from
 *     the one every other route in this app already uses implicitly.
 *   - Every DB query is a read-only `to_regclass`/`COUNT(*)` check --
 *     zero writes.
 *   - Reuses `buildDeploymentVersion` (the same, already-certified,
 *     closed-shape env reader `/api/version` uses) for `deploymentSha`
 *     -- never a second, ad hoc env-reading implementation.
 *
 * This route must be removed once the investigation concludes (task's
 * own explicit instruction) -- it is not a permanent addition.
 */
import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { db } from '@/lib/db';
import { buildDeploymentVersion } from '@/lib/deployment-version';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (process.env.VERCEL_ENV !== 'preview') {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) {
    return NextResponse.json({ error: 'DATABASE_URL_NOT_SET' }, { status: 500 });
  }

  let hostname: string;
  let databaseName: string;
  try {
    const parsed = new URL(rawUrl);
    hostname = parsed.hostname;
    databaseName = parsed.pathname.replace(/^\//, '');
  } catch {
    return NextResponse.json({ error: 'DATABASE_URL_UNPARSEABLE' }, { status: 500 });
  }

  const dbFingerprint = createHash('sha256').update(`${hostname}|${databaseName}`).digest('hex').slice(0, 16);

  const [
    usersResult,
    ledgerResult,
    userRolesResult,
    studentsResult,
    institutionsResult,
    schemaResult,
    searchPathResult,
    tablesResult,
  ] = await Promise.all([
    db.query(`SELECT to_regclass('public.users') IS NOT NULL AS exists`),
    db.query(`SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists`),
    db.query(`SELECT to_regclass('public.user_roles') IS NOT NULL AS exists`),
    db.query(`SELECT to_regclass('public.students') IS NOT NULL AS exists`),
    db.query(`SELECT to_regclass('public.institutions') IS NOT NULL AS exists`),
    db.query(`SELECT current_schema() AS schema`),
    db.query(`SELECT current_setting('search_path') AS search_path`),
    db.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`),
  ]);

  const usersTableExists: boolean = usersResult.rows[0].exists;
  const migrationLedgerExists: boolean = ledgerResult.rows[0].exists;
  const userRolesTableExists: boolean = userRolesResult.rows[0].exists;
  const studentsTableExists: boolean = studentsResult.rows[0].exists;
  const institutionsTableExists: boolean = institutionsResult.rows[0].exists;
  const schemaMigrationsTableExists: boolean = migrationLedgerExists;
  const currentSchema: string = schemaResult.rows[0].schema;
  const searchPath: string = searchPathResult.rows[0].search_path;
  const publicTableNames: string[] = tablesResult.rows.map((r: { table_name: string }) => r.table_name);
  const publicTableCount: number = publicTableNames.length;

  let appliedMigrationCount = 0;
  let migrationIds: Array<{ version: string; name: string; appliedAt: string }> = [];
  if (migrationLedgerExists) {
    const countResult = await db.query(`SELECT COUNT(*)::int AS c FROM schema_migrations`);
    appliedMigrationCount = countResult.rows[0].c;

    const idsResult = await db.query(
      `SELECT version, name, applied_at FROM schema_migrations ORDER BY applied_at ASC`
    );
    migrationIds = idsResult.rows.map((r: { version: string; name: string; applied_at: string | Date }) => ({
      version: r.version,
      name: r.name,
      appliedAt: new Date(r.applied_at).toISOString(),
    }));
  }

  const { commitSha } = buildDeploymentVersion(process.env);

  return NextResponse.json({
    environment: 'preview',
    deploymentSha: commitSha,
    dbFingerprint,
    databaseName,
    usersTableExists,
    migrationLedgerExists,
    appliedMigrationCount,
    currentSchema,
    searchPath,
    publicTableCount,
    publicTableNames,
    migrationIds,
    userRolesTableExists,
    studentsTableExists,
    institutionsTableExists,
    schemaMigrationsTableExists,
  });
}
