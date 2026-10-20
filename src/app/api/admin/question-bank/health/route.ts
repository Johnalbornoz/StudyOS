/**
 * Platform Admin (STUDYUS_ADMIN) -- GET /api/admin/question-bank/health
 *
 * Question Bank Health: every published exam version with its latest
 * precomputed bank-health snapshot (catalogue / structure / practice / reduced
 * mock / full mock / full mock calibrated, active / pilot / review items,
 * coverage health). Read-only; never recomputes on read. Not a Student surface.
 */
import { NextResponse } from 'next/server';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { bankHealthOverview } from '@/lib/exam-core/question-bank/admin.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

async function handleGET() {
  const guard = await guardAdminUsersRoute('admin.questionBank.health');
  if ('error' in guard) return guard.error;
  return NextResponse.json({ success: true, data: { exams: await bankHealthOverview() } });
}

export const GET = withAiRequestMetrics('GET /api/admin/question-bank/health', handleGET);
