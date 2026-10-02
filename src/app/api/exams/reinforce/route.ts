/**
 * Exam V2 -- POST /api/exams/reinforce  ("Reforzar ahora")
 *
 * For a weak objective of the Student's OWN scored attempt that is mapped
 * (PUBLISHED objective_concept_mappings) to a canonical concept: makes sure
 * the Student studies that concept (existing one, or added through the normal
 * catalogue-mapping path) and returns the concept page in the Learning Engine.
 * Never creates a canonical concept.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireActor, ownStudentId } from '@/lib/exam-core/route-auth';
import { addConceptToStudentLearning } from '@/lib/exam-core/catalog/learning-links.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

const Schema = z.strictObject({ simulationAttemptId: z.string().uuid(), learningObjectiveId: z.string().uuid(), canonicalConceptId: z.string().uuid(), language: z.string().min(2).max(10).default('es') });

async function handlePOST(request: NextRequest) {
  const gate = await requireActor('/api/exams/reinforce', 30);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const parsed = Schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  const studentId = await ownStudentId(gate.actorUserId);
  if (!studentId) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const ok = await db.query(
    `SELECT 1 FROM simulation_attempts sa JOIN exam_attempt_results r ON r.exam_attempt_id = sa.exam_attempt_id AND r.status = 'SCORED'
      WHERE sa.id = $1 AND sa.student_id = $2
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(r.objective_results) o WHERE o->>'learningObjectiveId' = $3)
        AND EXISTS (SELECT 1 FROM objective_concept_mappings m WHERE m.learning_objective_id = $3 AND m.canonical_concept_id = $4 AND m.status = 'PUBLISHED')`,
    [parsed.data.simulationAttemptId, studentId, parsed.data.learningObjectiveId, parsed.data.canonicalConceptId]
  );
  if (ok.rows.length === 0) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  try {
    const r = await addConceptToStudentLearning(studentId, parsed.data.canonicalConceptId, parsed.data.language);
    return NextResponse.json({ success: true, data: { href: `/dashboard/subjects/${r.subjectId}/concepts/${r.studentConceptId}` } });
  } catch (err) {
    const code = (err as Error).message;
    if (code === 'CATALOG_MAPPING_MISMATCH' || code === 'CANONICAL_CONCEPT_NOT_FOUND') return NextResponse.json({ error: code }, { status: 409 });
    throw err;
  }
}

export const POST = withAiRequestMetrics('POST /api/exams/reinforce', handlePOST);
