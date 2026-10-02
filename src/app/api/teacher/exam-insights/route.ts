/**
 * Exam insights for a Teacher's class -- GET /api/teacher/exam-insights?classId=&family=
 * Only a Teacher with an ACTIVE assignment covering this class (or an admin
 * of its institution) -- via the teacher roster. Gaps by domain / objective /
 * concept for the class, per-Student gap concepts (for assigning
 * reinforcement through /api/teacher/interventions), those Students' exam
 * goals (objective first: which exam each prepares), and their
 * AICE Diploma subjects with their readiness. Never other classes' Students.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireActor } from '@/lib/exam-core/route-auth';
import { getTeacherClassRoster } from '@/lib/teacher/read-model.service';
import { db } from '@/lib/db';
import { examGapsFor, examGoalsFor } from '@/lib/exam-core/exam-gaps.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

const UUID = /^[0-9a-f-]{36}$/i;

async function handleGET(request: NextRequest) {
  const gate = await requireActor('/api/teacher/exam-insights', 60);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const sp = new URL(request.url).searchParams;
  const classId = sp.get('classId') ?? '';
  const family = sp.get('family');
  if (!UUID.test(classId) || (family && !/^[A-Z]{2,12}$/.test(family))) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  let roster: Array<{ studentId: string; name: string }>;
  try {
    roster = await getTeacherClassRoster(gate.actorUserId, classId);
  } catch {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }
  const ids = roster.map((r) => r.studentId);
  const [gaps, goals] = await Promise.all([examGapsFor(ids, { families: family ? [family] : undefined, includePerStudent: true }), examGoalsFor(ids, { includePerStudent: true })]);
  const aice = ids.length
    ? (await db.query(
        `SELECT p.student_id, e.syllabus_code, e.level, e.expected_series_year, e.expected_series_month,
                (SELECT n.metadata->'readiness'->>'state' FROM assessment_structure_nodes n WHERE n.status = 'ACTIVE' AND n.node_type = 'LEVEL'
                  AND n.metadata->'bind'->>'configKey' = 'v2.aice.' || e.syllabus_code || '-' || CASE e.level WHEN 'AS' THEN 'as' ELSE 'a' END LIMIT 1) AS readiness
           FROM aice_diploma_plans p JOIN aice_plan_entries e ON e.plan_id = p.id
          WHERE p.student_id = ANY($1::uuid[]) AND p.status = 'ACTIVE' ORDER BY e.syllabus_code`,
        [ids]
      )).rows
    : [];
  return NextResponse.json({ success: true, data: { classId, students: roster, gaps, goals, aice } });
}

export const GET = withAiRequestMetrics('GET /api/teacher/exam-insights', handleGET);
