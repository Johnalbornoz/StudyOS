/**
 * Track A -- POST remove a Student from a class (or withdraw a pending
 * invitation) of THIS institution. Soft (status ENDED + ended_at), never a
 * DELETE; the learner's own learning history is untouched. Teacher access
 * through this class ends immediately (every check requires ACTIVE).
 */
import { NextRequest, NextResponse } from 'next/server';
import { endClassEnrollment } from '@/services/institution.service';
import { allUuids, requireInstitutionAdminActor } from '@/lib/institution/route-guard';

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string; classId: string; enrollmentId: string }> }) {
  const { id: institutionId, classId, enrollmentId } = await params;
  if (!allUuids(institutionId, classId, enrollmentId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(institutionId, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;

  const ended = await endClassEnrollment(institutionId, classId, enrollmentId);
  if (!ended) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  return NextResponse.json({ success: true });
}
