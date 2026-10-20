/**
 * Exam V2 -- POST /api/exams/concept-requests  ("Añadir a mi plan")
 *
 * For an objective from the Student's own scored attempt that has no concept
 * they can study yet: files (or joins) a governed LearningConceptProposal.
 * Never creates a canonical concept. Owner-only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireActor, ownStudentId } from '@/lib/exam-core/route-auth';
import { requestConceptForObjective } from '@/lib/exam-core/learning-bridge.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

const Schema = z.strictObject({ simulationAttemptId: z.string().uuid(), learningObjectiveId: z.string().uuid() });

async function handlePOST(request: NextRequest) {
  const gate = await requireActor('/api/exams/concept-requests', 30);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const parsed = Schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  const studentId = await ownStudentId(gate.actorUserId);
  if (!studentId) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  // The objective must belong to the Student's own scored attempt.
  const ok = await db.query(
    `SELECT sa.exam_attempt_id FROM simulation_attempts sa JOIN exam_attempt_results r ON r.exam_attempt_id = sa.exam_attempt_id AND r.status = 'SCORED'
      WHERE sa.id = $1 AND sa.student_id = $2 AND EXISTS (SELECT 1 FROM jsonb_array_elements(r.objective_results) o WHERE o->>'learningObjectiveId' = $3)`,
    [parsed.data.simulationAttemptId, studentId, parsed.data.learningObjectiveId]
  );
  if (!ok.rows[0]) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const out = await requestConceptForObjective({ studentId, learningObjectiveId: parsed.data.learningObjectiveId, examAttemptId: ok.rows[0].exam_attempt_id });
  return NextResponse.json({ success: true, data: out });
}

export const POST = withAiRequestMetrics('POST /api/exams/concept-requests', handlePOST);
