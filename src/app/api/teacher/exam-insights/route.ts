/**
 * Exam insights for a Teacher's class -- GET /api/teacher/exam-insights?classId=&family=
 * Only a Teacher with an ACTIVE assignment covering this class -- never an
 * admin of its institution (L10 SF-4). Gaps within the class's own subject
 * only (CR-L8-01): by concept for the class, per-Student gap concepts (for assigning
 * reinforcement through /api/teacher/interventions). Exam goals and AICE
 * entries are subject-scoped as well and cannot be attributed to a subject
 * yet, so they are returned empty (`withheld` names them). Never other
 * classes' Students.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireActor } from '@/lib/exam-core/route-auth';
import { getTeacherClassRoster } from '@/lib/teacher/read-model.service';
import { getTeacherClassExamGaps } from '@/lib/authorization/teacher-exam-scope';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

const UUID = /^[0-9a-f-]{36}$/i;

async function handleGET(request: NextRequest) {
  const gate = await requireActor('/api/teacher/exam-insights', 60);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const sp = new URL(request.url).searchParams;
  const classId = sp.get('classId') ?? '';
  const family = sp.get('family');
  if (!UUID.test(classId) || (family && !/^[A-Z]{2,12}$/.test(family))) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  // L10 SF-4 / CR-L8-01: the class's TEACHER only (never an institution admin), and gaps only within
  // the class's own canonical subject -- both enforced in the one shared entry point.
  let roster: Array<{ studentId: string; name: string }>;
  let scoped;
  try {
    scoped = await getTeacherClassExamGaps(gate.actorUserId, classId, { family });
    roster = await getTeacherClassRoster(gate.actorUserId, classId);
  } catch {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }
  // Goals and AICE entries are subject-scoped too (L10-R1) and cannot be attributed to a subject yet:
  // the shared entry point returns them empty and says what was withheld. Nothing is read here.
  const { gaps, goals, aice, withheld } = scoped;
  return NextResponse.json({ success: true, data: { classId, students: roster, gaps, goals, aice, withheld } });
}

export const GET = withAiRequestMetrics('GET /api/teacher/exam-insights', handleGET);
