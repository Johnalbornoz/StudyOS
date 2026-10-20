/**
 * Exam V2 -- POST /api/exams/reinforce  ("Reforzar ahora" / "Añadir a mi plan")
 *
 * For a weak objective of the Student's OWN scored attempt that is mapped
 * (PUBLISHED objective_concept_mappings) to a canonical concept: makes sure
 * the Student studies that concept (existing one, or added through the normal
 * catalogue-mapping path), records the EXAM_GAP provenance once and returns
 * the concept page in the Learning Engine (learning-bridge.service.ts).
 * Never creates a canonical concept.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireActor, ownStudentId } from '@/lib/exam-core/route-auth';
import { reinforceFromExamGap, ReinforceError } from '@/lib/exam-core/learning-bridge.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

const Schema = z.strictObject({ simulationAttemptId: z.string().uuid(), learningObjectiveId: z.string().uuid(), canonicalConceptId: z.string().uuid(), language: z.string().min(2).max(10).default('es') });

async function handlePOST(request: NextRequest) {
  const gate = await requireActor('/api/exams/reinforce', 30);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const parsed = Schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  const studentId = await ownStudentId(gate.actorUserId);
  if (!studentId) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  try {
    const r = await reinforceFromExamGap(studentId, parsed.data);
    return NextResponse.json({ success: true, data: { href: r.href, alreadyStudying: r.alreadyStudying } });
  } catch (err) {
    if (err instanceof ReinforceError) return NextResponse.json({ error: err.code }, { status: err.code === 'NOT_FOUND' ? 404 : 409 });
    throw err;
  }
}

export const POST = withAiRequestMetrics('POST /api/exams/reinforce', handlePOST);
