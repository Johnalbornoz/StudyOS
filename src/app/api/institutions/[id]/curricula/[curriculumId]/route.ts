/** Track A -- GET: one curriculum of THIS institution (concepts + classification + addable concepts of the subject). */
import { NextRequest, NextResponse } from 'next/server';
import { allUuids, requireInstitutionAdminActor } from '@/lib/institution/route-guard';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { getInstitutionCurriculum, CurriculumError } from '@/lib/learning-plan/institution-curriculum.service';

function curriculumError(error: unknown) {
  if (error instanceof CurriculumError) return NextResponse.json({ error: error.code }, { status: error.code === 'NOT_FOUND' ? 404 : error.code === 'ALREADY_EXISTS' ? 409 : 422 });
  throw error;
}

async function handleGET(_request: NextRequest, { params }: { params: Promise<{ id: string; curriculumId: string }> }) {
  const { id, curriculumId } = await params;
  if (!allUuids(id, curriculumId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(id, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  const locale = await getUserInterfaceLanguage(guard.actor.id).catch(() => 'es' as const);
  try {
    return NextResponse.json({ success: true, data: await getInstitutionCurriculum(id, curriculumId, locale) });
  } catch (error) {
    return curriculumError(error);
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/institutions/[id]/curricula/[curriculumId]', handleGET);
