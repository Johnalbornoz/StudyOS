/**
 * Platform Admin (STUDYUS_ADMIN) -- GET /api/admin/question-bank/demand/[examVersionId]
 *
 * Demand-driven inventory per blueprint cell: Students in process / retention due / assigned,
 * expected exposures over the horizon, required unique questions, approved inventory by
 * difficulty, deficit, repeat rate, days of coverage, GREEN / YELLOW / RED and the Factory
 * recommendation (how many, which difficulty mix). Aggregates only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { loadVersionHealthInputs } from '@/lib/exam-core/question-bank/health.service';
import { versionDemand } from '@/lib/exam-core/question-bank/demand.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

async function handleGET(_req: NextRequest, { params }: { params: Promise<{ examVersionId: string }> }) {
  const guard = await guardAdminUsersRoute('admin.questionBank.demand');
  if ('error' in guard) return guard.error;
  const { examVersionId } = await params;
  if (!z.string().uuid().safeParse(examVersionId).success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  const inputs = await loadVersionHealthInputs(examVersionId);
  if (!inputs) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  return NextResponse.json({ success: true, data: await versionDemand(inputs) });
}

export const GET = withAiRequestMetrics('GET /api/admin/question-bank/demand/[examVersionId]', handleGET);
