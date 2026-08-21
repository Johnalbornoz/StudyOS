import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import { updateOccurrence, cancelAssessment } from '@/services/assessment.service';
import { z } from 'zod';

const RescheduleSchema = z.object({
  studentId: z.string().uuid(),
  occurrenceId: z.string().uuid(),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  topics: z.array(z.string()).optional(),
  cancel: z.boolean().optional(),
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
      validated = RescheduleSchema.parse(body);
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

    // Verify the occurrence belongs to one of this student's subjects
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

    if (validated.cancel) {
      await cancelAssessment(validated.occurrenceId);
      return NextResponse.json({ success: true, data: { cancelled: true } });
    }

    if (!validated.scheduledDate && !validated.topics) {
      return NextResponse.json({ error: 'INVALID_INPUT', message: 'scheduledDate, topics, or cancel required' }, { status: 400 });
    }

    const occurrence = await updateOccurrence(validated.occurrenceId, {
      scheduledDate: validated.scheduledDate,
      topics: validated.topics,
    });
    return NextResponse.json({ success: true, data: occurrence });
  } catch (error) {
    console.error('Error rescheduling assessment:', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR', details: String(error) }, { status: 500 });
  }
}
