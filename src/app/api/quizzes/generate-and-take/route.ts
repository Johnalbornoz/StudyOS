/**
 * POST /api/quizzes/generate-and-take
 *
 * Complete quiz flow:
 * 1. Generate questions from concept (using RAG)
 * 2. Store in database (not memory)
 * 3. Return questions to student
 * 4. Student submits answers with quizId
 * 5. Grade all answers from database
 * 6. Update mastery
 * 7. Return results
 *
 * Request body (Generate):
 * {
 *   studentId: string (uuid)
 *   conceptId: string (uuid)
 *   subjectId: string (uuid)
 *   difficulty?: 1-5
 *   language?: 'en'
 * }
 *
 * Request body (Submit):
 * {
 *   studentId: string (uuid)
 *   quizId: string
 *   answers: [
 *     { questionIndex: number, answer: string }
 *   ]
 *   language?: 'en'
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import {
  generateQuestionsForConcept,
  gradeAnswer,
} from '@/services/quiz-generation.service';
import {
  storeQuiz,
  getQuizSession,
  completeQuiz,
} from '@/services/quiz-persistence.service';
import { updateMastery } from '@/services/mastery.service';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { resolveQuizLanguage } from '@/lib/i18n/language';
import type { LearningEvidence } from '@/lib/algorithms/mastery';
import { z } from 'zod';

async function resolveLanguageForSubject(subjectId: string, studentId: string) {
  const result = await db.query(
    `SELECT target_language, quiz_language_mode FROM subjects WHERE id = $1`,
    [subjectId]
  );
  const subject = result.rows[0] || {};
  const interfaceLanguage = await getInterfaceLanguage(studentId);
  return resolveQuizLanguage(subject, interfaceLanguage);
}

const GenerateQuizSchema = z.object({
  studentId: z.string().uuid(),
  conceptId: z.string().uuid(),
  subjectId: z.string().uuid(),
  difficulty: z.number().int().min(1).max(5).optional(),
  language: z.string().optional(),
});

const SubmitQuizSchema = z.object({
  studentId: z.string().uuid(),
  quizId: z.string(),
  answers: z.array(
    z.object({
      questionIndex: z.number().int().min(0),
      answer: z.string(),
    })
  ),
  language: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    // Verify authentication
    const authContext = await verifyAuth();
    if (!authContext) {
      return NextResponse.json(
        { error: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json();

    // Determine if generating or submitting
    if (!body.quizId) {
      // STEP 1: Generate Quiz
      return await handleGenerateQuiz(body, authContext.userId, authContext.role);
    } else {
      // STEP 2: Submit & Grade Quiz
      return await handleSubmitQuiz(body, authContext.userId, authContext.role);
    }
  } catch (error) {
    console.error('Error in quiz flow:', error);
    return NextResponse.json(
      {
        error: 'INTERNAL_ERROR',
        message: 'Failed to process quiz',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined,
      },
      { status: 500 }
    );
  }
}

async function handleGenerateQuiz(body: any, userId: string, role: string) {
  try {
    const validated = GenerateQuizSchema.parse(body);

    // Verify authorization
    const canAccess = await verifyStudentAccess(userId, validated.studentId, role);
    if (!canAccess) {
      return NextResponse.json(
        { error: 'FORBIDDEN', message: 'Cannot access this student' },
        { status: 403 }
      );
    }

    // Resolve the right language: the subject's own language if it IS a
    // language course (e.g. German class -> always German), otherwise the
    // student's interface language or a fixed language per their preference.
    const language = await resolveLanguageForSubject(validated.subjectId, validated.studentId);

    // Generate questions using RAG
    const questions = await generateQuestionsForConcept(
      validated.conceptId,
      validated.studentId,
      validated.subjectId,
      {
        count: 5,
        difficulty: validated.difficulty || 3,
        language,
      }
    );

    if (questions.length === 0) {
      return NextResponse.json(
        {
          error: 'GENERATION_FAILED',
          message: 'Failed to generate quiz questions',
        },
        { status: 500 }
      );
    }

    // Store quiz in database (not memory)
    const quizId = await storeQuiz(
      validated.studentId,
      validated.conceptId,
      validated.subjectId,
      questions
    );

    return NextResponse.json({
      success: true,
      data: {
        quizId,
        quiz: {
          conceptId: validated.conceptId,
          questions: questions.map((q, i) => ({
            index: i,
            question: q.question,
            type: q.type,
            options: q.options,
            difficulty: q.difficulty,
          })),
          count: questions.length,
        },
        message: 'Quiz generated. Submit answers with this quizId to complete.',
      },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'INVALID_INPUT', message: error.errors[0]?.message },
        { status: 400 }
      );
    }
    throw error;
  }
}

async function handleSubmitQuiz(body: any, userId: string, role: string) {
  try {
    const validated = SubmitQuizSchema.parse(body);

    // Verify authorization
    const canAccess = await verifyStudentAccess(userId, validated.studentId, role);
    if (!canAccess) {
      return NextResponse.json(
        { error: 'FORBIDDEN', message: 'Cannot access this student' },
        { status: 403 }
      );
    }

    // Retrieve quiz session from database (questions + conceptId/subjectId)
    const quizSession = await getQuizSession(validated.quizId);
    if (!quizSession) {
      return NextResponse.json(
        {
          error: 'QUIZ_NOT_FOUND',
          message: 'Quiz expired or not found. Generate a new quiz.',
        },
        { status: 400 }
      );
    }
    const cachedQuestions = quizSession.questions;

    const language = await resolveLanguageForSubject(quizSession.subjectId, validated.studentId);

    // Grade all answers
    let correctCount = 0;
    let incorrectCount = 0;
    const gradings: any[] = [];

    for (const answer of validated.answers) {
      const question = cachedQuestions[answer.questionIndex];
      if (!question) continue;

      const gradeResult = await gradeAnswer(
        question,
        answer.answer,
        language
      );

      gradings.push({
        questionIndex: answer.questionIndex,
        correct: gradeResult.correct,
        score: gradeResult.score,
        feedback: gradeResult.feedback,
        confidence: gradeResult.confidence,
      });

      if (gradeResult.score >= 0.5) {
        correctCount++;
      } else {
        incorrectCount++;
      }
    }

    const totalQuestions = validated.answers.length;
    const score = Math.round((correctCount / totalQuestions) * 100);

    // Update mastery based on quiz result
    const evidence: LearningEvidence = {
      result:
        score >= 70 ? 'correct' : score >= 50 ? 'partial' : 'incorrect',
      difficulty: 3,
      sourceType: 'PRACTICE_QUIZ',
      confidenceWeight: 0.9,
    };

    const masteryResult = await updateMastery({
      studentId: validated.studentId,
      conceptId: quizSession.conceptId,
      subjectId: quizSession.subjectId,
      evidence,
    });

    // Mark quiz as completed
    await completeQuiz(validated.quizId);

    return NextResponse.json({
      success: true,
      data: {
        quizId: validated.quizId,
        results: {
          score,
          correctCount,
          incorrectCount,
          totalQuestions,
          gradings,
        },
        mastery: {
          previous: masteryResult.oldMastery,
          current: masteryResult.newMastery,
          delta: masteryResult.delta,
        },
        messageKey: score >= 80 ? 'excellent' : score >= 50 ? 'good' : 'keep_going',
      },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'INVALID_INPUT', message: error.errors[0]?.message },
        { status: 400 }
      );
    }
    throw error;
  }
}
