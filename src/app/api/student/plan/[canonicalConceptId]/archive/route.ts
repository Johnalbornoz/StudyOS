/** Track A -- POST /api/student/plan/[canonicalConceptId]/archive { archived }: plan intent only; learner state, evidence and history stay. */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireStudentActor, readBody, isUuid } from '@/lib/learning-plan/route-actors';
import { setPlanEntryArchived } from '@/lib/learning-plan/personal-plan.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

async function handlePOST(request: NextRequest, { params }: { params: Promise<{ canonicalConceptId: string }> }) {
  const { canonicalConceptId } = await params;
  const actor = await requireStudentActor();
  if ('response' in actor) return actor.response;
  if (!isUuid(canonicalConceptId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const parsed = z.object({ archived: z.boolean() }).safeParse(await readBody(request));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  const changed = await setPlanEntryArchived(actor.studentId, canonicalConceptId, parsed.data.archived, actor.userId);
  return NextResponse.json({ success: true, data: { changed } });
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const POST = withAiRequestMetrics('POST /api/student/plan/[canonicalConceptId]/archive', handlePOST);
