import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { getQuizSession, recordHintUsed } from '@/services/quiz-persistence.service';
import { generateQuestionHint } from '@/services/quiz-generation.service';
import { canUseAI } from '@/lib/ai-permission-policy';
import { z } from 'zod';

const HintSchema = z.object({
  studentId: z.string().uuid(),
  quizId: z.string(),
  questionIndex: z.number().int().min(0),
  language: z.string().default('en'),
});

export async function POST(request: NextRequest) {
  const authContext = await verifyAuth();
  if (!authContext) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const body = await request.json();
  let validated;
  try {
    validated = HintSchema.parse(body);
  } catch (error: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.errors?.[0]?.message }, { status: 400 });
  }

  const canAccess = await verifyStudentAccess(authContext.userId, validated.studentId, authContext.role);
  if (!canAccess) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const quizSession = await getQuizSession(validated.quizId);
  if (!quizSession || quizSession.studentId !== validated.studentId) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  // Phase 3A: server-side authoritative check -- frontend state (which
  // hint button is even rendered) can never be trusted to enforce this
  // on its own. Denies HINT in every mode except PRACTICE, regardless
  // of which quiz mode the client claims.
  if (!canUseAI({ evidenceMode: quizSession.evidenceMode, feature: 'HINT' })) {
    return NextResponse.json({ error: 'HINTS_DISABLED_FOR_MODE' }, { status: 403 });
  }

  const question = quizSession.questions[validated.questionIndex];
  if (!question) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  try {
    const hints = await generateQuestionHint(question, validated.language);
    recordHintUsed(validated.quizId, validated.questionIndex).catch((err) =>
      console.error('Error recording hint usage:', err)
    );
    return NextResponse.json({ success: true, data: { hints } });
  } catch (error) {
    console.error('Error generating hint:', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
