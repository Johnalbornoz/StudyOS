/**
 * F15-C1 -- TEMPORARY, Preview-only trigger for the Pilot exam-catalog
 * seed (src/lib/assessment/pilot-catalog-seed.service.ts).
 *
 * Exists ONLY because Preview's own DATABASE_URL is a Vercel secret
 * this agent will never materialize locally (no `vercel env pull`, no
 * local .env.local pointed at Preview) -- running the seed's logic
 * INSIDE Vercel's own runtime, via this route, uses the environment's
 * own already-present DATABASE_URL exactly the same way every other
 * route in this app already does, without this agent ever touching
 * the connection string.
 *
 * Safety:
 *   - 404s outside `VERCEL_ENV === 'preview'` (never reachable on
 *     Production or local dev) -- identical gate to
 *     /api/diagnostics/preview-db.
 *   - Defaults to dry-run (`write: false`) unless the POST body
 *     explicitly sets `{"write": true}` -- mirrors the CLI script's
 *     own `--write`-required default.
 *   - Returns the exact same plan/report shape the CLI script prints,
 *     as JSON -- no secret, connection string, hostname, or personal
 *     data in the response (the underlying service only ever returns
 *     catalog ids/names/labels and a boolean).
 *   - Must be removed once this investigation concludes, exactly like
 *     /api/diagnostics/preview-db -- not a permanent addition.
 */
import { NextRequest, NextResponse } from 'next/server';
import { runPilotExamCatalogSeed, AbortSeed } from '@/lib/assessment/pilot-catalog-seed.service';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (process.env.VERCEL_ENV !== 'preview') {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  let write = false;
  try {
    const body = await request.json();
    write = body?.write === true;
  } catch {
    // No/invalid body -- defaults to dry-run, never treated as an error.
  }

  try {
    const result = await runPilotExamCatalogSeed(write);
    return NextResponse.json({ environment: 'preview', ...result });
  } catch (error) {
    if (error instanceof AbortSeed) {
      return NextResponse.json({ environment: 'preview', aborted: true, message: error.message }, { status: 409 });
    }
    return NextResponse.json({ environment: 'preview', error: 'SEED_FAILED', message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
