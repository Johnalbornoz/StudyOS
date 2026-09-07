/**
 * LX-4R R4 -- CONTEXTUAL HELP: one gated entry point.
 *
 * The learner's in-activity help surface. The SERVER decides whether
 * teaching help is allowed, from the canonical `quiz_sessions.evidenceMode`
 * (fixed at generation) via `ai-permission-policy.canUseAI` -- client
 * hiding of the menu is never the enforcement. Every action maps to a
 * real, already-existing content behaviour; nothing here diagnoses.
 *
 *   HINT           -> generateQuestionHint            (existing)
 *   EXAMPLE        -> ConceptExplanation.examples[0]  (existing, cached)
 *   REMINDER       -> ConceptExplanation.summary      (existing, cached)
 *   ANOTHER_ANGLE  -> ConceptExplanation.sections[]   (existing, cached)
 *   FIRST_STEP     -> GuidedPractice.steps[0]         (LX-4R R3)
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { getQuizSession, recordHintUsed } from '@/services/quiz-persistence.service';
import { generateQuestionHint } from '@/services/quiz-generation.service';
import { getConceptExplanation } from '@/services/concept-explanation.service';
import { generateGuidedPractice } from '@/services/teaching-content.service';
import { getTeachingIntentForConcept } from '@/services/adaptive-teaching.service';
import { toTeachingGenerationContext } from '@/lib/adaptive-teaching-generation';
import { canUseAI, type AIFeature } from '@/lib/ai-permission-policy';
import { query } from '@/lib/db';
import { z } from 'zod';

const HELP_ACTIONS = ['HINT', 'EXAMPLE', 'REMINDER', 'ANOTHER_ANGLE', 'FIRST_STEP'] as const;
type HelpAction = (typeof HELP_ACTIONS)[number];

const FEATURE_BY_ACTION: Record<HelpAction, AIFeature> = {
  HINT: 'HINT',
  EXAMPLE: 'EXPLAIN',
  REMINDER: 'EXPLAIN',
  ANOTHER_ANGLE: 'EXPLAIN',
  FIRST_STEP: 'EXPLAIN',
};

const Schema = z.object({
  studentId: z.string().uuid(),
  quizId: z.string(),
  questionIndex: z.number().int().min(0),
  action: z.enum(HELP_ACTIONS),
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

  // THE authority: teaching help is denied for every non-PRACTICE
  // evidence mode, regardless of what the client renders.
  if (!canUseAI({ evidenceMode: session.evidenceMode, feature: FEATURE_BY_ACTION[v.action] })) {
    return NextResponse.json({ error: 'HELP_DISABLED_FOR_MODE' }, { status: 403 });
  }

  const question = session.questions[v.questionIndex];
  if (!question) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const conceptId = session.conceptId ?? question.conceptId;
  if (!conceptId) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  try {
    if (v.action === 'HINT') {
      const intent = await getTeachingIntentForConcept(v.studentId, conceptId).catch(() => null);
      const hints = await generateQuestionHint(
        question,
        v.language,
        intent ? toTeachingGenerationContext(intent) : undefined,
        { studentId: v.studentId, subjectId: session.subjectId, conceptId, sourceId: v.quizId },
      );
      recordHintUsed(v.quizId, v.questionIndex).catch(() => {});
      return NextResponse.json({ success: true, data: { action: v.action, hints } });
    }

    if (v.action === 'FIRST_STEP') {
      const label = await conceptLabel(conceptId, v.language);
      const gp = await generateGuidedPractice(v.studentId, session.subjectId, conceptId, label.label, label.subjectName, v.language);
      const first = gp.steps[0] ?? null;
      return NextResponse.json({ success: true, data: { action: v.action, firstStep: first } });
    }

    // EXAMPLE / REMINDER / ANOTHER_ANGLE -- from the canonical concept explanation.
    const explanation = await getConceptExplanation(v.studentId, conceptId, v.language);
    if (v.action === 'EXAMPLE') {
      return NextResponse.json({ success: true, data: { action: v.action, example: explanation.examples[0] ?? explanation.summary } });
    }
    if (v.action === 'REMINDER') {
      return NextResponse.json({ success: true, data: { action: v.action, reminder: explanation.summary } });
    }
    // ANOTHER_ANGLE
    return NextResponse.json({
      success: true,
      data: { action: v.action, sections: explanation.sections.slice(0, 3) },
    });
  } catch (e) {
    console.error('contextual-help error:', e);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

async function conceptLabel(conceptId: string, language: string): Promise<{ label: string; subjectName: string }> {
  const r = await query(
    `SELECT COALESCE(cl.label, c.canonical_id) AS label, s.name AS subject_name
     FROM concepts c JOIN subjects s ON s.id = c.subject_id
     LEFT JOIN concept_localizations cl ON cl.concept_id = c.id AND cl.language = $2
     WHERE c.id = $1`,
    [conceptId, language],
  );
  return { label: r.rows[0]?.label ?? 'this concept', subjectName: r.rows[0]?.subject_name ?? '' };
}
