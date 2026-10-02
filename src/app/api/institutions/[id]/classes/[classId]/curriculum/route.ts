/** Track A -- POST { curriculumId }: associate a class of THIS institution with one of its ACTIVE curriculum subjects (foreign class / curriculum → 404). */
import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { allUuids, readJson, requireInstitutionAdminActor } from '@/lib/institution/route-guard';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { governedError } from '@/lib/institution/route-errors';
import { assignClassCurriculum } from '@/lib/institution/curriculum-management.service';

const Schema = z.object({ curriculumId: z.string().uuid() });

async function handlePOST(request: NextRequest, { params }: { params: Promise<{ id: string; classId: string }> }) {
  const { id, classId } = await params;
  if (!allUuids(id, classId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(id, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  const parsed = Schema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  try {
    return NextResponse.json({ success: true, data: await assignClassCurriculum({ institutionId: id, classId, curriculumId: parsed.data.curriculumId, actorUserId: guard.actor.id }) });
  } catch (error) {
    return governedError(error);
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const POST = withAiRequestMetrics('POST /api/institutions/[id]/classes/[classId]/curriculum', handlePOST);
