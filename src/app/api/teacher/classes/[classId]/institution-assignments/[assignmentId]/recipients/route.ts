/** Track A -- POST { studentIds?: uuid[] }: the Teacher's only action on an institution task -- choose recipients (whole class when omitted). */
import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { requireUserActor, readBody, isUuid } from '@/lib/learning-plan/route-actors';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { governedError } from '@/lib/institution/route-errors';
import { addInstitutionAssignmentRecipients } from '@/lib/institution/institution-governance.service';

const Schema = z.object({ studentIds: z.array(z.string().uuid()).max(500).nullable().optional() }).strict();

async function handlePOST(request: NextRequest, { params }: { params: Promise<{ classId: string; assignmentId: string }> }) {
  const { classId, assignmentId } = await params;
  const actor = await requireUserActor();
  if ('response' in actor) return actor.response;
  if (!isUuid(classId) || !isUuid(assignmentId)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const parsed = Schema.safeParse((await readBody(request)) ?? {});
  if (!parsed.success) return NextResponse.json({ error: 'FIELD_LOCKED_BY_INSTITUTION' }, { status: 403 });
  try {
    const r = await addInstitutionAssignmentRecipients({ teacherUserId: actor.userId, assignmentId, classId, studentIds: parsed.data.studentIds ?? null });
    return NextResponse.json({ success: true, data: r });
  } catch (error) {
    return governedError(error);
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const POST = withAiRequestMetrics('POST /api/teacher/classes/[classId]/institution-assignments/[assignmentId]/recipients', handlePOST);
