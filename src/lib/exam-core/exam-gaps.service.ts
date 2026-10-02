/**
 * Exam gaps -- class / institution aggregation of academic gaps from exam
 * results (PISA, Cambridge AICE and every V2 vertical), for Teachers and
 * Coordinators. Callers authorize the Student set first (teacher roster /
 * institution enrolment); this service never widens it.
 *
 * Source: each Student's LATEST scored attempt per exam definition; an
 * objective counts as a gap when classified GAP or DEVELOPING. Aggregated by
 * domain (component), objective (competency / process / topic) and canonical
 * concept, as numbers of distinct Students -- never individual answers.
 * One query for the whole set (no per-Student round trips).
 */
import { db } from '@/lib/db';

export interface GapAggregate {
  studentsWithResults: number;
  byDomain: Array<{ family: string; exam: string; domain: string; students: number }>;
  byObjective: Array<{ family: string; exam: string; code: string | null; description: string; students: number }>;
  byConcept: Array<{ canonicalConceptId: string; name: string; students: number; studentIds: string[] }>;
  /** Per Student: number of gap objectives and the concepts behind them (only for the Teacher of those Students). */
  perStudent: Array<{ studentId: string; gaps: number; concepts: Array<{ canonicalConceptId: string; name: string; studentConceptId: string | null }> }>;
}

export async function examGapsFor(studentIds: string[], opts: { families?: string[]; includePerStudent: boolean }): Promise<GapAggregate> {
  if (studentIds.length === 0) return { studentsWithResults: 0, byDomain: [], byObjective: [], byConcept: [], perStudent: [] };
  const rows = (
    await db.query(
      `WITH latest AS (
         SELECT DISTINCT ON (sa.student_id, d.id) sa.student_id, d.id AS definition_id, d.name AS exam, d.exam_family AS family, r.objective_results, sa.exam_version_id
           FROM simulation_attempts sa
           JOIN exam_attempt_results r ON r.exam_attempt_id = sa.exam_attempt_id AND r.status = 'SCORED'
           JOIN exam_versions v ON v.id = sa.exam_version_id
           JOIN exam_definitions d ON d.id = v.exam_definition_id
          WHERE sa.student_id = ANY($1::uuid[]) AND sa.hidden_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM exam_instances i WHERE i.simulation_attempt_id = sa.id AND i.status = 'DELETED')
            AND ($2::text[] IS NULL OR d.exam_family = ANY($2::text[]))
          ORDER BY sa.student_id, d.id, sa.created_at DESC
       ), gaps AS (
         SELECT l.student_id, l.family, l.exam, (o->>'learningObjectiveId')::uuid AS objective_id
           FROM latest l, jsonb_array_elements(l.objective_results) o
          WHERE o->>'classification' IN ('GAP', 'DEVELOPING')
       )
       SELECT g.student_id, g.family, g.exam, lo.id AS objective_id, lo.code, lo.description,
              COALESCE(ac.name, '') AS domain,
              cc.id AS canonical_concept_id, cc.name AS concept_name,
              (SELECT c.id FROM concepts c JOIN subjects s ON s.id = c.subject_id JOIN concept_catalog_mapping ccm ON ccm.learner_concept_id = c.id
                WHERE s.student_id = g.student_id AND ccm.canonical_concept_id = cc.id AND ccm.status = 'MATCHED' LIMIT 1) AS student_concept_id
         FROM gaps g
         JOIN learning_objectives lo ON lo.id = g.objective_id
         LEFT JOIN LATERAL (
           SELECT ac.name FROM blueprint_objective_targets t JOIN assessment_components ac ON ac.id = t.assessment_component_id
            WHERE t.learning_objective_id = lo.id LIMIT 1
         ) ac ON true
         LEFT JOIN objective_concept_mappings m ON m.learning_objective_id = lo.id AND m.status = 'PUBLISHED'
         LEFT JOIN canonical_concepts cc ON cc.id = m.canonical_concept_id`,
      [studentIds, opts.families?.length ? opts.families : null]
    )
  ).rows as Array<{ student_id: string; family: string; exam: string; objective_id: string; code: string | null; description: string; domain: string; canonical_concept_id: string | null; concept_name: string | null; student_concept_id: string | null }>;

  const distinct = (xs: string[]) => new Set(xs).size;
  const group = <K extends string>(keyOf: (r: (typeof rows)[number]) => K) => {
    const m = new Map<K, typeof rows>();
    for (const r of rows) m.set(keyOf(r), [...(m.get(keyOf(r)) ?? []), r]);
    return m;
  };
  const byDomain = [...group((r) => `${r.family}|${r.exam}|${r.domain}`).values()].map((rs) => ({ family: rs[0].family, exam: rs[0].exam, domain: rs[0].domain, students: distinct(rs.map((r) => r.student_id)) }));
  const byObjective = [...group((r) => r.objective_id).values()].map((rs) => ({ family: rs[0].family, exam: rs[0].exam, code: rs[0].code, description: rs[0].description, students: distinct(rs.map((r) => r.student_id)) }));
  const withConcept = rows.filter((r) => r.canonical_concept_id);
  const byConcept = [...new Map(withConcept.map((r) => [r.canonical_concept_id!, r])).keys()].map((id) => {
    const rs = withConcept.filter((r) => r.canonical_concept_id === id);
    return { canonicalConceptId: id, name: rs[0].concept_name ?? '', students: distinct(rs.map((r) => r.student_id)), studentIds: [...new Set(rs.map((r) => r.student_id))] };
  });
  const sort = <T extends { students: number }>(xs: T[]) => xs.sort((a, b) => b.students - a.students);
  return {
    studentsWithResults: distinct(rows.map((r) => r.student_id)),
    byDomain: sort(byDomain),
    byObjective: sort(byObjective),
    byConcept: sort(byConcept).map((c) => (opts.includePerStudent ? c : { ...c, studentIds: [] })),
    perStudent: opts.includePerStudent
      ? [...group((r) => r.student_id).values()].map((rs) => ({
          studentId: rs[0].student_id,
          gaps: distinct(rs.map((r) => r.objective_id)),
          concepts: [...new Map(rs.filter((r) => r.canonical_concept_id).map((r) => [r.canonical_concept_id!, { canonicalConceptId: r.canonical_concept_id!, name: r.concept_name ?? '', studentConceptId: r.student_concept_id }])).values()],
        }))
      : [],
  };
}

/** Students of an institution preparing each exam family (participation; no individual results). */
export async function examParticipation(studentIds: string[]): Promise<Array<{ family: string; exam: string; students: number }>> {
  if (studentIds.length === 0) return [];
  const r = await db.query(
    `SELECT d.exam_family AS family, d.name AS exam, count(DISTINCT p.student_id)::int AS students
       FROM student_exam_profiles p JOIN exam_definitions d ON d.id = p.exam_definition_id
      WHERE p.student_id = ANY($1::uuid[]) AND p.status <> 'ARCHIVED'
      GROUP BY 1, 2 ORDER BY 3 DESC`,
    [studentIds]
  );
  return r.rows;
}
