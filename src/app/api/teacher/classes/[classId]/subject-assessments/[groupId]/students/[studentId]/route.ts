/**
 * Overnight 2026-10-16 -- GET /api/teacher/classes/[classId]/subject-assessments/[groupId]/students/[studentId]
 * The Teacher's drill-down of ONE student of the assignment: total score and by concept (latest completed attempt),
 * response by question, errors with the expected answer and explanation, concepts needing reinforcement, attempt
 * history. The actor must TEACH this class AND this learner; the learner must be a recipient of this group.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { allUuids } from '@/lib/institution/route-guard';
import { getSubjectAssessmentStudentResult } from '@/lib/teacher/subject-assessment-assignment.service';
import { actorFor, mapAssignmentError } from '../../../_shared';

async function handleGET(_request: NextRequest, { params }: { params: Promise<{ classId: string; groupId: string; studentId: string }> }) {
  const { classId, groupId, studentId } = await params;
  const actor = await actorFor();
  if (!actor) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  if (!allUuids(classId, groupId, studentId)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  try {
    return NextResponse.json({ success: true, data: await getSubjectAssessmentStudentResult(actor.id, classId, groupId, studentId) });
  } catch (error) {
    return mapAssignmentError(error);
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/teacher/classes/[classId]/subject-assessments/[groupId]/students/[studentId]', handleGET);
