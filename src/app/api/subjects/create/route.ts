import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireStudentId } from '@/lib/auth';
import { isLocale } from '@/lib/i18n/messages';
import { getAcademicProfile } from '@/services/academic-profile.service';
import { deriveSubjectAcademicContext, resolveSubjectIbFields } from '@/lib/student/subject-academic-context';

export async function POST(req: NextRequest) {
  // Development: Use test UUID, production: require auth + an ACTIVE
  // STUDENT role (never silently provisioned -- see requireStudentId).
  let userId = '550e8400-e29b-41d4-a716-446655440000'; // UUID v4 test
  if (process.env.NODE_ENV === 'production') {
    const auth_result = await auth();
    const clerkUserId = auth_result.userId;
    if (!clerkUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const studentId = await requireStudentId(clerkUserId);
    if (!studentId) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }
    userId = studentId;
  }

  try {
    const { name, targetLanguage, quizLanguageMode, ibProgramme, ibSubjectGroup, ibLevel } = await req.json();

    if (!name) {
      return NextResponse.json({ error: 'Missing name' }, { status: 400 });
    }

    const resolvedTargetLanguage = isLocale(targetLanguage) ? targetLanguage : null;
    const resolvedQuizMode = quizLanguageMode === 'fixed_english' ? 'fixed_english' : 'match_interface';
    // The IB programme comes from the student's academic profile, never
    // from the form; a DP subject needs an explicit HL/SL level.
    const context = deriveSubjectAcademicContext(await getAcademicProfile(userId));
    const ib = resolveSubjectIbFields(context, { ibProgramme, ibSubjectGroup, ibLevel });
    if (!ib.ok) {
      return NextResponse.json({ error: ib.error }, { status: 400 });
    }
    const { ib_programme: resolvedIbProgramme, ib_subject_group: resolvedIbSubjectGroup, ib_level: resolvedIbLevel } = ib.fields;

    const result = await query(
      `INSERT INTO subjects (student_id, name, status, target_language, quiz_language_mode, ib_programme, ib_subject_group, ib_level)
       VALUES ($1, $2, 'active', $3, $4, $5, $6, $7)
       RETURNING id`,
      [userId, name, resolvedTargetLanguage, resolvedQuizMode, resolvedIbProgramme, resolvedIbSubjectGroup, resolvedIbLevel]
    );

    return NextResponse.json({ success: true, subjectId: result.rows[0].id });
  } catch (error) {
    console.error('Create subject error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
