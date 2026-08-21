/**
 * POST /api/learning/record-evidence
 *
 * Record learning evidence and trigger mastery update
 *
 * Request body:
 * {
 *   studentId: string
 *   conceptId: string
 *   subjectId: string
 *   result: 'correct' | 'incorrect' | 'partial'
 *   difficulty: 1-5
 *   sourceType: 'PRACTICE_QUIZ' | 'PRACTICE_QUESTION' | 'TOPIC_ASSESSMENT' | ...
 *   confidenceWeight?: 0-1
 *   errorClassification?: 'CONCEPTUAL' | 'PROCEDURAL' | ...
 * }
 *
 * Response:
 * {
 *   oldMastery: number
 *   newMastery: number
 *   delta: number
 *   confidenceScore: number
 *   learningDebtCreated: boolean
 *   learningDebtSeverity?: number
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess, checkRateLimit } from '@/lib/auth';
import { updateMastery } from '@/services/mastery.service';
import type { LearningEvidence, EvidenceSourceType } from '@/lib/algorithms/mastery';
import { z } from 'zod';

const RecordEvidenceSchema = z.object({
  studentId: z.string().uuid('Invalid studentId'),
  conceptId: z.string().uuid('Invalid conceptId'),
  subjectId: z.string().uuid('Invalid subjectId'),
  result: z.enum(['correct', 'incorrect', 'partial']),
  difficulty: z.number().int().min(1).max(5),
  sourceType: z.string().min(1),
  confidenceWeight: z.number().min(0).max(1).optional(),
  errorClassification: z.string().optional(),
});

type RecordEvidenceRequest = z.infer<typeof RecordEvidenceSchema>;

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

    // Rate limiting
    if (!checkRateLimit(authContext.userId, '/api/learning/record-evidence', 100, 60)) {
      return NextResponse.json(
        { error: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' },
        { status: 429 }
      );
    }

    const body = await request.json();

    // Validate input with Zod
    let validated: RecordEvidenceRequest;
    try {
      validated = RecordEvidenceSchema.parse(body);
    } catch (error: any) {
      return NextResponse.json(
        {
          error: 'INVALID_INPUT',
          message: error.errors?.[0]?.message || 'Invalid request body',
        },
        { status: 400 }
      );
    }

    // Verify authorization (student can only update their own mastery)
    const canAccess = await verifyStudentAccess(
      authContext.userId,
      validated.studentId,
      authContext.role
    );

    if (!canAccess) {
      return NextResponse.json(
        {
          error: 'FORBIDDEN',
          message: 'You do not have permission to record evidence for this student',
        },
        { status: 403 }
      );
    }

    // Create evidence object
    const evidence: LearningEvidence = {
      result: validated.result,
      difficulty: validated.difficulty,
      sourceType: validated.sourceType as EvidenceSourceType,
      confidenceWeight: validated.confidenceWeight ?? 1.0,
    };

    // Update mastery
    const result = await updateMastery({
      studentId: validated.studentId,
      conceptId: validated.conceptId,
      subjectId: validated.subjectId,
      evidence,
      errorClassification: validated.errorClassification,
    });

    return NextResponse.json({
      success: true,
      data: {
        oldMastery: Math.round(result.oldMastery * 100) / 100,
        newMastery: Math.round(result.newMastery * 100) / 100,
        delta: Math.round(result.delta * 100) / 100,
        confidenceScore: Math.round(result.confidenceScore * 100) / 100,
        learningDebtCreated: result.learningDebtCreated,
        learningDebtSeverity: result.learningDebtSeverity,
        message: result.learningDebtCreated
          ? `Learning debt created (severity ${result.learningDebtSeverity}/5)`
          : 'Mastery updated successfully',
      },
    });
  } catch (error) {
    console.error('Error recording evidence:', error);
    return NextResponse.json(
      {
        error: 'INTERNAL_ERROR',
        message: 'Failed to record evidence',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined,
      },
      { status: 500 }
    );
  }
}
