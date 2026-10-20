/**
 * Track A -- /api/institutions/[id]/curricula (coordinators of THIS institution)
 * GET: curricula + adoptable subjects (with published bases) + supplemental
 *   concepts teachers added + concept proposals of the institution.
 * POST { canonicalSubjectId, baseAcademicSubjectId?, gradeId?, academicYear?, programmeLabel?, title }: adopt.
 */
import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { allUuids, readJson, requireInstitutionAdminActor } from '@/lib/institution/route-guard';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { listInstitutionCurricula, adoptInstitutionCurriculum, listAdoptableSubjects, listSupplementalSuggestions, CurriculumError } from '@/lib/learning-plan/institution-curriculum.service';
import { listConceptProposals } from '@/lib/learning-plan/concept-proposals.service';

function curriculumError(error: unknown) {
  if (error instanceof CurriculumError) return NextResponse.json({ error: error.code }, { status: error.code === 'NOT_FOUND' ? 404 : error.code === 'ALREADY_EXISTS' ? 409 : 422 });
  throw error;
}

const Schema = z.object({
  canonicalSubjectId: z.string().uuid(),
  baseAcademicSubjectId: z.string().uuid().nullable().optional(),
  gradeId: z.string().uuid().nullable().optional(),
  academicYear: z.string().trim().max(20).nullable().optional(),
  programmeLabel: z.string().trim().max(120).nullable().optional(),
  title: z.string().trim().min(1).max(200),
});

async function handleGET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!allUuids(id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(id, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  const locale = await getUserInterfaceLanguage(guard.actor.id).catch(() => 'es' as const);
  const [curricula, subjects, supplemental, proposals] = await Promise.all([listInstitutionCurricula(id), listAdoptableSubjects(), listSupplementalSuggestions(id, locale), listConceptProposals({ institutionId: id })]);
  return NextResponse.json({ success: true, data: { curricula, subjects, supplemental, proposals } });
}

async function handlePOST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!allUuids(id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(id, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  const parsed = Schema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  const locale = await getUserInterfaceLanguage(guard.actor.id).catch(() => 'es' as const);
  try {
    const r = await adoptInstitutionCurriculum({ ...parsed.data, institutionId: id, actorUserId: guard.actor.id, locale });
    return NextResponse.json({ success: true, data: r }, { status: 201 });
  } catch (error) {
    return curriculumError(error);
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/institutions/[id]/curricula', handleGET);
export const POST = withAiRequestMetrics('POST /api/institutions/[id]/curricula', handlePOST);
