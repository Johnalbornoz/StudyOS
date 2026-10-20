/**
 * Track A -- Institution curriculum subjects (coordinators of THIS institution).
 * GET: subjects grouped data (incl. archived) + governed source catalog + grades.
 * POST { gradeId|null, academicYear?, items: [{ academicSubjectId, versionId? }] }: add one or many (idempotent).
 */
import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { allUuids, readJson, requireInstitutionAdminActor } from '@/lib/institution/route-guard';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { governedError } from '@/lib/institution/route-errors';
import { listInstitutionCurriculumSubjects, listCurriculumSourceOptions, addInstitutionCurriculumSubjects } from '@/lib/institution/curriculum-management.service';
import { listInstitutionGrades } from '@/services/institution.service';

const Schema = z.object({
  gradeId: z.string().uuid().nullable(),
  academicYear: z.string().trim().max(20).nullable().optional(),
  items: z.array(z.object({ academicSubjectId: z.string().uuid(), versionId: z.string().uuid().nullable().optional() })).min(1).max(30),
});

async function handleGET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!allUuids(id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(id, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  const [subjects, sources, grades] = await Promise.all([listInstitutionCurriculumSubjects(id, { includeArchived: true }), listCurriculumSourceOptions(), listInstitutionGrades(id)]);
  return NextResponse.json({ success: true, data: { subjects, sources, grades } });
}

async function handlePOST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!allUuids(id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(id, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  const parsed = Schema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  try {
    const result = await addInstitutionCurriculumSubjects({ institutionId: id, actorUserId: guard.actor.id, gradeId: parsed.data.gradeId, academicYear: parsed.data.academicYear ?? null, items: parsed.data.items });
    return NextResponse.json({ success: true, data: { results: result } }, { status: result.some((r) => r.created) ? 201 : 200 });
  } catch (error) {
    return governedError(error);
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/institutions/[id]/curriculum/subjects', handleGET);
export const POST = withAiRequestMetrics('POST /api/institutions/[id]/curriculum/subjects', handlePOST);
