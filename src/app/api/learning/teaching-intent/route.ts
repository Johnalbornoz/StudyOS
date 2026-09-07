/**
 * LX-4R R1 -- learner-safe Teaching Experience for the active quiz.
 *
 * The client never sees a raw `TeachingIntent` (strategy, avoidStrategies,
 * successCriteria, policyVersion, misconception codes, ...). This route
 * fetches the canonical `TeachingIntent` for the quiz's concept
 * (`getTeachingIntentForConcept` -- the same call `/api/quizzes/hint`
 * already makes) and returns ONLY the derived presentation config from
 * `deriveTeachingExperience`. The UI renders support; it never computes
 * `SupportLevel`.
 *
 * `conceptId` + `evidenceMode` are read from the canonical `quiz_sessions`
 * row (fixed at generation), never trusted from the client.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { getQuizSession } from '@/services/quiz-persistence.service';
import { getTeachingIntentForConcept } from '@/services/adaptive-teaching.service';
import { deriveTeachingExperience } from '@/lib/lx/teaching-experience';

export async function GET(request: NextRequest) {
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const studentId = searchParams.get('studentId');
  const quizId = searchParams.get('quizId');
  if (!studentId || !quizId) {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  }

  const canAccess = await verifyStudentAccess(authContext.userId, studentId, authContext.role);
  if (!canAccess) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const quizSession = await getQuizSession(quizId);
  if (!quizSession || quizSession.studentId !== studentId) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  // Multi-concept sessions (assessment / exam) are always INDEPENDENT/
  // ASSESSMENT and have no single concept to teach -> no teaching view.
  if (!quizSession.conceptId) {
    return NextResponse.json({ success: true, data: { teachingExperience: null } });
  }

  // Same call, same accepted background-write caveat as /api/quizzes/hint.
  const intent = await getTeachingIntentForConcept(studentId, quizSession.conceptId).catch(() => null);
  if (!intent) {
    return NextResponse.json({ success: true, data: { teachingExperience: null } });
  }

  const teachingExperience = deriveTeachingExperience({
    supportLevel: intent.supportLevel,
    explanationDepth: intent.explanationDepth,
    evidenceMode: quizSession.evidenceMode,
    primaryBarrier: intent.primaryBarrier,
    hasActiveMisconception: intent.misconceptionCodes.length > 0,
  });

  return NextResponse.json({ success: true, data: { teachingExperience } });
}
