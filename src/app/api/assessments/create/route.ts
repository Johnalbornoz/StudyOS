import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import { scheduleAssessment } from '@/services/assessment.service';
import { z } from 'zod';

const CreateAssessmentSchema = z.object({
  studentId: z.string().uuid(),
  subjectId: z.string().uuid(),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'scheduledDate must be YYYY-MM-DD'),
  topics: z.array(z.string()).optional(),
  occurrencePattern: z.string().optional(),
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
      validated = CreateAssessmentSchema.parse(body);
    } catch (error: any) {
      return NextResponse.json(
        { error: 'INVALID_INPUT', message: error.errors?.[0]?.message },
        { status: 400 }
      );
    }

    const canAccess = await verifyStudentAccess(authContext.userId, validated.studentId, authContext.role);
    if (!canAccess) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }

    const subjectResult = await db.query(`SELECT student_id FROM subjects WHERE id = $1`, [
      validated.subjectId,
    ]);
    if (subjectResult.rows[0]?.student_id !== validated.studentId) {
      return NextResponse.json({ error: 'FORBIDDEN', message: 'Subject does not belong to this student' }, { status: 403 });
    }

    const occurrence = await scheduleAssessment(validated.subjectId, validated.scheduledDate, {
      topics: validated.topics,
      occurrencePattern: validated.occurrencePattern,
    });

    return NextResponse.json({ success: true, data: occurrence });
  } catch (error) {
    console.error('Error creating assessment:', error);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', details: String(error) },
      { status: 500 }
    );
  }
}
