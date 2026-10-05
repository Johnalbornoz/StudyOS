/**
 * Exam eligibility -- explicit exam / assessment assignment to a class, by its Teacher.
 * Same governance as the Institution route (class curriculum + outside-curriculum assessments; audited).
 * Not the Teacher of this class -> 403 (never a hint about the class).
 */
import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { requireUserActor, readBody, isUuid } from '@/lib/learning-plan/route-actors';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { getTeacherClass } from '@/lib/teacher/class-assignment.service';
import { assignExamToClass, listClassExamAssignments } from '@/lib/exam-core/eligibility/class-exam-assignment.service';
import { examAssignmentError } from '@/lib/exam-core/eligibility/route-errors';

const Schema = z.strictObject({ objectiveKey: z.string().regex(/^[a-z0-9._-]{1,120}$/) });

async function handleGET(_request: NextRequest, { params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  const actor = await requireUserActor();
  if ('response' in actor) return actor.response;
  const klass = isUuid(classId) ? await getTeacherClass(actor.userId, classId) : null;
  if (!klass) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  try {
    return NextResponse.json({ success: true, data: await listClassExamAssignments(klass.institutionId, classId) });
  } catch (error) {
    return examAssignmentError(error);
  }
}

async function handlePOST(request: NextRequest, { params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  const actor = await requireUserActor();
  if ('response' in actor) return actor.response;
  const klass = isUuid(classId) ? await getTeacherClass(actor.userId, classId) : null;
  if (!klass) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const parsed = Schema.safeParse(await readBody(request));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  try {
    const result = await assignExamToClass({ institutionId: klass.institutionId, classId, objectiveKey: parsed.data.objectiveKey, actorUserId: actor.userId, actorScope: 'TEACHER' });
    return NextResponse.json({ success: true, data: result }, { status: result.created ? 201 : 200 });
  } catch (error) {
    return examAssignmentError(error);
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/teacher/classes/[classId]/exam-assignments', handleGET);
export const POST = withAiRequestMetrics('POST /api/teacher/classes/[classId]/exam-assignments', handlePOST);
