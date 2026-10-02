/**
 * Track A -- PATCH { title?, academicYear?, gradeId?, academicSubjectId?, versionId? }: edit a curriculum subject.
 * A level / version change archives the previous relation and re-points its classes (history kept).
 */
import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { allUuids, readJson, requireInstitutionAdminActor } from '@/lib/institution/route-guard';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { governedError } from '@/lib/institution/route-errors';
import { updateInstitutionCurriculumSubject } from '@/lib/institution/curriculum-management.service';

const Schema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  academicYear: z.string().trim().max(20).nullable().optional(),
  gradeId: z.string().uuid().nullable().optional(),
  academicSubjectId: z.string().uuid().optional(),
  versionId: z.string().uuid().nullable().optional(),
});

async function handlePATCH(request: NextRequest, { params }: { params: Promise<{ id: string; curriculumId: string }> }) {
  const { id, curriculumId } = await params;
  if (!allUuids(id, curriculumId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(id, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  const parsed = Schema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  try {
    return NextResponse.json({ success: true, data: await updateInstitutionCurriculumSubject({ institutionId: id, curriculumId, actorUserId: guard.actor.id, ...parsed.data }) });
  } catch (error) {
    return governedError(error);
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const PATCH = withAiRequestMetrics('PATCH /api/institutions/[id]/curriculum/subjects/[curriculumId]', handlePATCH);
