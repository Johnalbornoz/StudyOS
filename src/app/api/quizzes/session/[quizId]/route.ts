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
import { toClientQuestion } from '@/lib/quiz/client-question';

export async function GET(request: NextRequest, { params }: { params: Promise<{ quizId: string }> }) {
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
