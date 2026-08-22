import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { query } from '@/lib/db';
import { createConceptManually } from '@/services/concept-extraction.service';
import { z } from 'zod';

const CreateSchema = z.object({
  studentId: z.string().uuid(),
  subjectId: z.string().uuid(),
  label: z.string().min(2).max(200),
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
    validated = CreateSchema.parse(body);
  } catch (error: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.errors?.[0]?.message }, { status: 400 });
  }

  const canAccess = await verifyStudentAccess(authContext.userId, validated.studentId, authContext.role);
  if (!canAccess) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const subject = await query(`SELECT id FROM subjects WHERE id = $1 AND student_id = $2`, [
    validated.subjectId,
    validated.studentId,
  ]);
  if (subject.rowCount === 0) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const result = await createConceptManually(
    validated.studentId,
    validated.subjectId,
    validated.label.trim(),
    validated.language
  );

  return NextResponse.json({ success: true, data: result });
}
