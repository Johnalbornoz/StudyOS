/**
 * Track A -- /api/institutions/[id]/students
 * GET: the institution roster (students with an ACTIVE or PENDING enrollment in a class of THIS institution).
 * POST { email, classId }: "Añadir estudiante": an institution student is enrolled directly; any other
 * existing student is invited (consent); never creates a Student (no account -> 422 NO_STUDENT_ACCOUNT).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { allUuids, readJson, requireInstitutionAdminActor } from '@/lib/institution/route-guard';
import { governedError } from '@/lib/institution/route-errors';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { listInstitutionStudents, addStudentToClass } from '@/lib/institution/institution-operations.service';

const Schema = z.strictObject({ email: z.string().trim().email().max(320), classId: z.string().uuid() });

async function handleGET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!allUuids(id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(id, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  void request;
  try {
    return NextResponse.json({ success: true, data: { students: await listInstitutionStudents(id) } });
  } catch (error) {
    return governedError(error);
  }
}
async function handlePOST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!allUuids(id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(id, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  void request;
  try {
    const parsed = Schema.safeParse(await readJson(request));
    if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
    return NextResponse.json({ success: true, data: await addStudentToClass(id, parsed.data.classId, parsed.data.email, guard.actor.id) }, { status: 201 });
  } catch (error) {
    return governedError(error);
  }
}

export const GET = withAiRequestMetrics('GET /api/institutions/[id]/students', handleGET);
export const POST = withAiRequestMetrics('POST /api/institutions/[id]/students', handlePOST);
