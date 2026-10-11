/**
 * Exam insights for a Teacher's class -- GET /api/teacher/exam-insights?classId=&family=
 * Only a Teacher with an ACTIVE assignment covering this class. An admin
 * (Coordinator) of the class's institution is NOT admitted here (L8 TE-2:
 * per-Student detail belongs to the class's Teacher). Gaps by domain /
 * objective / concept for the class, per-Student gap concepts (for assigning
 * reinforcement through /api/teacher/interventions), those Students' exam
 * goals (objective first: which exam each prepares), and their
 * AICE Diploma subjects with their readiness. Never other classes' Students.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireActor } from '@/lib/exam-core/route-auth';
import { getTeacherClassExamInsights, TeacherExamInsightsAccessDeniedError } from '@/lib/teacher/exam-insights.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

const UUID = /^[0-9a-f-]{36}$/i;

async function handleGET(request: NextRequest) {
  const gate = await requireActor('/api/teacher/exam-insights', 60);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const sp = new URL(request.url).searchParams;
  const classId = sp.get('classId') ?? '';
  const family = sp.get('family');
  if (!UUID.test(classId) || (family && !/^[A-Z]{2,12}$/.test(family))) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  let insights;
  try {
    insights = await getTeacherClassExamInsights(gate.actorUserId, classId, { family });
  } catch (error) {
    if (error instanceof TeacherExamInsightsAccessDeniedError) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    throw error;
  }
  const { students, gaps, goals, aice } = insights;
  return NextResponse.json({ success: true, data: { classId, students, gaps, goals, aice } });
}

export const GET = withAiRequestMetrics('GET /api/teacher/exam-insights', handleGET);
