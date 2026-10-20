/** Track A -- POST { canonicalConceptId, classification?, period? }: add / restore / classify an existing concept of the curriculum's subject. */
import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { allUuids, readJson, requireInstitutionAdminActor } from '@/lib/institution/route-guard';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { setCurriculumConcept, CurriculumError, CURRICULUM_CLASSIFICATIONS } from '@/lib/learning-plan/institution-curriculum.service';

function curriculumError(error: unknown) {
  if (error instanceof CurriculumError) return NextResponse.json({ error: error.code }, { status: error.code === 'NOT_FOUND' ? 404 : error.code === 'ALREADY_EXISTS' ? 409 : 422 });
  throw error;
}

const Schema = z.object({ canonicalConceptId: z.string().uuid(), classification: z.enum(CURRICULUM_CLASSIFICATIONS).optional(), period: z.string().trim().max(60).nullable().optional() });

async function handlePOST(request: NextRequest, { params }: { params: Promise<{ id: string; curriculumId: string }> }) {
  const { id, curriculumId } = await params;
  if (!allUuids(id, curriculumId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(id, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  const parsed = Schema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  try {
    await setCurriculumConcept({ ...parsed.data, institutionId: id, curriculumId, actorUserId: guard.actor.id });
    return NextResponse.json({ success: true });
  } catch (error) {
    return curriculumError(error);
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const POST = withAiRequestMetrics('POST /api/institutions/[id]/curricula/[curriculumId]/concepts', handlePOST);
