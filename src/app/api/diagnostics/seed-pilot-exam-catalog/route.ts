/**
 * F15-C1 -- TEMPORARY, Preview-only, strongly-authenticated trigger for
 * the Pilot exam-catalog seed (src/lib/assessment/pilot-catalog-seed.service.ts).
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
 *   - Requires a strong, single-purpose bearer token
 *     (`x-seed-trigger-token` header, compared in constant time against
 *     `process.env.SEED_TRIGGER_TOKEN`) -- a random secret generated
 *     and set as a Preview-only Vercel env var solely for this one-time
 *     operation, unrelated to and never derived from any existing
 *     credential. 401s (never a detailed error) on a missing/incorrect
 *     token, and 500s if the server-side token isn't configured at all
 *     (fails closed, never open).
 *   - Accepts exactly one client input, `{"write": boolean}` -- no
 *     free-form ids, names, or any other value from the caller ever
 *     reaches a query. Defaults to dry-run (`write: false`) unless
 *     explicitly `true` -- mirrors the CLI script's own
 *     `--write`-required default.
 *   - Returns the exact same plan/report shape the CLI script prints,
 *     as JSON -- no secret, connection string, hostname, or personal
 *     data in the response (the underlying service only ever returns
 *     catalog ids/names/labels, counts, and booleans). Never echoes the
 *     trigger token itself.
 *   - Removed from the codebase immediately after the seed is executed
 *     and verified (see docs/implementation/f15/F15_PILOT_EXAM_CATALOG_SEED_MANIFEST.md
 *     for the exact before/after deployment record) -- not a permanent
 *     addition, exactly like /api/diagnostics/preview-db.
 */
import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { runPilotExamCatalogSeed, AbortSeed } from '@/lib/assessment/pilot-catalog-seed.service';

export const dynamic = 'force-dynamic';

function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.SEED_TRIGGER_TOKEN;
  if (!expected) return false;
  const provided = request.headers.get('x-seed-trigger-token');
  if (!provided) return false;
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

export async function POST(request: NextRequest) {
  if (process.env.VERCEL_ENV !== 'preview') {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  if (!process.env.SEED_TRIGGER_TOKEN) {
    return NextResponse.json({ error: 'TRIGGER_NOT_CONFIGURED' }, { status: 500 });
  }

  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
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
