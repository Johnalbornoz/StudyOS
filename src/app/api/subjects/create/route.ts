import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireStudentId } from '@/lib/auth';
import { isLocale } from '@/lib/i18n/messages';
import { getAcademicProfile } from '@/services/academic-profile.service';
import { deriveSubjectAcademicContext, resolveSubjectIbFields } from '@/lib/student/subject-academic-context';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { catalogSubject, catalogSubjectByName } from '@/lib/experience/subject-catalog';

/**
 * Reuse the Student's active subject with this name, or create it -- once.
 *
 * One short transaction under a per-Student advisory lock, so a double
 * click / double submit is serialized: the second request finds the row the
 * first one inserted. (No schema change: there is no unique index to lean
 * on.) The check and the insert are separate, plainly typed statements.
 */
async function createOrReuseSubject(
  studentId: string,
  f: { name: string; targetLanguage: string | null; quizLanguageMode: string; ibProgramme: string; ibSubjectGroup: string | null; ibLevel: string | null },
): Promise<{ id: string; existing: boolean }> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('subject-create:' || $1::text))`, [studentId]);
    const existing = await client.query(
      `SELECT id FROM subjects WHERE student_id = $1 AND lower(name) = lower($2::text) AND status != 'archived' ORDER BY created_at LIMIT 1`,
      [studentId, f.name],
    );
    if (existing.rows[0]) {
      await client.query('COMMIT');
      return { id: existing.rows[0].id, existing: true };
    }
    const inserted = await client.query(
      `INSERT INTO subjects (student_id, name, status, target_language, quiz_language_mode, ib_programme, ib_subject_group, ib_level)
       VALUES ($1, $2, 'active', $3, $4, $5, $6, $7)
       RETURNING id`,
      [studentId, f.name, f.targetLanguage, f.quizLanguageMode, f.ibProgramme, f.ibSubjectGroup, f.ibLevel],
    );
    await client.query('COMMIT');
    return { id: inserted.rows[0].id, existing: false };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function POST(req: NextRequest) {
  // Always the signed-in, ACTIVE Student (never silently provisioned --
  // see requireStudentId). UX-5 closure: the former development shortcut
  // (a hard-coded test UUID whenever NODE_ENV !== 'production') made every
  // local `next dev` create fail with 23503 subjects_student_id_fkey and
  // read the wrong profile / language; the server never writes for anyone
  // but the authenticated Student.
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const studentId = await requireStudentId(clerkUserId);
  if (!studentId) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }
  const userId = studentId;

  try {
    const { catalogKey, name, quizLanguageMode, ibProgramme, ibSubjectGroup, ibLevel } = await req.json();

    // UX-5 closure: a subject is SELECTED from the controlled list
    // (lib/experience/subject-catalog.ts) -- never created from free text.
    // A legacy `name` is accepted only when it IS a catalog subject.
    const entry = catalogKey !== undefined ? catalogSubject(catalogKey) : typeof name === 'string' ? catalogSubjectByName(name) : null;
    if (!entry) {
      return NextResponse.json({ error: catalogKey === undefined && !name ? 'Missing name' : 'SUBJECT_NOT_IN_CATALOG' }, { status: 400 });
    }

    const locale = await getInterfaceLanguage(userId).catch(() => 'es' as const);
    const resolvedName = entry.names[isLocale(locale) ? locale : 'es'];
    const resolvedTargetLanguage = entry.targetLanguage ?? null;
    const resolvedQuizMode = quizLanguageMode === 'fixed_english' ? 'fixed_english' : 'match_interface';
    // The IB programme comes from the student's academic profile, never
    // from the form; a DP subject needs an explicit HL/SL level. The IB
    // group comes from the catalog entry.
    const context = deriveSubjectAcademicContext(await getAcademicProfile(userId));
    const ib = resolveSubjectIbFields(context, { ibProgramme, ibSubjectGroup: context.programme === 'none' ? ibSubjectGroup : entry.ibGroup, ibLevel });
    if (!ib.ok) {
      return NextResponse.json({ error: ib.error }, { status: 400 });
    }
    const { ib_programme: resolvedIbProgramme, ib_subject_group: resolvedIbSubjectGroup, ib_level: resolvedIbLevel } = ib.fields;

    const created = await createOrReuseSubject(userId, {
      name: resolvedName,
      targetLanguage: resolvedTargetLanguage,
      quizLanguageMode: resolvedQuizMode,
      ibProgramme: resolvedIbProgramme,
      ibSubjectGroup: resolvedIbSubjectGroup,
      ibLevel: resolvedIbLevel,
    });
    return NextResponse.json({ success: true, subjectId: created.id, ...(created.existing ? { existing: true } : {}) });
  } catch (error) {
    // Server-side diagnostic only; the Student sees a generic, retryable message.
    const e = error as { code?: string; message?: string };
    console.error('[subjects/create] failed', JSON.stringify({ code: e?.code ?? null, message: e?.message ?? String(error) }));
    return NextResponse.json({ error: 'CREATE_SUBJECT_FAILED' }, { status: 500 });
  }
}
