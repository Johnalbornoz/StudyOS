/**
 * LX-4R R1 -- learner-safe Teaching Experience for the active learning
 * activity.
 *
 * The client never sees a raw `TeachingIntent` (strategy, avoidStrategies,
 * successCriteria, policyVersion, misconception codes, ...). This route
 * fetches the canonical `TeachingIntent` for the concept
 * (`getTeachingIntentForConcept` -- the same call `/api/quizzes/hint`
 * already makes) and returns ONLY the derived presentation config from
 * `deriveTeachingExperience`. The UI renders support; it never computes
 * `SupportLevel`.
 *
 * LX-4P-PERF-R1 R4: resolvable WITHOUT a quiz session so the teaching
 * stage no longer waits for question generation. Either:
 *   - `quizId`                 -> conceptId + evidenceMode read from the
 *                                 canonical quiz_sessions row (as before), or
 *   - `conceptId` + `mode`     -> evidenceMode derived from the SAME
 *                                 canonical QuizMode->ActivityType->EvidenceMode
 *                                 taxonomy `storeQuiz` itself uses to stamp
 *                                 the row (`evidenceModeForQuizMode`).
 * `conceptId` is authorised by `getTeachingIntentForConcept` (it only
 * yields a decision for a concept genuinely in the student's curriculum).
 * `SupportLevel` still comes only from the canonical `TeachingIntent`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { getQuizSession, evidenceModeForQuizMode, type QuizMode } from '@/services/quiz-persistence.service';
import { getTeachingIntentForConcept } from '@/services/adaptive-teaching.service';
import { deriveTeachingExperience } from '@/lib/lx/teaching-experience';
import type { EvidenceMode } from '@/lib/activity-taxonomy';

const VALID_MODES: ReadonlySet<string> = new Set<QuizMode>([
  'topic_practice', 'review', 'quick_check', 'retention_check',
  'cumulative_assessment', 'exam_simulation', 'diagnostic_check',
]);

export async function GET(request: NextRequest) {
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const studentId = searchParams.get('studentId');
  const quizId = searchParams.get('quizId');
  const conceptIdParam = searchParams.get('conceptId');
  const modeParam = searchParams.get('mode');
  if (!studentId || (!quizId && !conceptIdParam)) {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  }

  const canAccess = await verifyStudentAccess(authContext.userId, studentId, authContext.role);
  if (!canAccess) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  let conceptId: string | null;
  let evidenceMode: EvidenceMode;

  if (quizId) {
    const quizSession = await getQuizSession(quizId);
    if (!quizSession || quizSession.studentId !== studentId) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    conceptId = quizSession.conceptId;
    evidenceMode = quizSession.evidenceMode;
  } else {
    conceptId = conceptIdParam;
    // R4: same fixed canonical taxonomy storeQuiz stamps onto the row.
    const mode = modeParam && VALID_MODES.has(modeParam) ? (modeParam as QuizMode) : 'topic_practice';
    evidenceMode = evidenceModeForQuizMode(mode);
  }

  // Multi-concept sessions (assessment / exam) are always INDEPENDENT/
  // ASSESSMENT and have no single concept to teach -> no teaching view.
  if (!conceptId) {
    return NextResponse.json({ success: true, data: { teachingExperience: null } });
  }

  // Same call, same accepted background-write caveat as /api/quizzes/hint.
  const intent = await getTeachingIntentForConcept(studentId, conceptId).catch(() => null);
  if (!intent) {
    return NextResponse.json({ success: true, data: { teachingExperience: null } });
  }

  const teachingExperience = deriveTeachingExperience({
    supportLevel: intent.supportLevel,
    explanationDepth: intent.explanationDepth,
    evidenceMode,
    primaryBarrier: intent.primaryBarrier,
    hasActiveMisconception: intent.misconceptionCodes.length > 0,
  });

  return NextResponse.json({ success: true, data: { teachingExperience } });
}
