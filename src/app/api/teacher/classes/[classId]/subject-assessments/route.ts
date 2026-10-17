/**
 * Overnight 2026-10-16 -- /api/teacher/classes/[classId]/subject-assessments
 * GET: the composer context (class subject, eligible concepts, institution timezone / blocker, active learners) and
 *      the class's subject Test / Mock assignments (group summaries).
 * POST { kind, conceptIds, difficulty, startDate, endDate, maxAttempts, timing, title?, instructions?, studentIds?, requestId? }:
 *      publish one subject Test / Mock to the whole class (studentIds empty) or to selected ACTIVE learners.
 *      TIMEZONE_AUTHORITY_BLOCKER (409) when the institution has no timezone; invalid requests write nothing (422).
 * The actor must TEACH this class (never an institution admin). Nothing here grades or writes evidence.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { allUuids, readJson } from '@/lib/institution/route-guard';
import { getSubjectAssessmentComposerContext, listClassSubjectAssessmentAssignments, publishSubjectAssessmentAssignment } from '@/lib/teacher/subject-assessment-assignment.service';
import { PublishSchema, actorFor, mapAssignmentError } from './_shared';

async function handleGET(_request: NextRequest, { params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  const actor = await actorFor();
  if (!actor) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  if (!allUuids(classId)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  try {
    const [composer, assignments] = await Promise.all([getSubjectAssessmentComposerContext(actor.id, classId), listClassSubjectAssessmentAssignments(actor.id, classId)]);
    return NextResponse.json({ success: true, data: { composer, assignments } });
  } catch (error) {
    return mapAssignmentError(error);
  }
}

async function handlePOST(request: NextRequest, { params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  const actor = await actorFor();
  if (!actor) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  if (!allUuids(classId)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const parsed = PublishSchema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  try {
    const result = await publishSubjectAssessmentAssignment(actor.id, { classId, ...parsed.data });
    return NextResponse.json({ success: true, data: result }, { status: 201 });
  } catch (error) {
    return mapAssignmentError(error);
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/teacher/classes/[classId]/subject-assessments', handleGET);
export const POST = withAiRequestMetrics('POST /api/teacher/classes/[classId]/subject-assessments', handlePOST);
