import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { getQuizSession, recordHintUsed } from '@/services/quiz-persistence.service';
import { generateQuestionHint } from '@/services/quiz-generation.service';
import { canUseAI } from '@/lib/ai-permission-policy';
import { getTeachingIntentForConcept } from '@/services/adaptive-teaching.service';
import { toTeachingGenerationContext } from '@/lib/adaptive-teaching-generation';
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

  // Phase 5-R S10: deterministic stop boundary -- at most one
  // hint-generation event per question, using the session's OWN
  // existing `hintsUsedQuestions` state (Phase 3A, unmodified schema).
  // Not token-based, not a new table: once this question has already
  // produced a hint, further requests return control to the student
  // instead of generating (and paying for) another AI call.
  if (quizSession.hintsUsedQuestions.includes(validated.questionIndex)) {
    return NextResponse.json({ success: true, data: { hints: [], stopped: true, reason: 'MAX_SUPPORT_REACHED' } });
  }

  try {
    // Phase 5-R S1/S2: adaptive teaching context, when Phase 4 has an
    // active decision for this concept (never fabricated when it
    // doesn't -- getTeachingIntentForConcept returns null and this
    // falls back to generateQuestionHint's pre-existing, unadapted
    // behavior, unchanged from before this phase). `quizSession.conceptId`
    // is null only for multi-concept sessions (CUMULATIVE_ASSESSMENT/
    // MOCK_EXAM), which never reach this line -- `canUseAI` above
    // already denied them (evidenceMode !== 'PRACTICE').
    const intent = quizSession.conceptId
      ? await getTeachingIntentForConcept(validated.studentId, quizSession.conceptId).catch(() => null)
      : null;
    const generationContext = intent ? toTeachingGenerationContext(intent) : undefined;

    const hints = await generateQuestionHint(question, validated.language, generationContext, {
      studentId: validated.studentId,
      subjectId: quizSession.subjectId,
      conceptId: quizSession.conceptId ?? undefined,
      sourceId: validated.quizId,
    });
    recordHintUsed(validated.quizId, validated.questionIndex).catch((err) =>
      console.error('Error recording hint usage:', err)
    );
    return NextResponse.json({ success: true, data: { hints } });
  } catch (error) {
    console.error('Error generating hint:', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
