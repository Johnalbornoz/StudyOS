/**
 * LX-4R R3 -- GUIDED PRACTICE ("we do one together") for the GUIDE stage.
 *
 * Teaching scaffolding only. Gated exactly like contextual help: the
 * server denies it for any non-PRACTICE evidence mode. It NEVER writes
 * learning evidence -- guided steps are pre-practice scaffolding, not
 * attempts (see teaching-content.service.ts).
 *
 * LX-4P-PERF-R1E R1/R2: GUIDE is teaching content, not evidence -- it
 * must not require a successful Practice question-generation session
 * (quizId) merely to exist. Resolvable from EITHER:
 *   - `quizId`               -> conceptId/subjectId/evidenceMode read
 *                                from the canonical quiz_sessions row
 *                                (unchanged, back-compat), or
 *   - `conceptId` + `mode`   -> evidenceMode derived from the SAME
 *                                canonical QuizMode -> ActivityType ->
 *                                EvidenceMode taxonomy `storeQuiz`
 *                                stamps onto the row
 *                                (`evidenceModeForQuizMode`) -- the exact
 *                                pattern `/api/learning/teaching-intent`
 *                                already uses. `mode` is transport input
 *                                only: the client can never hand the
 *                                server an EvidenceMode / SupportLevel /
 *                                permission decision directly, only a
 *                                QuizMode name the server maps through
 *                                the fixed table. `conceptId` is
 *                                authorised by an explicit ownership
 *                                check (concept's subject belongs to
 *                                this student).
 * Practice-assistance policy (`canUseAI`) is unchanged and applies
 * identically to both paths -- GUIDE stays denied outside PRACTICE
 * evidence (Prove / Independent / Assessment), regardless of which path
 * resolved it.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { getQuizSession, evidenceModeForQuizMode, type QuizMode } from '@/services/quiz-persistence.service';
import { generateGuidedPractice } from '@/services/teaching-content.service';
import { canUseAI } from '@/lib/ai-permission-policy';
import { query } from '@/lib/db';
import type { EvidenceMode } from '@/lib/activity-taxonomy';
import { z } from 'zod';

const VALID_MODES: ReadonlySet<string> = new Set<QuizMode>([
  'topic_practice', 'review', 'quick_check', 'retention_check',
  'cumulative_assessment', 'exam_simulation', 'diagnostic_check',
]);

const Schema = z.object({
  studentId: z.string().uuid(),
  quizId: z.string().optional(),
  conceptId: z.string().uuid().optional(),
  mode: z.string().optional(),
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
  if (!v.quizId && !v.conceptId) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: 'quizId or conceptId is required' }, { status: 400 });
  }
  if (!(await verifyStudentAccess(authContext.userId, v.studentId, authContext.role))) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  let conceptId: string | null;
  let subjectId: string;
  let evidenceMode: EvidenceMode;

  if (v.quizId) {
    const session = await getQuizSession(v.quizId);
    if (!session || session.studentId !== v.studentId) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    conceptId = session.conceptId;
    subjectId = session.subjectId;
    evidenceMode = session.evidenceMode;
  } else {
    // R2: `mode` is transport input only -- always re-derived through the
    // fixed canonical taxonomy, never trusted as an EvidenceMode itself.
    const mode = v.mode && VALID_MODES.has(v.mode) ? (v.mode as QuizMode) : 'topic_practice';
    evidenceMode = evidenceModeForQuizMode(mode);

    const owner = await query(
      `SELECT c.subject_id, s.student_id
       FROM concepts c JOIN subjects s ON s.id = c.subject_id
       WHERE c.id = $1`,
      [v.conceptId],
    );
    const row = owner.rows[0];
    if (!row) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    if (row.student_id !== v.studentId) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    conceptId = v.conceptId!;
    subjectId = row.subject_id;
  }

  // R6: unchanged Practice-assistance policy, applied identically
  // whichever path resolved evidenceMode.
  if (!canUseAI({ evidenceMode, feature: 'EXPLAIN' })) {
    return NextResponse.json({ error: 'HELP_DISABLED_FOR_MODE' }, { status: 403 });
  }
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

  const guidedPractice = await generateGuidedPractice(v.studentId, subjectId, conceptId, label, subjectName, v.language);
  // A fallback sequence carries no steps -- the client skips the GUIDE stage.
  return NextResponse.json({
    success: true,
    data: { guidedPractice: guidedPractice.isFallback ? null : guidedPractice },
  });
}
