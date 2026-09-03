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
import { recordDecisionEvent } from '@/lib/audit';
import { normalizeResponseTiming } from '@/lib/algorithms/response-timing';
import { z } from 'zod';

const VerifySchema = z.object({
  studentId: z.string().uuid(),
  quizId: z.string(),
  conceptId: z.string().uuid(),
  answer: z.string(),
  language: z.string().default('en'),
  // Phase 1D: loose optional strings, deliberately not z.string().datetime()
  // -- a malformed timestamp must degrade to a quality label
  // (normalizeResponseTiming), never fail this request.
  questionPresentedAt: z.string().optional(),
  answerSubmittedAt: z.string().optional(),
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
        ? await gradeAnswer(verificationQuestion, validated.answer, validated.language, {
            studentId: validated.studentId,
            subjectId: quizSession.subjectId,
          })
        : { ...gradeStructuredAnswer(verificationQuestion, validated.answer), confidence: 1, errorType: null, reasoningValid: true };

    const verificationScorePercent = Math.round(grade.score * 100);
    const outcome = interpretVerificationOutcome(pending.originalScorePercent, verificationScorePercent);
    // Phase 3C.4: variantEquivalenceConfidence is null exactly when the
    // verification question fell back to the original question verbatim
    // (generateQuestionVariant failed to produce an equivalent variant --
    // see generate-and-take/route.ts's trigger block). A same-question
    // re-ask can't provide fresh independent confirmation, so a CONFIRMED
    // outcome earned that way must not receive the same confidence boost
    // a genuine fresh-variant CONFIRMED earns (CONTRADICTED is unaffected
    // -- see recalculateConfidenceAfterVerification's doc comment).
    const wasFreshQuestion = pending.variantEquivalenceConfidence !== null;
    const assessmentConfidenceAfter = recalculateConfidenceAfterVerification(
      pending.assessmentConfidenceBefore,
      outcome,
      wasFreshQuestion
    );

    // Phase 2B: defense-in-depth against the concurrent-duplicate race
    // (two requests both reading `outcome IS NULL` before either
    // writes) -- resolveVerificationAttempt's own WHERE clause is the
    // atomic claim here, same principle as updateMastery's
    // operation_key gate below. If a concurrent request already won,
    // this one still safely produces evidence exactly once (the real
    // guarantee), it just doesn't get to claim the verification_attempts
    // row's own outcome/response fields too.
    const resolvedHere = await resolveVerificationAttempt(pending.id, {
      verificationResponse: validated.answer,
      gradingConfidence: grade.confidence,
      outcome,
      assessmentConfidenceAfter,
    });

    // Phase 0E2 Step 17: verification_attempts (above) remains the
    // domain transaction; this is why the system resolved it the way
    // it did -- the actual outcome/confidence values, never redecided.
    // Phase 2B: only when THIS request actually won the resolution
    // race (resolvedHere) -- a request that lost it must not record a
    // second VERIFICATION_RESOLVED decision event for the attempt
    // another request already resolved.
    if (resolvedHere) {
      await recordDecisionEvent({
        decisionType: 'VERIFICATION_RESOLVED',
        engine: 'verification-engine',
        engineVersion: 'v1',
        studentId: validated.studentId,
        subjectId: quizSession.subjectId,
        conceptId: validated.conceptId,
        sourceEventType: 'verification_attempts',
        sourceEventId: pending.id,
        previousState: { assessmentConfidenceBefore: pending.assessmentConfidenceBefore, originalScorePercent: pending.originalScorePercent },
        newState: { outcome, assessmentConfidenceAfter, verificationScorePercent },
        reasonCode: outcome,
        // Phase 3C.4: auditable record of whether this CONFIRMED/CONTRADICTED
        // decision was based on a fresh, equivalence-checked verification
        // question or a same-question fallback -- needed to explain why a
        // CONFIRMED outcome here may show no confidence movement.
        // Phase 3-R Finding 1: also records explicitly whether this
        // resolution produced qualified cognitive evidence at all (see
        // below) -- a future Decision Engine can distinguish
        // CONFIRMED_FRESH from CONFIRMED_SAME_QUESTION from these two
        // existing fields without a second outcome taxonomy (§1.5).
        reasonDetails: { wasFreshQuestion, qualifiesAsCognitiveEvidence: wasFreshQuestion },
        aiExecutionId: 'aiExecution' in grade ? grade.aiExecution?.aiExecutionId ?? null : null,
      });
    }

    // Phase 3-R Finding 1: a same-question fallback verification (the
    // student re-answered the EXACT question they had just answered,
    // because generateQuestionVariant could not produce a genuinely
    // equivalent fresh item) is not a fresh independent demonstration --
    // the student can simply recall or repeat their own prior response.
    // Phase 3 already stopped it from earning a confidence BOOST
    // (recalculateConfidenceAfterVerification above), but that alone did
    // not stop it from still producing real SOLO_VERIFICATION cognitive
    // evidence -- submitQualifiedAssessmentEvidence was previously called
    // unconditionally here, so a same-question CONFIRMED still applied a
    // real (unboosted-but-nonzero) confidenceWeight to updateMastery,
    // which can move Mastery, contribute Independence evidence, and
    // resolve an active misconception (isMisconceptionResolutionEvidence
    // treats any 'correct'-result SOLO_VERIFICATION evidence as
    // resolving evidence, regardless of question freshness). That is
    // exactly the false-independence path this finding closes.
    //
    // wasFreshQuestion === false: the attempt still resolves its
    // Assessment outcome and Assessment Confidence above (real
    // reliability signal -- a same-question CONTRADICTED is still
    // meaningful evidence of inconsistency), but produces NO cognitive
    // mutation of any kind -- no learning_evidence row, no Mastery
    // delta, no Independence evidence, no Knowledge State projection,
    // no misconception resolution, no learning-debt effect. Never
    // relabeled into a different sourceType to smuggle it through --
    // this measurement is simply INSUFFICIENT/NON-QUALIFYING and stays
    // that way; `mastery: null` in the response is the honest reflection
    // of "no evidence was produced," not a fabricated zero-delta.
    const masteryResult = wasFreshQuestion
      ? await submitQualifiedAssessmentEvidence({
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
          // Phase 3C.4: records whether THIS verification's own question was
          // a fresh, equivalence-checked variant or a same-question fallback
          // -- an auditability property of the verification evidence itself,
          // independent of whatever variant confidence the ORIGINAL assessment
          // question's own evidence row may separately carry. Always non-null
          // here since this branch only runs when wasFreshQuestion is true.
          variantEquivalenceConfidence: pending.variantEquivalenceConfidence,
          // Phase 3-R: the verification question's own cognitive-level tag
          // (when the AI generation step produced one), carried through so
          // a fresh verification can genuinely contribute to Finding 3's
          // bounded cognitive-demand summary -- never fabricated when absent.
          cognitiveLevel: (verificationQuestion as any).cognitiveLevel ?? null,
          aiExecution: 'aiExecution' in grade ? grade.aiExecution : undefined,
          verificationAttemptId: pending.id,
          // Phase 1D: normalized once here, next to the raw client input --
          // the clock already stopped client-side before this request was
          // sent, so this never measures grading/AI latency (Step 13/14).
          responseTiming: normalizeResponseTiming({
            questionPresentedAt: validated.questionPresentedAt,
            answerSubmittedAt: validated.answerSubmittedAt,
          }),
        })
      : null;

    return NextResponse.json({
      success: true,
      data: {
        correct: grade.correct,
        feedback: (grade as any).feedback ?? '',
        outcome,
        assessmentConfidenceBefore: pending.assessmentConfidenceBefore,
        assessmentConfidenceAfter,
        wasFreshQuestion,
        qualifiesAsCognitiveEvidence: wasFreshQuestion,
        mastery: masteryResult ? { previous: masteryResult.oldMastery, current: masteryResult.newMastery, delta: masteryResult.delta } : null,
      },
    });
  } catch (error) {
    console.error('Error resolving verification attempt:', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
