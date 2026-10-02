/** Track A -- PATCH { title?, instructions?, startsAt?, dueAt?, period?, priority? }: the institution edits its own task (propagated to recipients, audited). */
import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { allUuids, readJson, requireInstitutionAdminActor } from '@/lib/institution/route-guard';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { governedError } from '@/lib/institution/route-errors';
import { updateInstitutionAssignment } from '@/lib/institution/institution-governance.service';

const Schema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  instructions: z.string().trim().max(1000).nullable().optional(),
  startsAt: z.string().datetime({ offset: true }).nullable().optional(),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  period: z.string().trim().max(60).nullable().optional(),
  priority: z.enum(['HIGH', 'NORMAL', 'LOW']).optional(),
});

async function handlePATCH(request: NextRequest, { params }: { params: Promise<{ id: string; assignmentId: string }> }) {
  const { id, assignmentId } = await params;
  if (!allUuids(id, assignmentId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(id, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  const parsed = Schema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  try {
    return NextResponse.json({ success: true, data: await updateInstitutionAssignment({ institutionId: id, actorUserId: guard.actor.id, assignmentId, patch: parsed.data }) });
  } catch (error) {
    return governedError(error);
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const PATCH = withAiRequestMetrics('PATCH /api/institutions/[id]/institution-assignments/[assignmentId]', handlePATCH);
