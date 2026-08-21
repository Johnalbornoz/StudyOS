/**
 * POST /api/errors/record
 *
 * Record error occurrence and detect patterns
 *
 * Request body:
 * {
 *   studentId: string
 *   conceptId: string
 *   errorType: 'CONCEPTUAL' | 'PROCEDURAL' | 'CALCULATION' | ...
 *   context: {
 *     question: string
 *     studentAnswer: string
 *     correctAnswer: string
 *     difficulty: 1-5
 *     confidence?: 0-1
 *   }
 * }
 *
 * Response:
 * {
 *   errorId: string
 *   patternCreated: boolean
 *   pattern?: { id, errorType, recurrenceCount, needsAttention }
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { recordError } from '@/services/error-intelligence.service';
import type { ErrorType } from '@/services/error-intelligence.service';
import { z } from 'zod';

const RecordErrorSchema = z.object({
  studentId: z.string().uuid('Invalid studentId'),
  conceptId: z.string().uuid('Invalid conceptId'),
  errorType: z.enum([
    'CONCEPTUAL',
    'PROCEDURAL',
    'CALCULATION',
    'MISINTERPRETATION',
    'PREREQUISITE_GAP',
    'CARELESSNESS',
    'INCOMPLETE_KNOWLEDGE',
  ] as const),
  context: z.object({
    question: z.string().min(1),
    studentAnswer: z.string().min(1),
    correctAnswer: z.string().min(1),
    difficulty: z.number().int().min(1).max(5),
    confidence: z.number().min(0).max(1).optional(),
  }),
});

type RecordErrorRequest = z.infer<typeof RecordErrorSchema>;

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

    // Validate input
    let validated: RecordErrorRequest;
    try {
      validated = RecordErrorSchema.parse(body);
    } catch (error: any) {
      return NextResponse.json(
        {
          error: 'INVALID_INPUT',
          message: error.errors?.[0]?.message || 'Invalid request body',
        },
        { status: 400 }
      );
    }

    // Verify authorization
    const canAccess = await verifyStudentAccess(
      authContext.userId,
      validated.studentId,
      authContext.role
    );

    if (!canAccess) {
      return NextResponse.json(
        {
          error: 'FORBIDDEN',
          message: 'You do not have permission to record errors for this student',
        },
        { status: 403 }
      );
    }

    const result = await recordError(
      validated.studentId,
      validated.conceptId,
      validated.errorType,
      {
        question: validated.context.question,
        studentAnswer: validated.context.studentAnswer,
        correctAnswer: validated.context.correctAnswer,
        difficulty: validated.context.difficulty,
        confidence: validated.context.confidence,
      }
    );

    return NextResponse.json({
      success: true,
      data: {
        errorId: result.errorId,
        patternCreated: result.patternCreated,
        pattern: result.pattern
          ? {
              id: result.pattern.id,
              errorType: result.pattern.errorType,
              recurrenceCount: result.pattern.recurrenceCount,
              lastOccurred: result.pattern.lastOccurred,
              needsAttention: result.pattern.needsAttention,
              message: `Error pattern detected! ${result.pattern.recurrenceCount} occurrences of ${result.pattern.errorType}. Adding to study plan.`,
            }
          : null,
      },
    });
  } catch (error) {
    console.error('Error recording error:', error);
    return NextResponse.json(
      {
        error: 'INTERNAL_ERROR',
        message: 'Failed to record error',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined,
      },
      { status: 500 }
    );
  }
}
