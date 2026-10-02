/** Track A -- GET ?academicSubjectId=&versionId=: impact of a level / version change (objectives added / retired, classes, students). Read-only. */
import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { allUuids, readJson, requireInstitutionAdminActor } from '@/lib/institution/route-guard';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { governedError } from '@/lib/institution/route-errors';
import { previewCurriculumSubjectChange, curriculumUsage, listInstitutionCurriculumSubjects } from '@/lib/institution/curriculum-management.service';

async function handleGET(request: NextRequest, { params }: { params: Promise<{ id: string; curriculumId: string }> }) {
  const { id, curriculumId } = await params;
  if (!allUuids(id, curriculumId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(id, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  const url = new URL(request.url);
  const academicSubjectId = url.searchParams.get('academicSubjectId');
  const versionId = url.searchParams.get('versionId');
  try {
    if (!(await listInstitutionCurriculumSubjects(id, { includeArchived: true })).some((s) => s.curriculumId === curriculumId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    if (!academicSubjectId) return NextResponse.json({ success: true, data: { usage: await curriculumUsage(curriculumId) } });
    if (!allUuids(academicSubjectId) || (versionId && !allUuids(versionId))) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
    return NextResponse.json({ success: true, data: await previewCurriculumSubjectChange(id, curriculumId, { academicSubjectId, versionId }) });
  } catch (error) {
    return governedError(error);
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/institutions/[id]/curriculum/subjects/[curriculumId]/preview', handleGET);
