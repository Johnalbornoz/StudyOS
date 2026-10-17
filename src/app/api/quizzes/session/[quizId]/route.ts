/**
 * F14 -- GET /api/quizzes/session/[quizId]?studentId=...
 *
 * Thin, read-only adapter over the already-certified `getQuizSession`
 * (quiz-persistence.service.ts) so a Teacher-assigned reinforcement
 * quiz's own, already-generated `quizId` (the exact
 * `execution_reference` `startTeacherInterventionExecution` recorded)
 * can be re-opened by the Student, instead of generating a brand new,
 * untracked quiz that `reconcileCompletionsForStudent` would never
 * observe as completed. Introduces no generation/grading logic of its
 * own -- `toClientQuestion` is the SAME sanitizer
 * `/api/quizzes/generate-and-take` uses, so the correct answer/order/
 * pairing is stripped here exactly as it is there. Owner-only: a
 * Teacher or Parent never has a legitimate reason to open a Student's
 * in-progress answer sheet.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { isOwner } from '@/lib/authorization';
import { getQuizSession } from '@/services/quiz-persistence.service';
import { isSubjectAssessmentSession, readSubjectAssessmentSession } from '@/services/subject-assessment.service';
import { toClientQuestion } from '@/lib/quiz/client-question';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

async function handleGET(request: NextRequest, { params }: { params: Promise<{ quizId: string }> }) {
  const { quizId } = await params;
  const { searchParams } = new URL(request.url);
  const studentId = searchParams.get('studentId');
  if (!studentId) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });

  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  const allowed = await isOwner(actor.id, studentId);
  if (!allowed) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const session = await getQuizSession(quizId);
  if (!session || session.studentId !== studentId) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  // Overnight 2026-10-16: a subject Test / Mock answers with its lifecycle (scheduled / active / time up / expired /
  // completed), the true remaining time, the saved answers and -- once closed -- the final feedback. A timed attempt
  // past its deadline is auto-submitted HERE, on this read. Questions are sent only while the attempt is active.
  if ((session.quizMode === 'cumulative_assessment' || session.quizMode === 'exam_simulation') && (await isSubjectAssessmentSession(quizId))) {
    const read = await readSubjectAssessmentSession(studentId, quizId);
    if (!read.ok) return NextResponse.json({ error: read.error, message: read.message }, { status: read.status });
    return NextResponse.json({
      success: true,
      data: {
        quizId: session.id, subjectId: session.subjectId, conceptId: null, quizMode: session.quizMode, language: session.language,
        status: read.view.state === 'COMPLETED' ? 'completed' : read.view.state === 'EXPIRED' ? 'expired' : 'active',
        questions: read.view.questions ?? [],
        subjectAssessment: { ...read.view, questions: undefined },
      },
    });
  }

  return NextResponse.json({
    success: true,
    data: {
      quizId: session.id,
      subjectId: session.subjectId,
      conceptId: session.conceptId,
      quizMode: session.quizMode,
      language: session.language,
      status: session.status,
      questions: session.questions.map((q, i) => toClientQuestion(q, i)),
    },
  });
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/quizzes/session/[quizId]', handleGET);
