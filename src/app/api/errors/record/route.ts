/**
 * POST /api/errors/record
 *
 * Manually record a classified error for a concept -- for flows that
 * don't go through quiz grading (e.g. a guided exercise). Quiz
 * submissions record errors automatically; see
 * /api/quizzes/generate-and-take.
 *
 * Request body:
 * {
 *   studentId: string
 *   conceptId: string
 *   subjectId: string
 *   errorType: 'CONCEPTUAL' | 'PROCEDURAL' | 'CARELESS' | 'INCOMPLETE' | 'MISREADING'
 *   sourceType?: string
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import { recordError } from '@/services/error-intelligence.service';
import { z } from 'zod';

const RecordErrorSchema = z.object({
  studentId: z.string().uuid('Invalid studentId'),
  conceptId: z.string().uuid('Invalid conceptId'),
  subjectId: z.string().uuid('Invalid subjectId'),
  errorType: z.enum(['CONCEPTUAL', 'PROCEDURAL', 'CARELESS', 'INCOMPLETE', 'MISREADING']),
  sourceType: z.string().default('GUIDED_EXERCISE'),
});

export async function POST(request: NextRequest) {
  try {
    const authContext = await verifyAuth();
    if (!authContext) {
      return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();
    let validated;
    try {
      validated = RecordErrorSchema.parse(body);
    } catch (error: any) {
      return NextResponse.json(
        { error: 'INVALID_INPUT', message: error.errors?.[0]?.message || 'Invalid request body' },
        { status: 400 }
      );
    }

    const canAccess = await verifyStudentAccess(authContext.userId, validated.studentId, authContext.role);
    if (!canAccess) {
      return NextResponse.json({ error: 'FORBIDDEN', message: 'Cannot record errors for this student' }, { status: 403 });
    }

    const subjectCheck = await db.query(`SELECT student_id FROM subjects WHERE id = $1`, [validated.subjectId]);
    if (subjectCheck.rows[0]?.student_id !== validated.studentId) {
      return NextResponse.json({ error: 'FORBIDDEN', message: 'Subject does not belong to this student' }, { status: 403 });
    }

    await recordError(validated);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error recording error:', error);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Failed to record error', details: String(error) },
      { status: 500 }
    );
  }
}
