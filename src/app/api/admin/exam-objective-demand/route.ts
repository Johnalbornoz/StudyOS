/**
 * Internal (STUDYUS_ADMIN) -- GET /api/admin/exam-objective-demand
 *
 * "Most requested exam preparations without practice support": counts of the
 * `exam_objective_selected` telemetry (distinct Students per objective),
 * with the objective's CURRENT capability status, to prioritise which banks to
 * build. Aggregates only: no Student identities, no answers.
 */
import { NextResponse } from 'next/server';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { db } from '@/lib/db';
import { objectiveByKey } from '@/lib/exam-core/objectives/objective-catalog';
import { allObjectiveCapabilities } from '@/lib/exam-core/objectives/preparation.service';
import { objectiveStatusKey } from '@/lib/exam-core/objectives/capabilities';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

async function handleGET() {
  const guard = await guardAdminUsersRoute('admin.examObjectiveDemand');
  if ('error' in guard) return guard.error;
  const [rows, caps] = await Promise.all([
    db.query(
      `SELECT properties->>'objectiveKey' AS objective_key, count(DISTINCT student_id)::int AS students,
              count(DISTINCT student_id) FILTER (WHERE (properties->>'practiceAvailable')::boolean IS NOT TRUE)::int AS without_practice_at_selection
         FROM analytics_events WHERE event_name = 'exam_objective_selected' AND properties ? 'objectiveKey'
        GROUP BY 1 ORDER BY 2 DESC LIMIT 200`
    ),
    allObjectiveCapabilities('es'),
  ]);
  const objectives = rows.rows
    .map((r: any) => {
      const o = objectiveByKey(r.objective_key);
      const c = caps.get(r.objective_key);
      return o && c ? { objectiveKey: o.key, label: o.label, framework: o.framework, students: r.students, withoutPracticeAtSelection: r.without_practice_at_selection, currentStatus: objectiveStatusKey(c), practiceNow: c.canPractice } : null;
    })
    .filter(Boolean);
  return NextResponse.json({
    success: true,
    data: {
      mostRequestedWithoutPractice: objectives.filter((o: any) => !o.practiceNow),
      all: objectives,
    },
  });
}

export const GET = withAiRequestMetrics('GET /api/admin/exam-objective-demand', handleGET);
