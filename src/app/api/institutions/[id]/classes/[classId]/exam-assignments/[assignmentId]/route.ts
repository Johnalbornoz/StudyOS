/** Exam eligibility -- DELETE revokes a class exam assignment (Institution Admin; audited; the row is kept as REVOKED). */
import { NextRequest, NextResponse } from 'next/server';
import { allUuids, requireInstitutionAdminActor } from '@/lib/institution/route-guard';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { revokeClassExamAssignment } from '@/lib/exam-core/eligibility/class-exam-assignment.service';
import { examAssignmentError } from '@/lib/exam-core/eligibility/route-errors';

async function handleDELETE(_request: NextRequest, { params }: { params: Promise<{ id: string; classId: string; assignmentId: string }> }) {
  const { id, classId, assignmentId } = await params;
  if (!allUuids(id, classId, assignmentId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(id, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  try {
    await revokeClassExamAssignment({ institutionId: id, classId, assignmentId, actorUserId: guard.actor.id, actorScope: 'INSTITUTION' });
    return NextResponse.json({ success: true });
  } catch (error) {
    return examAssignmentError(error);
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const DELETE = withAiRequestMetrics('DELETE /api/institutions/[id]/classes/[classId]/exam-assignments/[assignmentId]', handleDELETE);
