/**
 * F12 -- Diagnostic / Gap Intelligence (task section 21). Reads ONLY
 * the already-persisted `learner_gap_diagnoses` table (F8's own real
 * writer, `runDiagnosis`/`replayDiagnosis`) -- never re-invokes
 * `runDiagnosis` per learner (which would be both an N+1 query pattern
 * and a second, institution-specific diagnostic judgment). Aggregates
 * the LATEST diagnosis per (student, concept, scope-key) so a replayed/
 * superseded historical diagnosis never double-counts against a
 * learner who has since been re-diagnosed.
 */
import { db } from '@/lib/db';
import { requireInstitutionAccess } from './authorization';
import { buildMetric, nowIso, type AnalyticsScope, type MetricEnvelope } from './types';

export type GapType = 'KNOWLEDGE_GAP' | 'SKILL_GAP' | 'EXAM_TECHNIQUE_GAP' | 'SPEED_FLUENCY_GAP' | 'MIXED' | 'INSUFFICIENT_EVIDENCE';

export interface DiagnosticSummary {
  scope: AnalyticsScope;
  distribution: MetricEnvelope<Record<GapType, number>>;
}

export async function getInstitutionDiagnosticSummary(actorUserId: string, institutionId: string, filters?: { classId?: string }): Promise<DiagnosticSummary> {
  await requireInstitutionAccess(actorUserId, institutionId);

  const params: unknown[] = [institutionId];
  let classFilter = '';
  if (filters?.classId) {
    params.push(filters.classId);
    classFilter = `AND ce.class_id = $${params.length}`;
  }

  const result = await db.query(
    `
    WITH latest_diagnoses AS (
      SELECT DISTINCT ON (lgd.student_id, lgd.concept_id, lgd.scope) lgd.student_id, lgd.primary_gap_type
      FROM learner_gap_diagnoses lgd
      JOIN class_enrollments ce ON ce.student_id = lgd.student_id AND ce.status = 'ACTIVE'
      JOIN classes c ON c.id = ce.class_id AND c.institution_id = $1
      WHERE 1 = 1 ${classFilter}
      ORDER BY lgd.student_id, lgd.concept_id, lgd.scope, lgd.computed_at DESC
    )
    SELECT primary_gap_type, COUNT(*)::int AS c FROM latest_diagnoses GROUP BY primary_gap_type
    `,
    params
  );

  const distribution: Record<string, number> = {};
  let total = 0;
  for (const row of result.rows as Array<{ primary_gap_type: GapType; c: number }>) {
    distribution[row.primary_gap_type] = row.c;
    total += row.c;
  }

  const scope: AnalyticsScope = filters?.classId ? { type: 'CLASS', id: filters.classId } : { type: 'INSTITUTION', id: institutionId };

  return {
    scope,
    distribution: buildMetric({
      metricId: 'DIAGNOSTIC_GAP_DISTRIBUTION', name: 'Latest Diagnosed Gap Type Distribution', scope,
      timeWindow: { type: 'LIFETIME', asOf: nowIso() },
      populationDescription: 'latest (student, concept, scope) diagnosis rows for active learners in scope', populationCount: total,
      numerator: total, dataSource: 'learner_gap_diagnoses (F8, latest per student/concept/scope)',
      limitations: ['this is F8\'s own classification, never re-run or re-interpreted by F12 (F8 remains the sole diagnostic authority)'],
      value: distribution as Record<GapType, number>,
    }),
  };
}
