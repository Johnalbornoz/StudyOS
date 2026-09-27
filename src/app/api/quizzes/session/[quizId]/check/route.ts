/**
 * POST /api/quizzes/session/[quizId]/check -- immediate, per-question
 * feedback for ASSISTED activities (evidence mode PRACTICE, e.g. the
 * canonical LEARN_CHECK comprehension checkpoint).
 *
 * Read-only for learning state: grades one answer with the SAME grader
 * submission uses (src/lib/quiz/grade-question.ts) and returns
 * correct/almost/incorrect plus NON-REVEALING help: why the answer does not
 * work, a conceptual direction and a progressive scaffold -- never the
 * answer key (every text passes feedback-leak-guard.ts). The stored
 * solution/explanation is NOT sent here; only the final review shows it.
 * It writes NO learning evidence, error, misconception or progression --
 * the activity's single evidence write stays the final submission, so an
 * answer is never counted twice. The client locks the answer once checked,
 * so the recorded answer is always the first attempt.
 *
 * Independent/assessment activities (Prove/Retain/Transfer) never get
 * per-question feedback (409 FEEDBACK_DEFERRED) -- they are independence
 * checks; their feedback comes after submission.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAuth, checkRateLimit } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { isOwner } from '@/lib/authorization';
import { canUseCapability } from '@/lib/entitlements';
import { getQuizSession } from '@/services/quiz-persistence.service';
import { gradeQuizAnswer } from '@/lib/quiz/grade-question';
import { stripAnswerReveals } from '@/lib/quiz/feedback-leak-guard';
import { generateQuestionHint } from '@/services/quiz-generation.service';

const CheckSchema = z.object({
  studentId: z.string().uuid(),
  questionIndex: z.number().int().min(0),
  answer: z.string().min(1).max(20_000),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ quizId: string }> }) {
  const { quizId } = await params;
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  let body: z.infer<typeof CheckSchema>;
  try {
    body = CheckSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  }

  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);
  if (!(await isOwner(actor.id, body.studentId))) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  if (!(await canUseCapability(actor.id, body.studentId, 'LEARNING_FULL_ACCESS'))) {
    return NextResponse.json({ error: 'ENTITLEMENT_REQUIRED' }, { status: 403 });
  }
  if (!checkRateLimit(actor.id, 'quiz-answer-check', 30, 60)) {
    return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 });
  }

  const session = await getQuizSession(quizId);
  if (!session || session.studentId !== body.studentId) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  if (session.status !== 'active' || new Date(session.expiresAt).getTime() < Date.now()) {
    return NextResponse.json({ error: 'SESSION_NOT_ACTIVE' }, { status: 409 });
  }
  if (session.evidenceMode !== 'PRACTICE') {
    return NextResponse.json({ error: 'FEEDBACK_DEFERRED' }, { status: 409 });
  }
  const question = session.questions[body.questionIndex];
  if (!question) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });

  const grade = await gradeQuizAnswer(question, body.answer, session.language, session.evidenceMode, {
    studentId: body.studentId,
    subjectId: session.subjectId,
  });

  const guardQuestion = { answerFormat: question.answerFormat, correctAnswer: question.correctAnswer, options: question.options, explanation: question.explanation };

  // Wrong/partial: why it does not work + a conceptual direction + a
  // progressive scaffold, all from non-revealing sources and all filtered
  // by the leak guard. The hint model is instructed never to state or imply
  // the answer; the guard enforces it regardless.
  let direction: string | null = null;
  let scaffold: string[] = [];
  if (!grade.correct) {
    const hints = await generateQuestionHint(question, session.language, undefined, {
      studentId: body.studentId,
      subjectId: session.subjectId,
      conceptId: session.conceptId ?? undefined,
      sourceId: quizId,
    }).catch(() => [] as string[]);
    const safeHints = hints.map((h) => stripAnswerReveals(h, guardQuestion)).filter((h): h is string => !!h);
    direction = safeHints[0] ?? null;
    scaffold = safeHints.slice(1);
  }

  return NextResponse.json({
    success: true,
    data: {
      correct: grade.correct,
      partial: !grade.correct && grade.score > 0,
      // why the answer does (not) work -- revealing sentences removed
      feedback: grade.correct ? grade.feedback || null : stripAnswerReveals(grade.feedback, guardQuestion),
      direction,
      scaffold,
    },
  });
}
