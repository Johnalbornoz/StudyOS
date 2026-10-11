/**
 * L7 PA-3 -- GET /api/parent/learners/[studentId]/results
 *
 * The linked learner's released exam results, as summaries. `studentId` is a
 * route param and is never trusted: `getParentReleasedResults` re-validates
 * an ACCEPTED Parent relationship first, and decides what is released through
 * the Shared Foundation result scope (L10 SF-4). A pending, declined, revoked
 * or absent relationship is the same 403.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getParentReleasedResults, ParentAccessDeniedError } from '@/lib/parent/read-model.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

async function handleGET(_request: NextRequest, { params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await params;

  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  try {
    const results = await getParentReleasedResults(actor.id, studentId);
    return NextResponse.json({ success: true, data: { results } });
  } catch (error) {
    if (error instanceof ParentAccessDeniedError) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    throw error;
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/parent/learners/[studentId]/results', handleGET);
