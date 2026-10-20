/** Track A -- POST: a coordinator proposes a concept that does not exist (StudyUs reviews; existing equivalents suggested). */
import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { allUuids, readJson, requireInstitutionAdminActor } from '@/lib/institution/route-guard';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { createConceptProposal } from '@/lib/learning-plan/concept-proposals.service';

const Schema = z.object({
  title: z.string().trim().min(2).max(200),
  canonicalSubjectId: z.string().uuid().nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  topic: z.string().trim().max(200).nullable().optional(),
  rationale: z.string().trim().max(2000).nullable().optional(),
});

async function handlePOST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!allUuids(id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(id, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  const parsed = Schema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  const r = await createConceptProposal({ ...parsed.data, canonicalSubjectId: parsed.data.canonicalSubjectId ?? null, requestedByUserId: guard.actor.id, institutionId: id });
  return NextResponse.json({ success: true, data: r }, { status: 201 });
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const POST = withAiRequestMetrics('POST /api/institutions/[id]/concept-proposals', handlePOST);
