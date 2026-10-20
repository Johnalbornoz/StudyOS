/** Track A -- POST: retire a concept from the institutional curriculum (audited; learner histories untouched). */
import { NextRequest, NextResponse } from 'next/server';
import { allUuids, requireInstitutionAdminActor } from '@/lib/institution/route-guard';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { removeCurriculumConcept, CurriculumError } from '@/lib/learning-plan/institution-curriculum.service';

function curriculumError(error: unknown) {
  if (error instanceof CurriculumError) return NextResponse.json({ error: error.code }, { status: error.code === 'NOT_FOUND' ? 404 : error.code === 'ALREADY_EXISTS' ? 409 : 422 });
  throw error;
}

async function handlePOST(_request: NextRequest, { params }: { params: Promise<{ id: string; curriculumId: string; conceptId: string }> }) {
  const { id, curriculumId, conceptId } = await params;
  if (!allUuids(id, curriculumId, conceptId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(id, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  try {
    const ok = await removeCurriculumConcept({ institutionId: id, curriculumId, canonicalConceptId: conceptId, actorUserId: guard.actor.id });
    return ok ? NextResponse.json({ success: true }) : NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  } catch (error) {
    return curriculumError(error);
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const POST = withAiRequestMetrics('POST /api/institutions/[id]/curricula/[curriculumId]/concepts/[conceptId]/remove', handlePOST);
