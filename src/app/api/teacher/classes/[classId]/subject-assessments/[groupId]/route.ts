/**
 * Overnight 2026-10-16 -- GET /api/teacher/classes/[classId]/subject-assessments/[groupId]
 * The Teacher's GROUP view of one subject Test / Mock assignment: per student the LATEST COMPLETED attempt's score and
 * attempts used / max, group average, result distribution, per-concept performance, difficulty, high-error questions /
 * areas, strongest concepts and largest gaps. The actor must TEACH this class; the group must belong to it.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { allUuids } from '@/lib/institution/route-guard';
import { getSubjectAssessmentGroupResults } from '@/lib/teacher/subject-assessment-assignment.service';
import { actorFor, mapAssignmentError } from '../_shared';

async function handleGET(request: NextRequest, { params }: { params: Promise<{ classId: string; groupId: string }> }) {
  const { classId, groupId } = await params;
  const actor = await actorFor();
  if (!actor) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  if (!allUuids(classId, groupId)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  try {
    const locale = request.nextUrl.searchParams.get('locale') ?? 'es';
    return NextResponse.json({ success: true, data: await getSubjectAssessmentGroupResults(actor.id, classId, groupId, { locale }) });
  } catch (error) {
    return mapAssignmentError(error);
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/teacher/classes/[classId]/subject-assessments/[groupId]', handleGET);
