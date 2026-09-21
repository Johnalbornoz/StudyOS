/**
 * F7 -- GET/POST /api/exam-profiles?studentId=...
 *
 * Learner may manage their own Exam Profiles; parent/teacher visibility
 * follows F2's existing relationship/scope permissions exactly (task
 * §35) -- this route calls the SAME `canAccessLearner` function every
 * other learner-scoped route already uses, introducing zero new
 * authorization primitives. Authorization (who may see/edit) is
 * deliberately kept separate from F3 entitlement (whether Exam Prep is
 * a paid capability) -- composing both would be a future call site's
 * job (mirroring F3/F4's own "authorized AND entitled" composition
 * pattern), not this route's, since F7 does not yet gate any capability
 * behind a paid tier.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { canAccessLearner } from '@/lib/authorization';
import { createStudentExamProfile } from '@/lib/assessment/student-exam-profile.service';
import { db } from '@/lib/db';
import { z } from 'zod';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const studentId = searchParams.get('studentId');
  if (!studentId) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });

  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  const allowed = await canAccessLearner(actor.id, studentId, 'LEARNER_PROFILE_VIEW');
  if (!allowed) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const result = await db.query(`SELECT * FROM student_exam_profiles WHERE student_id = $1 ORDER BY created_at DESC`, [studentId]);
  return NextResponse.json({ success: true, data: { profiles: result.rows } });
}

const CreateSchema = z.object({
  studentId: z.string().uuid(),
  examDefinitionId: z.string().uuid(),
  examVersionId: z.string().uuid().optional(),
  purpose: z.string().max(200).optional(),
  programmeContext: z.string().max(200).optional(),
  subjectFocus: z.string().max(200).optional(),
  examDate: z.string().optional(),
  timezone: z.string().max(100).optional(),
  institutionTargetId: z.string().uuid().optional(),
});

export async function POST(request: NextRequest) {
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  let validated;
  try {
    validated = CreateSchema.parse(await request.json());
  } catch (error: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.errors?.[0]?.message }, { status: 400 });
  }

  const allowed = await canAccessLearner(actor.id, validated.studentId, 'LEARNER_PROFILE_VIEW');
  if (!allowed) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const catalogMatch = await db.query(
    `SELECT d.id
       FROM exam_definitions d
       LEFT JOIN exam_versions v ON v.id = $2
      WHERE d.id = $1
        AND d.status = 'ACTIVE'
        AND ($2::uuid IS NULL OR (
          v.exam_definition_id = d.id
          AND v.status = 'PUBLISHED'
        ))`,
    [validated.examDefinitionId, validated.examVersionId ?? null]
  );
  if (catalogMatch.rows.length === 0) {
    return NextResponse.json(
      { error: 'INVALID_EXAM_SELECTION', message: 'The selected exam or version is not available.' },
      { status: 400 }
    );
  }

  const profile = await createStudentExamProfile(validated);
  return NextResponse.json({ success: true, data: { profile } });
}
