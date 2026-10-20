/** Track A -- GET: institution tasks targeting this class (locked fields + recipients), for its Teacher only. */
import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { requireUserActor, readBody, isUuid } from '@/lib/learning-plan/route-actors';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { governedError } from '@/lib/institution/route-errors';
import { listClassInstitutionAssignments } from '@/lib/institution/institution-governance.service';

async function handleGET(_request: NextRequest, { params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  const actor = await requireUserActor();
  if ('response' in actor) return actor.response;
  if (!isUuid(classId)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const locale = await getUserInterfaceLanguage(actor.userId).catch(() => 'es' as const);
  try {
    return NextResponse.json({ success: true, data: { assignments: await listClassInstitutionAssignments(actor.userId, classId, locale) } });
  } catch (error) {
    return governedError(error);
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/teacher/classes/[classId]/institution-assignments', handleGET);
