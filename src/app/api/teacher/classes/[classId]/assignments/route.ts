/**
 * Track A -- /api/teacher/classes/[classId]/assignments
 * GET: the class's assignments with each learner's outcome, plus the
 *      catalog concepts that can be assigned to this class.
 * POST { canonicalConceptId, title?, instructions?, startsAt?, dueAt?, studentIds? }:
 *      publish one class assignment (N per-learner interventions, one
 *      group) to the whole class or to selected ACTIVE learners. The topic
 *      must belong to the class's subject; invalid requests write nothing
 *      (422 with the reason code).
 * The actor must TEACH this class (approved membership + active scope);
 * an institution admin, a pending teacher or another class's teacher gets
 * 403. Nothing here writes learning evidence or mastery.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { z } from 'zod';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { allUuids, readJson } from '@/lib/institution/route-guard';
import {
  listClassAssignments,
  listAssignableConceptsForClass,
  publishClassAssignment,
  TeacherClassAccessDeniedError,
  NoLearnersToAssignError,
  InvalidClassAssignmentError,
} from '@/lib/teacher/class-assignment.service';

const Schema = z.object({
  canonicalConceptId: z.string().uuid(),
  title: z.string().trim().max(200).nullable().optional(),
  instructions: z.string().trim().max(500).nullable().optional(),
  startsAt: z.string().datetime({ offset: true }).nullable().optional(),
  studentIds: z.array(z.string().uuid()).max(500).nullable().optional(),
  dueAt: z
    .string()
    .datetime({ offset: true })
    .nullable()
    .optional()
    .refine((v) => !v || new Date(v).getTime() > Date.now(), { message: 'dueAt must be in the future' }),
});

async function actorFor() {
  const authContext = await verifyAuth();
  if (!authContext) return null;
  return getOrCreateCanonicalUser(authContext.userId, authContext.email || null);
}

async function handleGET(_request: NextRequest, { params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  const actor = await actorFor();
  if (!actor) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  if (!allUuids(classId)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  try {
    const [assignments, assignable] = await Promise.all([
      listClassAssignments(actor.id, classId),
      listAssignableConceptsForClass(actor.id, classId),
    ]);
    return NextResponse.json({ success: true, data: { assignments, ...assignable } });
  } catch (error) {
    if (error instanceof TeacherClassAccessDeniedError) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    throw error;
  }
}

async function handlePOST(request: NextRequest, { params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  const actor = await actorFor();
  if (!actor) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  if (!allUuids(classId)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const parsed = Schema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });

  try {
    const result = await publishClassAssignment(actor.id, { classId, ...parsed.data });
    return NextResponse.json({ success: true, data: result }, { status: 201 });
  } catch (error) {
    if (error instanceof TeacherClassAccessDeniedError) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    if (error instanceof NoLearnersToAssignError) return NextResponse.json({ error: 'NO_LEARNERS_TO_ASSIGN' }, { status: 422 });
    if (error instanceof InvalidClassAssignmentError) return NextResponse.json({ error: error.code }, { status: 422 });
    throw error;
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/teacher/classes/[classId]/assignments', handleGET);
export const POST = withAiRequestMetrics('POST /api/teacher/classes/[classId]/assignments', handlePOST);
