import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import { recordExamResult } from '@/services/exam-result.service';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { z } from 'zod';

const RecordResultSchema = z.object({
  studentId: z.string().uuid(),
  occurrenceId: z.string().uuid(),
  score: z.number().min(0),
  maxScore: z.number().positive(),
});

export async function POST(request: NextRequest) {
  try {
    const authContext = await verifyAuth();
    if (!authContext) {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    }

    const body = await request.json();
    let validated;
    try {
      validated = RecordResultSchema.parse(body);
    } catch (error: any) {
      return NextResponse.json(
        { error: 'INVALID_INPUT', message: error.errors?.[0]?.message },
        { status: 400 }
      );
    }
    if (validated.score > validated.maxScore) {
      return NextResponse.json(
        { error: 'INVALID_INPUT', message: 'score cannot exceed maxScore' },
        { status: 400 }
      );
    }

    const canAccess = await verifyStudentAccess(authContext.userId, validated.studentId, authContext.role);
    if (!canAccess) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }

    const ownerResult = await db.query(
      `
      SELECT s.student_id
      FROM assessment_occurrences ao
      JOIN subjects s ON s.id = ao.subject_id
      WHERE ao.id = $1
      `,
      [validated.occurrenceId]
    );
    if (ownerResult.rows[0]?.student_id !== validated.studentId) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }

    const preferredLanguage = await getInterfaceLanguage(validated.studentId);
    const outcome = await recordExamResult(
      {
        occurrenceId: validated.occurrenceId,
        studentId: validated.studentId,
        score: validated.score,
        maxScore: validated.maxScore,
      },
      preferredLanguage
    );

    return NextResponse.json({ success: true, data: outcome });
  } catch (error) {
    console.error('Error recording exam result:', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR', details: String(error) }, { status: 500 });
  }
}
