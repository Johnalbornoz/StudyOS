/**
 * F9 -- POST /api/simulation/attempts/[id]/responses
 *
 * Records and grades one item response (task §28). Minimal-flow scope
 * decision matching F8's own precedent: accepts a full GeneratedQuestion
 * (the existing quiz-generation.service.ts shape, never redeclared) so
 * the existing graders can run unmodified.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { canAccessLearner } from '@/lib/authorization';
import { getSimulationAttempt } from '@/lib/simulation/attempt.service';
import { recordSimulationItemResponse } from '@/lib/simulation/scoring.service';

const ResponseSchema = z.object({
  assessmentComponentId: z.string().uuid(),
  learningObjectiveId: z.string().uuid().optional(),
  commandTermId: z.string().uuid().optional(),
  question: z.record(z.string(), z.unknown()),
  studentAnswer: z.string(),
  language: z.string().optional(),
  // Task §54: the client mints this ONCE per logical submission and
  // resends the SAME value on any retry -- never a fresh value per
  // attempt, which would defeat the whole point.
  idempotencyKey: z.string().min(1).max(200).optional(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  const attempt = await getSimulationAttempt(id);
  if (!attempt) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  const allowed = await canAccessLearner(actor.id, attempt.studentId, 'LEARNER_INTERVENTION_CREATE');
  if (!allowed) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  if (attempt.status !== 'ACTIVE') return NextResponse.json({ error: 'ATTEMPT_NOT_ACTIVE' }, { status: 409 });

  let validated;
  try {
    validated = ResponseSchema.parse(await request.json());
  } catch (error: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.errors?.[0]?.message }, { status: 400 });
  }

  const { responseId, evaluation, evidenceWritten, duplicate } = await recordSimulationItemResponse({
    examAttemptId: attempt.examAttemptId,
    studentId: attempt.studentId,
    examVersionId: attempt.examVersionId,
    assessmentComponentId: validated.assessmentComponentId,
    learningObjectiveId: validated.learningObjectiveId,
    commandTermId: validated.commandTermId,
    question: validated.question as any,
    studentAnswer: validated.studentAnswer,
    language: validated.language,
    idempotencyKey: validated.idempotencyKey,
  });

  return NextResponse.json({ success: true, data: { responseId, evaluation, evidenceWritten, duplicate } });
}
