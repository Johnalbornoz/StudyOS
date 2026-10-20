/**
 * POST /api/quizzes/session/[quizId]/answer -- save one answer of a subject Test / Mock server-side (overnight
 * 2026-10-16).
 *
 *   Test ("Prueba por materia")   -> { correct } ONLY: no explanation, no hint, no answer reveal. The first answer is final.
 *   Mock ("Simulacro por materia") -> { saved } only: NO feedback during the attempt.
 *
 * Saved answers are what a timed attempt is graded on when its time runs out (auto-submit), so a lost connection never
 * loses an answer already sent. Past the deadline nothing is saved and the attempt is auto-submitted. Writes no learning
 * evidence (the single evidence write stays the submission). Every other session -> 404 (the assisted per-question
 * check is /check).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAuth, verifyStudentAccess, checkRateLimit } from '@/lib/auth';
import { studentTextSafetyResponse } from '@/lib/safety/safety-route';
import { recordSubjectAssessmentAnswer } from '@/services/subject-assessment.service';
import { db } from '@/lib/db';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

const AnswerSchema = z.object({
  studentId: z.string().uuid(),
  questionIndex: z.number().int().min(0),
  answer: z.string().min(1).max(20_000),
});

async function handlePOST(request: NextRequest, { params }: { params: Promise<{ quizId: string }> }) {
  const { quizId } = await params;
  const auth = await verifyAuth();
  if (!auth) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  let body: z.infer<typeof AnswerSchema>;
  try {
    body = AnswerSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  }
  if (!(await verifyStudentAccess(auth.userId, body.studentId, auth.role))) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  if (!checkRateLimit(auth.userId, 'subject-assessment-answer', 60, 60)) return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 });
  // Human Agency P0-4 (Layer B): deterministic safety gate first, before any grading model.
  const locale = (await db.query(`SELECT language FROM quiz_sessions WHERE id = $1`, [quizId])).rows[0]?.language ?? 'es';
  const safetyBlock = await studentTextSafetyResponse(body.answer, { studentId: body.studentId, surface: 'QUIZ_ANSWER', locale });
  if (safetyBlock) return safetyBlock;
  const r = await recordSubjectAssessmentAnswer({ studentId: body.studentId, quizId, questionIndex: body.questionIndex, answer: body.answer });
  if (!r.ok) return NextResponse.json({ error: r.error, message: r.message, ...(r.detail ? { detail: r.detail } : {}) }, { status: r.status });
  return NextResponse.json({ success: true, data: r.data });
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const POST = withAiRequestMetrics('POST /api/quizzes/session/[quizId]/answer', handlePOST);
