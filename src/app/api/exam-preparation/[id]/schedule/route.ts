/**
 * Student Exam Journey -- J3.4 PATCH /api/exam-preparation/[id]/schedule
 *
 * The Student's own scheduling facts for one Exam Target, each kept apart:
 *   examDate            -> the legacy `exam_date` (the exam date as the Student knows it:
 *                          STUDENT_REPORTED_EXAM_DATE, never official), through the existing service;
 *   personalTargetDate  -> "¿Para cuándo quieres estar listo?" (never an exam date, never official);
 *   estimatedMonth      -> YYYY-MM only (never turned into a day).
 * Official sessions are never written here (none are loaded; they come from the Blueprint /
 * the institution). Owner-only; exists only with STUDENT_JOURNEY_V2=UX. On a database without
 * the J3.2 columns, the personal date and the month are refused (409), never faked.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { isStudentJourneyUxEnabled } from '@/lib/exam-journey/feature-flag';
import { loadExamTargetRow, scheduleColumnsAvailable } from '@/lib/exam-journey/ux.server';
import { resolveTargetSchedule, scheduleFactsFromRow, validateTargetSchedule } from '@/lib/exam-journey/exam-target';
import { updatePreparationDetails } from '@/lib/exam-core/objectives/preparation.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { studentGate, preparationErrorResponse } from '../../route-helpers';

const Id = z.string().uuid();
const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const Body = z.strictObject({ examDate: DAY.nullable().optional(), personalTargetDate: DAY.nullable().optional(), estimatedMonth: MONTH.nullable().optional() });

async function handlePATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!isStudentJourneyUxEnabled()) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const gate = await studentGate('/api/exam-preparation/schedule', 30);
  if (!gate.ok) return gate.res;
  const id = Id.safeParse((await ctx.params).id);
  if (!id.success) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  const body = parsed.data;
  const row = await loadExamTargetRow(id.data, gate.studentId);
  if (!row || row.status === 'ARCHIVED') return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const touchesNewFields = body.personalTargetDate !== undefined || body.estimatedMonth !== undefined;
  if (touchesNewFields && !(await scheduleColumnsAvailable())) return NextResponse.json({ error: 'SCHEDULE_FIELDS_UNAVAILABLE' }, { status: 409 });

  const next = {
    ...row,
    ...(body.examDate !== undefined ? { exam_date: body.examDate } : {}),
    ...(body.personalTargetDate !== undefined ? { personal_target_date: body.personalTargetDate } : {}),
    ...(body.estimatedMonth !== undefined ? { estimated_exam_month: body.estimatedMonth } : {}),
  };
  const issues = validateTargetSchedule(scheduleFactsFromRow(next));
  if (issues.length) return NextResponse.json({ error: issues[0].code, field: issues[0].field }, { status: 400 });

  try {
    if (body.examDate !== undefined) await updatePreparationDetails(gate.studentId, id.data, { examDate: body.examDate });
    if (touchesNewFields) {
      const provenance: Record<string, string> = {};
      if (body.personalTargetDate) provenance.personalTargetDate = 'STUDENT_ENTERED';
      if (body.estimatedMonth) provenance.estimatedMonth = 'STUDENT_ENTERED';
      await db.query(
        `UPDATE student_exam_profiles
            SET personal_target_date = CASE WHEN $3::boolean THEN $4::date ELSE personal_target_date END,
                estimated_exam_month = CASE WHEN $5::boolean THEN $6::text ELSE estimated_exam_month END,
                field_provenance = field_provenance || $7::jsonb,
                updated_at = now()
          WHERE id = $1 AND student_id = $2 AND status <> 'ARCHIVED'`,
        [id.data, gate.studentId, body.personalTargetDate !== undefined, body.personalTargetDate ?? null, body.estimatedMonth !== undefined, body.estimatedMonth ?? null, JSON.stringify(provenance)]
      );
    }
  } catch (err) {
    return preparationErrorResponse(err);
  }
  const saved = await loadExamTargetRow(id.data, gate.studentId);
  const schedule = resolveTargetSchedule(scheduleFactsFromRow(saved ?? next));
  return NextResponse.json({ success: true, data: { targetDateSource: schedule.targetDateSource, officialSession: schedule.officialSession === 'UNKNOWN' ? 'UNKNOWN' : 'KNOWN' } });
}

export const PATCH = withAiRequestMetrics('PATCH /api/exam-preparation/[id]/schedule', handlePATCH);
