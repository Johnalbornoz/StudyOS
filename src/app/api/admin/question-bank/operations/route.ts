/**
 * Platform Admin (STUDYUS_ADMIN) -- GET /api/admin/question-bank/operations
 *
 * Generation operations (read-mostly): queue (pending / running / failed /
 * completed), factory runs with AI calls, tokens, cost, accepted / rejected /
 * repaired, rate-limit events, the AI budget (factory daily budget, per-run
 * cap, shared-cap reserve) and the latest generated candidates with their
 * lifecycle and validation outcome. No content, no keys.
 */
import { NextResponse } from 'next/server';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { operationsView } from '@/lib/exam-core/question-bank/admin.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

async function handleGET() {
  const guard = await guardAdminUsersRoute('admin.questionBank.operations');
  if ('error' in guard) return guard.error;
  return NextResponse.json({ success: true, data: await operationsView() });
}

export const GET = withAiRequestMetrics('GET /api/admin/question-bank/operations', handleGET);
