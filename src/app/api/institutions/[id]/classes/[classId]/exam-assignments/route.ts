/**
 * Exam eligibility -- explicit exam / assessment assignment to a class (Institution Admin).
 *   GET   the class's ACTIVE exam assignments and what it may be assigned (class curriculum + outside-curriculum assessments).
 *   POST  { objectiveKey }  assigns (idempotent). Incompatible with the class curriculum -> 422 OBJECTIVE_NOT_COMPATIBLE (audited DENIED).
 * Foreign class -> 404. Never modifies any Student's curriculum or history.
 */
import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { allUuids, readJson, requireInstitutionAdminActor } from '@/lib/institution/route-guard';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { assignExamToClass, listClassExamAssignments } from '@/lib/exam-core/eligibility/class-exam-assignment.service';
import { examAssignmentError } from '@/lib/exam-core/eligibility/route-errors';

const Schema = z.strictObject({ objectiveKey: z.string().regex(/^[a-z0-9._-]{1,120}$/) });

async function handleGET(_request: NextRequest, { params }: { params: Promise<{ id: string; classId: string }> }) {
  const { id, classId } = await params;
  if (!allUuids(id, classId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(id, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  try {
    return NextResponse.json({ success: true, data: await listClassExamAssignments(id, classId) });
  } catch (error) {
    return examAssignmentError(error);
  }
}

async function handlePOST(request: NextRequest, { params }: { params: Promise<{ id: string; classId: string }> }) {
  const { id, classId } = await params;
  if (!allUuids(id, classId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(id, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  const parsed = Schema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  try {
    const result = await assignExamToClass({ institutionId: id, classId, objectiveKey: parsed.data.objectiveKey, actorUserId: guard.actor.id, actorScope: 'INSTITUTION' });
    return NextResponse.json({ success: true, data: result }, { status: result.created ? 201 : 200 });
  } catch (error) {
    return examAssignmentError(error);
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/institutions/[id]/classes/[classId]/exam-assignments', handleGET);
export const POST = withAiRequestMetrics('POST /api/institutions/[id]/classes/[classId]/exam-assignments', handlePOST);
