import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { requireParentProfileId } from '@/lib/auth';
import { getLinkedChildren } from '@/services/parent.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

async function handleGET() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parentId = await requireParentProfileId(clerkUserId);
  if (!parentId) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const children = await getLinkedChildren(parentId);
  return NextResponse.json({ success: true, data: { children } });
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/parent/children', handleGET);
