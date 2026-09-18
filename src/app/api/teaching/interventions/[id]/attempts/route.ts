/**
 * F8 -- POST /api/teaching/interventions/[id]/attempts (task §20/§33)
 *
 * Records one retry-preserving attempt against an ACTIVE, non-PROVE
 * intervention session: classifies feedback, writes real Evidence via
 * writeInterventionEvidence (through F5's unmodified updateMastery()),
 * and appends a new intervention_attempts row. The prior attempt is
 * never overwritten (case M).
 *
 * Minimal-flow scope decision (task §33): grading itself is the
 * caller's responsibility (an existing quiz/grading surface, or a
 * simple client-side check for this Preview flow) -- this endpoint
 * accepts the already-graded outcome rather than re-implementing a
 * question-generation/grading pipeline, which is explicitly out of
 * F8's scope.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { canAccessLearner } from '@/lib/authorization';
import { db } from '@/lib/db';
import { getInterventionSession, recordInterventionAttempt, ProveNotRecordableHereError } from '@/lib/teaching/session.service';
import { classifyFeedback } from '@/lib/teaching/feedback.service';
import { resolveCommandTermInterpretation } from '@/lib/teaching/command-term-teaching.service';

const AttemptSchema = z.object({
  conceptId: z.string().uuid(),
  subjectId: z.string().uuid(),
  skillId: z.string().uuid().optional(),
  commandTermId: z.string().uuid().optional(),
  questionType: z.string().optional(),
  reasoningRequirement: z.string().optional(),
  difficulty: z.number().min(1).max(5),
  result: z.enum(['correct', 'incorrect', 'partial']),
  scorePercent: z.number().min(0).max(100),
  feedbackText: z.string().max(2000).optional(),
  hintsUsed: z.number().int().min(0).optional(),
  timing: z.object({ questionPresentedAt: z.string(), answerSubmittedAt: z.string() }).optional(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  const session = await getInterventionSession(id);
  if (!session) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  const allowed = await canAccessLearner(actor.id, session.studentId, 'LEARNER_INTERVENTION_CREATE');
  if (!allowed) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  let validated;
  try {
    validated = AttemptSchema.parse(await request.json());
  } catch (error: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.errors?.[0]?.message }, { status: 400 });
  }

  let commandTermForFeedback: { id: string; term: string; expectedStructure: string | null } | null = null;
  if (validated.commandTermId) {
    const termRow = await db.query(`SELECT id, term FROM command_terms WHERE id = $1`, [validated.commandTermId]);
    if (termRow.rows.length > 0) {
      const interpretation = await resolveCommandTermInterpretation(validated.commandTermId, session.frameworkContext?.academicProgrammeId ?? null);
      commandTermForFeedback = { id: termRow.rows[0].id, term: termRow.rows[0].term, expectedStructure: interpretation?.expectedStructure ?? null };
    }
  }

  const feedback = classifyFeedback({
    graderResult: { correct: validated.result === 'correct', score: validated.scorePercent / 100, feedback: validated.feedbackText ?? '' },
    gapTypeConsidered: session.gapType as any,
    isTechniqueTargetedIntervention: session.gapType === 'EXAM_TECHNIQUE_GAP' || session.gapType === 'MIXED',
    commandTerm: commandTermForFeedback,
  });

  try {
    const attempt = await recordInterventionAttempt({
      sessionId: id,
      studentId: session.studentId,
      conceptId: validated.conceptId,
      subjectId: validated.subjectId,
      skillId: validated.skillId,
      commandTermId: validated.commandTermId,
      questionType: validated.questionType,
      reasoningRequirement: validated.reasoningRequirement,
      difficulty: validated.difficulty,
      result: validated.result,
      scorePercent: validated.scorePercent,
      feedback,
      hintsUsed: validated.hintsUsed ?? 0,
      timing: validated.timing,
    });
    return NextResponse.json({ success: true, data: { attempt } });
  } catch (err) {
    if (err instanceof ProveNotRecordableHereError) {
      return NextResponse.json({ error: 'PROVE_NOT_RECORDABLE_HERE' }, { status: 400 });
    }
    if (err instanceof Error && err.message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }
    throw err;
  }
}
