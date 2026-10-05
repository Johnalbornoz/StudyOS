/** Exam eligibility -- DELETE revokes a class exam assignment (the class's Teacher; audited; the row is kept as REVOKED). */
import { NextRequest, NextResponse } from 'next/server';
import { requireUserActor, isUuid } from '@/lib/learning-plan/route-actors';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { getTeacherClass } from '@/lib/teacher/class-assignment.service';
import { revokeClassExamAssignment } from '@/lib/exam-core/eligibility/class-exam-assignment.service';
import { examAssignmentError } from '@/lib/exam-core/eligibility/route-errors';

async function handleDELETE(_request: NextRequest, { params }: { params: Promise<{ classId: string; assignmentId: string }> }) {
  const { classId, assignmentId } = await params;
  const actor = await requireUserActor();
  if ('response' in actor) return actor.response;
  const klass = isUuid(classId) && isUuid(assignmentId) ? await getTeacherClass(actor.userId, classId) : null;
  if (!klass) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  try {
    await revokeClassExamAssignment({ institutionId: klass.institutionId, classId, assignmentId, actorUserId: actor.userId, actorScope: 'TEACHER' });
    return NextResponse.json({ success: true });
  } catch (error) {
    return examAssignmentError(error);
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const DELETE = withAiRequestMetrics('DELETE /api/teacher/classes/[classId]/exam-assignments/[assignmentId]', handleDELETE);
