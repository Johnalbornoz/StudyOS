/** Track A -- GET ?programmeId=&gradeId=&curriculumId=: institution curriculum coverage (class plans / students' plans / pending). Never mastery. */
import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { allUuids, readJson, requireInstitutionAdminActor } from '@/lib/institution/route-guard';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { governedError } from '@/lib/institution/route-errors';
import { getInstitutionCurriculumCoverage, getCurriculumSubjectCoverage } from '@/lib/institution/curriculum-management.service';

async function handleGET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!allUuids(id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(id, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  const url = new URL(request.url);
  const uuid = (k: string) => {
    const v = url.searchParams.get(k);
    return v && allUuids(v) ? v : null;
  };
  const locale = await getUserInterfaceLanguage(guard.actor.id).catch(() => 'es' as const);
  try {
    const curriculumId = uuid('curriculumId');
    if (curriculumId) return NextResponse.json({ success: true, data: await getCurriculumSubjectCoverage(id, curriculumId, locale) });
    return NextResponse.json({ success: true, data: { subjects: await getInstitutionCurriculumCoverage(id, { programmeId: uuid('programmeId'), gradeId: uuid('gradeId') }) } });
  } catch (error) {
    return governedError(error);
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/institutions/[id]/curriculum/coverage', handleGET);
