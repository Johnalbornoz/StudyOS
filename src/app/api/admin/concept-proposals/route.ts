/** Track A -- GET /api/admin/concept-proposals (StudyUS catalog governance only). */
import { NextResponse } from 'next/server';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { listConceptProposals } from '@/lib/learning-plan/concept-proposals.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

async function handleGET() {
  const guard = await guardAdminUsersRoute('admin.concept-proposals.list');
  if ('error' in guard) return guard.error;
  return NextResponse.json({ success: true, data: { proposals: await listConceptProposals() } });
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/admin/concept-proposals', handleGET);
