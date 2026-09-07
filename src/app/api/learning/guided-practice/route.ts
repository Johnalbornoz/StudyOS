/**
 * LX-4R R3 -- GUIDED PRACTICE ("we do one together") for the GUIDE stage.
 *
 * Teaching scaffolding only. Gated exactly like contextual help: the
 * server denies it for any non-PRACTICE evidence mode. It NEVER writes
 * learning evidence -- guided steps are pre-practice scaffolding, not
 * attempts (see teaching-content.service.ts).
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { getQuizSession } from '@/services/quiz-persistence.service';
import { generateGuidedPractice } from '@/services/teaching-content.service';
import { canUseAI } from '@/lib/ai-permission-policy';
import { query } from '@/lib/db';
import { z } from 'zod';

const Schema = z.object({
  studentId: z.string().uuid(),
  quizId: z.string(),
  language: z.string().default('en'),
});

export async function POST(request: NextRequest) {
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  let v: z.infer<typeof Schema>;
  try {
    v = Schema.parse(await request.json());
  } catch (e: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: e.errors?.[0]?.message }, { status: 400 });
  }
  if (!(await verifyStudentAccess(authContext.userId, v.studentId, authContext.role))) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const session = await getQuizSession(v.quizId);
  if (!session || session.studentId !== v.studentId) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  if (!canUseAI({ evidenceMode: session.evidenceMode, feature: 'EXPLAIN' })) {
    return NextResponse.json({ error: 'HELP_DISABLED_FOR_MODE' }, { status: 403 });
  }
  const conceptId = session.conceptId;
  if (!conceptId) {
    return NextResponse.json({ success: true, data: { guidedPractice: null } });
  }

  const r = await query(
    `SELECT COALESCE(cl.label, c.canonical_id) AS label, s.name AS subject_name
     FROM concepts c JOIN subjects s ON s.id = c.subject_id
     LEFT JOIN concept_localizations cl ON cl.concept_id = c.id AND cl.language = $2
     WHERE c.id = $1`,
    [conceptId, v.language],
  );
  const label: string = r.rows[0]?.label ?? 'this concept';
  const subjectName: string = r.rows[0]?.subject_name ?? '';

  const guidedPractice = await generateGuidedPractice(v.studentId, session.subjectId, conceptId, label, subjectName, v.language);
  // A fallback sequence carries no steps -- the client skips the GUIDE stage.
  return NextResponse.json({
    success: true,
    data: { guidedPractice: guidedPractice.isFallback ? null : guidedPractice },
  });
}
