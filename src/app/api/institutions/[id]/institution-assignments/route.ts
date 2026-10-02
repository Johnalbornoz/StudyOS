/**
 * Track A -- institution tasks.
 * GET: list with per-class recipients. POST { canonicalConceptId, title, instructions?, startsAt?, dueAt?, period?, priority?, required?,
 *   deliveryMode: TEACHER_SELECTS_RECIPIENTS | DIRECT_ALL_STUDENTS, classIds[], requestId? } (idempotent by requestId).
 */
import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { allUuids, readJson, requireInstitutionAdminActor } from '@/lib/institution/route-guard';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { governedError } from '@/lib/institution/route-errors';
import { createInstitutionAssignment, listInstitutionAssignments } from '@/lib/institution/institution-governance.service';

const Schema = z.object({
  canonicalConceptId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  instructions: z.string().trim().max(1000).nullable().optional(),
  startsAt: z.string().datetime({ offset: true }).nullable().optional(),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  period: z.string().trim().max(60).nullable().optional(),
  priority: z.enum(['HIGH', 'NORMAL', 'LOW']).optional(),
  required: z.boolean().optional(),
  deliveryMode: z.enum(['TEACHER_SELECTS_RECIPIENTS', 'DIRECT_ALL_STUDENTS']),
  classIds: z.array(z.string().uuid()).min(1).max(100),
  requestId: z.string().uuid().nullable().optional(),
});

async function handleGET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!allUuids(id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(id, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  const locale = await getUserInterfaceLanguage(guard.actor.id).catch(() => 'es' as const);
  return NextResponse.json({ success: true, data: { assignments: await listInstitutionAssignments(id, locale) } });
}

async function handlePOST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!allUuids(id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(id, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  const parsed = Schema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  try {
    const r = await createInstitutionAssignment({ institutionId: id, actorUserId: guard.actor.id, ...parsed.data });
    return NextResponse.json({ success: true, data: r }, { status: r.replayed ? 200 : 201 });
  } catch (error) {
    return governedError(error);
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/institutions/[id]/institution-assignments', handleGET);
export const POST = withAiRequestMetrics('POST /api/institutions/[id]/institution-assignments', handlePOST);
