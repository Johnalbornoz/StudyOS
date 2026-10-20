/**
 * Track A -- curriculum content of one subject.
 * GET: Topic / structure node → objectives (status, classification, mapped concepts) + concepts + addable concepts.
 * POST { objectives?: [{ learningObjectiveId, status?, classification? }], concepts?: [{ canonicalConceptId, status?, classification?, institutionTargetDate?, period? }] }:
 *   bulk include / exclude / restore / classify (the published structure is never modified).
 */
import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { allUuids, readJson, requireInstitutionAdminActor } from '@/lib/institution/route-guard';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { governedError } from '@/lib/institution/route-errors';
import { listInstitutionCurriculumContent, updateInstitutionCurriculumContentStatus, CLASSIFICATIONS } from '@/lib/institution/curriculum-management.service';

const Status = z.enum(['INCLUDED', 'EXCLUDED']);
const Schema = z.object({
  objectives: z.array(z.object({ learningObjectiveId: z.string().uuid(), status: Status.optional(), classification: z.enum(CLASSIFICATIONS).optional() })).max(300).optional(),
  concepts: z
    .array(z.object({ canonicalConceptId: z.string().uuid(), status: Status.optional(), classification: z.enum(CLASSIFICATIONS).optional(), institutionTargetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), period: z.string().trim().max(60).nullable().optional() }))
    .max(300)
    .optional(),
});

async function handleGET(_request: NextRequest, { params }: { params: Promise<{ id: string; curriculumId: string }> }) {
  const { id, curriculumId } = await params;
  if (!allUuids(id, curriculumId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(id, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  const locale = await getUserInterfaceLanguage(guard.actor.id).catch(() => 'es' as const);
  try {
    return NextResponse.json({ success: true, data: await listInstitutionCurriculumContent(id, curriculumId, locale) });
  } catch (error) {
    return governedError(error);
  }
}

async function handlePOST(request: NextRequest, { params }: { params: Promise<{ id: string; curriculumId: string }> }) {
  const { id, curriculumId } = await params;
  if (!allUuids(id, curriculumId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(id, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  const parsed = Schema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  try {
    return NextResponse.json({ success: true, data: await updateInstitutionCurriculumContentStatus({ institutionId: id, curriculumId, actorUserId: guard.actor.id, ...parsed.data }) });
  } catch (error) {
    return governedError(error);
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/institutions/[id]/curriculum/subjects/[curriculumId]/content', handleGET);
export const POST = withAiRequestMetrics('POST /api/institutions/[id]/curriculum/subjects/[curriculumId]/content', handlePOST);
