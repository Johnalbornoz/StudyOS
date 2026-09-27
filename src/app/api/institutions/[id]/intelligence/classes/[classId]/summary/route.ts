import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getClassLearningSummary } from '@/lib/institution-intelligence';
import { respondFromService } from '../../../_respond';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

async function handleGET(_request: NextRequest, { params }: { params: Promise<{ id: string; classId: string }> }) {
  const { id: institutionId, classId } = await params;
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);
  return respondFromService(() => getClassLearningSummary(actor.id, institutionId, classId));
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/institutions/[id]/intelligence/classes/[classId]/summary', handleGET);
