import { NextResponse } from 'next/server';
import { testDB } from '@/lib/db';

/**
 * GET /api/health -- standard uptime-monitoring target (IVG-F15-13).
 *
 * Read-only, unauthenticated, no PII. Checks the one dependency every
 * request in this app actually needs (the database) via the existing,
 * already-certified `testDB()` -- never a second, ad hoc connectivity
 * check. Returns 503 (not 200) when the DB check fails, so external
 * uptime monitors correctly treat a DB outage as unhealthy.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const db = await testDB();
  const status = db.ok ? 'ok' : 'degraded';

  return NextResponse.json(
    { status, checks: { database: db.ok ? 'ok' : 'fail' } },
    { status: db.ok ? 200 : 503 }
  );
}
