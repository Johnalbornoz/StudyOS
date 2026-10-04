/**
 * Exam preparation -- GET /api/exam-preparation/objectives?q=&framework=
 *
 * Every objective of the governed catalogue, ALL selectable, each with what
 * StudyUs can do for it today (server-computed capabilities) and the Student's
 * own active preparation for it, if any. Filters and search never hide an
 * objective because of its readiness.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { examObjectives, searchObjectives, OBJECTIVE_FRAMEWORKS } from '@/lib/exam-core/objectives/objective-catalog';
import { allObjectiveCapabilities } from '@/lib/exam-core/objectives/preparation.service';
import { objectiveStatusKey } from '@/lib/exam-core/objectives/capabilities';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { studentGate } from '../route-helpers';

async function handleGET(request: NextRequest) {
  const gate = await studentGate();
  if (!gate.ok) return gate.res;
  const sp = new URL(request.url).searchParams;
  const q = (sp.get('q') ?? '').slice(0, 100);
  const framework = sp.get('framework');
  const lang = (sp.get('lang') ?? 'es').slice(0, 5);
  const [caps, mine] = await Promise.all([
    allObjectiveCapabilities(lang),
    db.query(`SELECT id, objective_key FROM student_exam_profiles WHERE student_id = $1 AND status <> 'ARCHIVED' AND objective_key IS NOT NULL`, [gate.studentId]),
  ]);
  const myByKey = new Map(mine.rows.map((r: any) => [r.objective_key, r.id]));
  const list = searchObjectives(q, examObjectives()).filter((o) => !framework || o.framework === framework);
  return NextResponse.json({
    success: true,
    data: {
      frameworks: OBJECTIVE_FRAMEWORKS,
      objectives: list.map((o) => {
        const c = caps.get(o.key)!;
        return { key: o.key, framework: o.framework, kind: o.kind, label: o.label, context: o.context, selectable: true, status: objectiveStatusKey(c), readiness: c.readiness, capabilities: c, preparationId: myByKey.get(o.key) ?? null };
      }),
    },
  });
}

export const GET = withAiRequestMetrics('GET /api/exam-preparation/objectives', handleGET);
