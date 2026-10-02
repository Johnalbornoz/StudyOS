/**
 * Track A -- /api/student/plan (the learner's own Personal Learning Plan)
 * GET: plan entries (status, phase, sources) + own unlinked concepts.
 * POST { canonicalConceptId, source?, classId? }: add a catalog concept to
 *   MY plan. Reuses my existing learner concept (no duplicate, progress
 *   kept); creates it at "not started" only if it never existed. A source
 *   that names a class / curriculum is verified server-side (I must be
 *   ACTIVE in that class and the concept must be in its plan / curriculum).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireStudentActor, readBody } from '@/lib/learning-plan/route-actors';
import { enrollCanonicalConcept, getPersonalPlan, type PlanSource } from '@/lib/learning-plan/personal-plan.service';
import { curriculumForClass } from '@/lib/learning-plan/institution-curriculum.service';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

const Schema = z.object({
  canonicalConceptId: z.string().uuid(),
  source: z.enum(['SELF_SELECTED', 'CURRICULUM_RECOMMENDATION', 'PREREQUISITE_RECOMMENDATION', 'CLASS_PLAN', 'INSTITUTION_CURRICULUM']).default('SELF_SELECTED'),
  classId: z.string().uuid().nullable().optional(),
});

async function handleGET() {
  const actor = await requireStudentActor();
  if ('response' in actor) return actor.response;
  const locale = await getInterfaceLanguage(actor.studentId).catch(() => 'es' as const);
  return NextResponse.json({ success: true, data: await getPersonalPlan(actor.studentId, locale) });
}

async function handlePOST(request: NextRequest) {
  const actor = await requireStudentActor();
  if ('response' in actor) return actor.response;
  const parsed = Schema.safeParse(await readBody(request));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  const { canonicalConceptId, source, classId } = parsed.data;
  const concept = await db.query(`SELECT 1 FROM canonical_concepts WHERE id = $1 AND status = 'ACTIVE'`, [canonicalConceptId]);
  if (!concept.rows[0]) return NextResponse.json({ error: 'CONCEPT_NOT_AVAILABLE' }, { status: 404 });

  const planSource: PlanSource = { type: source, actorUserId: actor.userId };
  if (source === 'CLASS_PLAN' || source === 'INSTITUTION_CURRICULUM') {
    if (!classId) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
    const klass = await db.query(
      `SELECT c.id, c.institution_id FROM class_enrollments ce JOIN classes c ON c.id = ce.class_id WHERE ce.class_id = $1 AND ce.student_id = $2 AND ce.status = 'ACTIVE'`,
      [classId, actor.studentId]
    );
    if (!klass.rows[0]) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    if (source === 'CLASS_PLAN') {
      const inPlan = await db.query(`SELECT 1 FROM class_plan_concepts WHERE class_id = $1 AND canonical_concept_id = $2 AND status = 'ACTIVE'`, [classId, canonicalConceptId]);
      if (!inPlan.rows[0]) return NextResponse.json({ error: 'NOT_IN_CLASS_PLAN' }, { status: 422 });
      Object.assign(planSource, { key: classId, classId, institutionId: klass.rows[0].institution_id });
    } else {
      const curriculum = await curriculumForClass(classId);
      if (!curriculum?.classifications.has(canonicalConceptId)) return NextResponse.json({ error: 'NOT_IN_CURRICULUM' }, { status: 422 });
      Object.assign(planSource, { key: curriculum.curriculumId, classId, institutionId: klass.rows[0].institution_id });
    }
  }
  const result = await enrollCanonicalConcept(actor.studentId, canonicalConceptId, planSource);
  return NextResponse.json({ success: true, data: result }, { status: result.entryCreated ? 201 : 200 });
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/student/plan', handleGET);
export const POST = withAiRequestMetrics('POST /api/student/plan', handlePOST);
