import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { db, query } from '@/lib/db';
import { isLocale } from '@/lib/i18n/messages';
import { z } from 'zod';

const UpdateSchema = z.object({
  studentId: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  targetLanguage: z.string().nullable().optional(),
  quizLanguageMode: z.enum(['match_interface', 'fixed_english']).optional(),
  status: z.enum(['active', 'archived']).optional(),
  ibProgramme: z.enum(['none', 'MYP', 'DP']).optional(),
  ibSubjectGroup: z.string().nullable().optional(),
  ibLevel: z.enum(['SL', 'HL']).nullable().optional(),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const authContext = await verifyAuth();
  if (!authContext) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const body = await request.json();
  let validated;
  try {
    validated = UpdateSchema.parse(body);
  } catch (error: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.errors?.[0]?.message }, { status: 400 });
  }

  const canAccess = await verifyStudentAccess(authContext.userId, validated.studentId, authContext.role);
  if (!canAccess) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const existing = await query(`SELECT id FROM subjects WHERE id = $1 AND student_id = $2`, [
    id,
    validated.studentId,
  ]);
  if (existing.rowCount === 0) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const sets: string[] = [];
  const values: any[] = [];
  let i = 1;

  if (validated.name !== undefined) {
    sets.push(`name = $${i++}`);
    values.push(validated.name);
  }
  if (validated.targetLanguage !== undefined) {
    sets.push(`target_language = $${i++}`);
    values.push(isLocale(validated.targetLanguage) ? validated.targetLanguage : null);
  }
  if (validated.quizLanguageMode !== undefined) {
    sets.push(`quiz_language_mode = $${i++}`);
    values.push(validated.quizLanguageMode);
  }
  if (validated.status !== undefined) {
    sets.push(`status = $${i++}`);
    values.push(validated.status);
  }
  if (validated.ibProgramme !== undefined) {
    sets.push(`ib_programme = $${i++}`);
    values.push(validated.ibProgramme);
    if (validated.ibProgramme === 'none') {
      sets.push(`ib_subject_group = NULL`, `ib_level = NULL`);
    }
  }
  if (validated.ibSubjectGroup !== undefined && validated.ibProgramme !== 'none') {
    sets.push(`ib_subject_group = $${i++}`);
    values.push(validated.ibSubjectGroup);
  }
  if (validated.ibLevel !== undefined && validated.ibProgramme !== 'none') {
    sets.push(`ib_level = $${i++}`);
    values.push(validated.ibLevel);
  }

  if (sets.length === 0) {
    return NextResponse.json({ error: 'NO_CHANGES' }, { status: 400 });
  }

  values.push(id);
  await query(`UPDATE subjects SET ${sets.join(', ')} WHERE id = $${i}`, values);

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const authContext = await verifyAuth();
  if (!authContext) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const studentId = searchParams.get('studentId');
  if (!studentId) {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  }

  const canAccess = await verifyStudentAccess(authContext.userId, studentId, authContext.role);
  if (!canAccess) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const existing = await query(`SELECT id FROM subjects WHERE id = $1 AND student_id = $2`, [id, studentId]);
  if (existing.rowCount === 0) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const conceptCount = await query(`SELECT COUNT(*) FROM concepts WHERE subject_id = $1`, [id]);
  if (Number(conceptCount.rows[0].count) > 0) {
    return NextResponse.json({ error: 'HAS_CONCEPTS' }, { status: 409 });
  }

  // No concepts -- any uploaded content produced no study data, so it's
  // safe to clean up as part of the same delete rather than counting
  // as "history" on its own.
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM content_chunks WHERE source_id IN (SELECT id FROM content_sources WHERE subject_id = $1)`,
      [id]
    );
    await client.query(`DELETE FROM content_sources WHERE subject_id = $1`, [id]);
    await client.query(`DELETE FROM subjects WHERE id = $1`, [id]);
    await client.query('COMMIT');
    return NextResponse.json({ success: true });
  } catch (error: any) {
    await client.query('ROLLBACK');
    if (error.code === '23503') {
      return NextResponse.json({ error: 'HAS_HISTORY' }, { status: 409 });
    }
    console.error('Delete subject error:', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  } finally {
    client.release();
  }
}
