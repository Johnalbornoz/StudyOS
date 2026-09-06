import { NextResponse } from 'next/server';
import { buildDeploymentVersion } from '@/lib/deployment-version';

/**
 * GET /api/version -- deployment provenance.
 *
 * Read-only, unauthenticated, non-sensitive, DB-independent,
 * AI-independent. Its only purpose is release verification: after a
 * push, this endpoint reports the exact commit SHA production is
 * actually running, closing the recurring "which SHA is live?"
 * ambiguity.
 *
 * `force-dynamic` so the response reflects the runtime deployment env
 * (VERCEL_GIT_COMMIT_SHA / VERCEL_ENV), never a value inlined at build
 * time. No application behavior may depend on this response.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(buildDeploymentVersion(process.env));
}
