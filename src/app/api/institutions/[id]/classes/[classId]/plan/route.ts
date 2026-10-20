/**
 * Track A -- POST { canonicalConceptId, priority?, institutionTargetDate?, period?, required? }:
 * institution-owned (locked) content in a class plan. The Teacher sees it read-only.
 */
import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { allUuids, readJson, requireInstitutionAdminActor } from '@/lib/institution/route-guard';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { governedError } from '@/lib/institution/route-errors';
import { setInstitutionClassPlanConcept } from '@/lib/institution/institution-governance.service';

const Schema = z.object({
  canonicalConceptId: z.string().uuid(),
  priority: z.enum(['HIGH', 'NORMAL', 'LOW']).optional(),
  institutionTargetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  period: z.string().trim().max(60).nullable().optional(),
  required: z.boolean().optional(),
});

async function handlePOST(request: NextRequest, { params }: { params: Promise<{ id: string; classId: string }> }) {
  const { id, classId } = await params;
  if (!allUuids(id, classId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(id, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  const parsed = Schema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  try {
    return NextResponse.json({ success: true, data: await setInstitutionClassPlanConcept({ institutionId: id, classId, actorUserId: guard.actor.id, ...parsed.data }) }, { status: 201 });
  } catch (error) {
    return governedError(error);
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const POST = withAiRequestMetrics('POST /api/institutions/[id]/classes/[classId]/plan', handlePOST);
