/**
 * LX-4P-R2 -- POST /api/quizzes/localize-question
 *
 * Same-item localization: return a translated PRESENTATION of a question
 * the learner is already on, so a mid-attempt language change does not
 * regenerate the question or reset the teaching loop.
 *
 * The canonical question is read from the stored `quiz_sessions` row
 * (never trusted from the client). The stored session is NOT modified --
 * grading at submit still runs against the original question in the
 * original language. This endpoint writes nothing.
 *
 * On `{ ok: false }` (unsupported format, provider error, or a failed
 * semantic-integrity check) the client falls back to the LX-4P-R1
 * explicit-restart dialog. A question is never partially localized.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { getQuizSession } from '@/services/quiz-persistence.service';
import { isLocale, LOCALES } from '@/lib/i18n/messages';
import { toClientQuestion } from '@/lib/quiz/client-question';
import { localizeGeneratedQuestion } from '@/services/question-localization.service';

const Schema = z.object({
  studentId: z.string().uuid(),
  quizId: z.string(),
  questionIndex: z.number().int().min(0),
  /** The DISPLAY language to render the question in -- the stored session language is never changed. */
  targetLanguage: z.enum(LOCALES as [string, ...string[]]),
  /** The option ids in their current on-screen order -- preserved so choices don't reshuffle under the learner. */
  optionOrder: z.array(z.string()).optional(),
});

export async function POST(request: NextRequest) {
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  let v: z.infer<typeof Schema>;
  try {
    v = Schema.parse(await request.json());
  } catch (e: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: e.errors?.[0]?.message }, { status: 400 });
  }
  if (!isLocale(v.targetLanguage)) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: 'unsupported targetLanguage' }, { status: 400 });
  }

  if (!(await verifyStudentAccess(authContext.userId, v.studentId, authContext.role))) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const session = await getQuizSession(v.quizId);
  if (!session || session.studentId !== v.studentId) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  const original = session.questions[v.questionIndex];
  if (!original) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  // Already in the requested language -- reshape the stored original, no AI.
  if (session.language === v.targetLanguage) {
    return NextResponse.json({
      success: true,
      data: {
        ok: true,
        targetLanguage: v.targetLanguage,
        question: toClientQuestion(original, v.questionIndex, { optionOrder: v.optionOrder }),
      },
    });
  }

  const result = await localizeGeneratedQuestion({
    question: original,
    // R2R1 R5: displayLanguage is what the learner sees; the stored
    // session.language (sourceLanguage) is unchanged and remains the
    // grading + verification reference.
    displayLanguage: v.targetLanguage,
    sourceLanguage: session.language,
    context: { studentId: v.studentId, subjectId: session.subjectId },
  });

  if (!result.ok) {
    return NextResponse.json({ success: true, data: { ok: false, reason: result.reason } });
  }

  return NextResponse.json({
    success: true,
    data: {
      ok: true,
      targetLanguage: v.targetLanguage,
      question: toClientQuestion(result.question, v.questionIndex, { optionOrder: v.optionOrder }),
    },
  });
}
