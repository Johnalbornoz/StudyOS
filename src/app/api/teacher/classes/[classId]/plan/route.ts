/**
 * Track A -- /api/teacher/classes/[classId]/plan (the class's Teacher only)
 * GET: curriculum browser + class plan (relevance, coverage, prerequisites).
 * POST { canonicalConceptId, priority?, targetDate?, period?, requiredForClass? }:
 *   add an existing concept of the class subject to the class plan
 *   (SUPPLEMENTAL when outside the institution curriculum; coordinators told).
 */
import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { requireUserActor, readBody, isUuid } from '@/lib/learning-plan/route-actors';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { getClassPlanView, addToClassPlan, ClassPlanError } from '@/lib/learning-plan/class-plan.service';

function planError(error: unknown) {
  if (error instanceof ClassPlanError) {
    const status = error.code === 'NOT_TEACHER' ? 403 : error.code === 'NOT_FOUND' ? 404 : 422;
    return NextResponse.json({ error: error.code }, { status });
  }
  throw error;
}

const Schema = z.object({
  canonicalConceptId: z.string().uuid(),
  priority: z.enum(['HIGH', 'NORMAL', 'LOW']).optional(),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  period: z.string().trim().max(60).nullable().optional(),
  requiredForClass: z.boolean().optional(),
});

async function handleGET(_request: NextRequest, { params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  const actor = await requireUserActor();
  if ('response' in actor) return actor.response;
  if (!isUuid(classId)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const locale = await getUserInterfaceLanguage(actor.userId).catch(() => 'es' as const);
  try {
    return NextResponse.json({ success: true, data: await getClassPlanView(actor.userId, classId, locale) });
  } catch (error) {
    return planError(error);
  }
}

async function handlePOST(request: NextRequest, { params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  const actor = await requireUserActor();
  if ('response' in actor) return actor.response;
  if (!isUuid(classId)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const parsed = Schema.safeParse(await readBody(request));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  try {
    const { canonicalConceptId, ...opts } = parsed.data;
    const r = await addToClassPlan(actor.userId, classId, canonicalConceptId, opts);
    return NextResponse.json({ success: true, data: r }, { status: r.created ? 201 : 200 });
  } catch (error) {
    return planError(error);
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/teacher/classes/[classId]/plan', handleGET);
export const POST = withAiRequestMetrics('POST /api/teacher/classes/[classId]/plan', handlePOST);
