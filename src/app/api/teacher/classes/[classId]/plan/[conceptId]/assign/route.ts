/**
 * Track A -- POST { studentIds?: uuid[] }: the class's Teacher assigns a class
 * plan concept to all (or the selected) ACTIVE learners -- it enters each
 * personal plan with a CLASS_PLAN source; existing learner state is kept.
 */
import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { requireUserActor, readBody, isUuid } from '@/lib/learning-plan/route-actors';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { FieldLockedError } from '@/lib/institution/academic-governance';
import { assignClassPlanConcept, ClassPlanError } from '@/lib/learning-plan/class-plan.service';

const Schema = z.object({ studentIds: z.array(z.string().uuid()).max(500).nullable().optional() });

async function handlePOST(request: NextRequest, { params }: { params: Promise<{ classId: string; conceptId: string }> }) {
  const { classId, conceptId } = await params;
  const actor = await requireUserActor();
  if ('response' in actor) return actor.response;
  if (!isUuid(classId) || !isUuid(conceptId)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const parsed = Schema.safeParse((await readBody(request)) ?? {});
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  try {
    return NextResponse.json({ success: true, data: await assignClassPlanConcept(actor.userId, classId, conceptId, parsed.data.studentIds ?? null) });
  } catch (error) {
    if (error instanceof FieldLockedError) return NextResponse.json({ error: error.code, fields: error.fields }, { status: 403 });
    if (error instanceof ClassPlanError) {
      const status = error.code === 'NOT_TEACHER' ? 403 : error.code === 'NOT_FOUND' ? 404 : 422;
      return NextResponse.json({ error: error.code }, { status });
    }
    throw error;
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const POST = withAiRequestMetrics('POST /api/teacher/classes/[classId]/plan/[conceptId]/assign', handlePOST);
