/**
 * Track A -- POST /api/institutions/[id]/students/[studentId]/enroll { classId }
 * Enroll a student of THIS institution in one more class (ACTIVE). Not a student here -> 404; duplicate -> 409.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { allUuids, readJson, requireInstitutionAdminActor } from '@/lib/institution/route-guard';
import { governedError } from '@/lib/institution/route-errors';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { enrollInstitutionStudent } from '@/lib/institution/institution-operations.service';

const Schema = z.strictObject({ classId: z.string().uuid() });

async function handlePOST(request: NextRequest, { params }: { params: Promise<{ id: string; studentId: string }> }) {
  const { id, studentId } = await params;
  if (!allUuids(id, studentId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(id, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  void request;
  try {
    const parsed = Schema.safeParse(await readJson(request));
    if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
    return NextResponse.json({ success: true, data: await enrollInstitutionStudent(id, studentId, parsed.data.classId, guard.actor.id) }, { status: 201 });
  } catch (error) {
    return governedError(error);
  }
}

export const POST = withAiRequestMetrics('POST /api/institutions/[id]/students/[studentId]/enroll', handlePOST);
