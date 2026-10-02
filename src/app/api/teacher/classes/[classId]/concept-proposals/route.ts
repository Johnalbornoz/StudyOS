/** Track A -- POST: the class's Teacher proposes a concept that does not exist (StudyUS reviews; existing equivalents suggested). */
import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { requireUserActor, readBody, isUuid } from '@/lib/learning-plan/route-actors';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { getTeacherClass } from '@/lib/teacher/class-assignment.service';
import { createConceptProposal } from '@/lib/learning-plan/concept-proposals.service';

const Schema = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  topic: z.string().trim().max(200).nullable().optional(),
  rationale: z.string().trim().max(2000).nullable().optional(),
});

async function handlePOST(request: NextRequest, { params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  const actor = await requireUserActor();
  if ('response' in actor) return actor.response;
  if (!isUuid(classId)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const klass = await getTeacherClass(actor.userId, classId);
  if (!klass) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const parsed = Schema.safeParse(await readBody(request));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  const r = await createConceptProposal({
    ...parsed.data,
    canonicalSubjectId: klass.subjectId,
    academicContext: { className: klass.name, grade: klass.gradeName, institution: klass.institutionName },
    requestedByUserId: actor.userId,
    institutionId: klass.institutionId,
    classId,
  });
  return NextResponse.json({ success: true, data: r }, { status: 201 });
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const POST = withAiRequestMetrics('POST /api/teacher/classes/[classId]/concept-proposals', handlePOST);
