/**
 * Exam preparation -- GET /api/exam-preparation/objectives?q=&framework=&scope=recommended|all
 *
 * The objectives eligible for THIS Student by default (scope=recommended):
 * curriculum / programme / subject, governed country-grade rules and class
 * assignments -- each with its reason codes. scope=all is the explicit
 * "Buscar otra preparación": every objective of the governed catalogue, each
 * flagged recommended or not. Readiness never hides an objective; each one
 * carries what StudyUs can do for it today (server-computed capabilities) and
 * the Student's own active preparation for it, if any.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { examObjectives, searchObjectives, OBJECTIVE_FRAMEWORKS } from '@/lib/exam-core/objectives/objective-catalog';
import { allObjectiveCapabilities } from '@/lib/exam-core/objectives/preparation.service';
import { objectiveStatusKey } from '@/lib/exam-core/objectives/capabilities';
import { resolveStudentExamEligibility } from '@/lib/exam-core/eligibility/eligibility.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { studentGate } from '../route-helpers';

async function handleGET(request: NextRequest) {
  const gate = await studentGate();
  if (!gate.ok) return gate.res;
  const sp = new URL(request.url).searchParams;
  const q = (sp.get('q') ?? '').slice(0, 100);
  const framework = sp.get('framework');
  const scope = sp.get('scope') === 'all' ? 'all' : 'recommended';
  const lang = (sp.get('lang') ?? 'es').slice(0, 5);
  const objectives = examObjectives();
  const [caps, mine, eligibility] = await Promise.all([
    allObjectiveCapabilities(lang),
    db.query(`SELECT id, objective_key FROM student_exam_profiles WHERE student_id = $1 AND status <> 'ARCHIVED' AND objective_key IS NOT NULL`, [gate.studentId]),
    resolveStudentExamEligibility(gate.studentId, objectives),
  ]);
  const myByKey = new Map(mine.rows.map((r: any) => [r.objective_key, r.id]));
  const list = searchObjectives(q, objectives)
    .filter((o) => !framework || o.framework === framework)
    .filter((o) => scope === 'all' || eligibility.byKey.get(o.key)?.eligible);
  return NextResponse.json({
    success: true,
    data: {
      scope,
      frameworks: OBJECTIVE_FRAMEWORKS,
      objectives: list.map((o) => {
        const c = caps.get(o.key)!;
        const e = eligibility.byKey.get(o.key)!;
        return {
          key: o.key, framework: o.framework, kind: o.kind, label: o.label, context: o.context, selectable: true,
          recommended: e.eligible, reasons: e.reasons.map((r) => r.code),
          status: objectiveStatusKey(c), readiness: c.readiness, capabilities: c, preparationId: myByKey.get(o.key) ?? null,
        };
      }),
    },
  });
}

export const GET = withAiRequestMetrics('GET /api/exam-preparation/objectives', handleGET);
