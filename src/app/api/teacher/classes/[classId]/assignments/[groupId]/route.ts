/**
 * Track A -- PATCH { title?, instructions?, startsAt?, dueAt? }: the Teacher edits one of the class's tasks.
 * Teacher-owned tasks only; an institution task answers 403 FIELD_LOCKED_BY_INSTITUTION (audited).
 */
import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { requireUserActor, readBody, isUuid } from '@/lib/learning-plan/route-actors';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { governedError } from '@/lib/institution/route-errors';
import { updateClassAssignment } from '@/lib/institution/institution-governance.service';

const Schema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  instructions: z.string().trim().max(500).nullable().optional(),
  startsAt: z.string().datetime({ offset: true }).nullable().optional(),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
});

async function handlePATCH(request: NextRequest, { params }: { params: Promise<{ classId: string; groupId: string }> }) {
  const { classId, groupId } = await params;
  const actor = await requireUserActor();
  if ('response' in actor) return actor.response;
  if (!isUuid(classId) || !isUuid(groupId)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const parsed = Schema.safeParse(await readBody(request));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  try {
    return NextResponse.json({ success: true, data: await updateClassAssignment({ teacherUserId: actor.userId, classId, groupId, patch: parsed.data }) });
  } catch (error) {
    return governedError(error);
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const PATCH = withAiRequestMetrics('PATCH /api/teacher/classes/[classId]/assignments/[groupId]', handlePATCH);
