/**
 * POST /api/quizzes/verify
 *
 * Submits a student's answer to a verification question that was
 * triggered during an Assessment-mode attempt (Cumulative Assessment
 * or Mock Exam) -- see src/services/assessment-verification.service.ts
 * for the full chain. This route never trusts a client-supplied
 * confidence value: it looks up the pending verification_attempts row
 * (created server-side when the trigger fired) for the original score
 * and the "before" Assessment Confidence, grades the new answer itself,
 * and computes everything server-side.
 *
 * Server remains authoritative throughout: ownership is checked via
 * the quiz session (never another student's attempt), the attempt's
 * Evidence Mode must already be ASSESSMENT (immutable, set at
 * storeQuiz time -- this route can't change it), and the resulting
 * evidence goes through the exact same updateMastery pipeline every
 * other feature uses. This route never sets mastery or Knowledge State
 * directly.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { getQuizSession } from '@/services/quiz-persistence.service';
import { gradeAnswer, gradeStructuredAnswer, type GeneratedQuestion } from '@/services/quiz-generation.service';
import {
  getPendingVerificationAttempt,
  resolveVerificationAttempt,
  interpretVerificationOutcome,
  recalculateConfidenceAfterVerification,
  submitQualifiedAssessmentEvidence,
} from '@/services/assessment-verification.service';
import { z } from 'zod';

const VerifySchema = z.object({
  studentId: z.string().uuid(),
  quizId: z.string(),
  conceptId: z.string().uuid(),
  answer: z.string(),
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
    validated = VerifySchema.parse(body);
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

  // Verification only ever applies to Assessment-mode attempts -- a
  // client can't request/submit one for a Practice or Independent
  // session no matter what it claims, since Evidence Mode is immutable
  // and read straight from the persisted attempt, not from the request.
  if (quizSession.evidenceMode !== 'ASSESSMENT') {
    return NextResponse.json({ error: 'VERIFICATION_NOT_APPLICABLE_FOR_MODE' }, { status: 403 });
  }

  const pending = await getPendingVerificationAttempt(validated.quizId, validated.conceptId, validated.studentId);
  if (!pending) {
    return NextResponse.json({ error: 'NO_PENDING_VERIFICATION' }, { status: 404 });
  }

  const verificationQuestion = pending.verificationQuestion as GeneratedQuestion;

  try {
    const grade =
      verificationQuestion.answerFormat === 'text'
        ? await gradeAnswer(verificationQuestion, validated.answer, validated.language)
        : { ...gradeStructuredAnswer(verificationQuestion, validated.answer), confidence: 1, errorType: null, reasoningValid: true };

    const verificationScorePercent = Math.round(grade.score * 100);
    const outcome = interpretVerificationOutcome(pending.originalScorePercent, verificationScorePercent);
    const assessmentConfidenceAfter = recalculateConfidenceAfterVerification(pending.assessmentConfidenceBefore, outcome);

    await resolveVerificationAttempt(pending.id, {
      verificationResponse: validated.answer,
      gradingConfidence: grade.confidence,
      outcome,
      assessmentConfidenceAfter,
    });

    // The verification answer is itself real evidence -- SOLO_VERIFICATION
    // already means exactly this ("the deliberate 'prove it independently'
    // check", 0.9 source weight) and is reused rather than inventing a
    // new source type. This is a new, append-only evidence event; the
    // original assessment evidence (submitted earlier, before
    // verification triggered) is never rewritten.
    const masteryResult = await submitQualifiedAssessmentEvidence({
      studentId: validated.studentId,
      conceptId: validated.conceptId,
      subjectId: quizSession.subjectId,
      sourceType: 'SOLO_VERIFICATION',
      scorePercent: verificationScorePercent,
      difficulty: verificationQuestion.difficulty,
      sampleSize: 1,
      activityType: quizSession.activityType,
      evidenceMode: quizSession.evidenceMode,
      assessmentConfidence: assessmentConfidenceAfter,
      verificationOutcome: outcome,
    });

    return NextResponse.json({
      success: true,
      data: {
        correct: grade.correct,
        feedback: (grade as any).feedback ?? '',
        outcome,
        assessmentConfidenceBefore: pending.assessmentConfidenceBefore,
        assessmentConfidenceAfter,
        mastery: { previous: masteryResult.oldMastery, current: masteryResult.newMastery, delta: masteryResult.delta },
      },
    });
  } catch (error) {
    console.error('Error resolving verification attempt:', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
