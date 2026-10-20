/**
 * Overnight 2026-10-16 -- POST /api/teacher/classes/[classId]/subject-assessments/preview
 * The plan a subject Test / Mock assignment WOULD freeze: question count and distribution (planGroupAssessment, the
 * same for every student), StudyUs recommended duration ("Recomendado por StudyUs") and the teacher's adjusted one,
 * the window (opens 00:00 of startDate, closes 21:00 of endDate in the institution's timezone). Writes nothing.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { allUuids, readJson } from '@/lib/institution/route-guard';
import { previewSubjectAssessmentAssignment } from '@/lib/teacher/subject-assessment-assignment.service';
import { DraftSchema, actorFor, mapAssignmentError } from '../_shared';

async function handlePOST(request: NextRequest, { params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  const actor = await actorFor();
  if (!actor) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  if (!allUuids(classId)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const parsed = DraftSchema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  try {
    const preview = await previewSubjectAssessmentAssignment(actor.id, { classId, ...parsed.data });
    return NextResponse.json({ success: true, data: preview });
  } catch (error) {
    return mapAssignmentError(error);
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const POST = withAiRequestMetrics('POST /api/teacher/classes/[classId]/subject-assessments/preview', handlePOST);
