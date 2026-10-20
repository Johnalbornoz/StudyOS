/** Track A -- POST { reason? }: remove a subject from the ACTIVE institution curriculum (archive; nothing learned or historical is deleted). */
import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { allUuids, readJson, requireInstitutionAdminActor } from '@/lib/institution/route-guard';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { governedError } from '@/lib/institution/route-errors';
import { archiveInstitutionCurriculumSubject } from '@/lib/institution/curriculum-management.service';

const Schema = z.object({ reason: z.string().trim().max(300).nullable().optional() });

async function handlePOST(request: NextRequest, { params }: { params: Promise<{ id: string; curriculumId: string }> }) {
  const { id, curriculumId } = await params;
  if (!allUuids(id, curriculumId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(id, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  const parsed = Schema.safeParse((await readJson(request)) ?? {});
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  try {
    return NextResponse.json({ success: true, data: await archiveInstitutionCurriculumSubject({ institutionId: id, curriculumId, actorUserId: guard.actor.id, reason: parsed.data.reason ?? null }) });
  } catch (error) {
    return governedError(error);
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const POST = withAiRequestMetrics('POST /api/institutions/[id]/curriculum/subjects/[curriculumId]/archive', handlePOST);
