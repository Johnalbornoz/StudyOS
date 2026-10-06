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
import { studentAudienceDefinitionSql, technicalExamAttemptSql } from './audience';
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
            AND NOT ${technicalExamAttemptSql('sa.exam_attempt_id')}
          ORDER BY sa.student_id, d.id, sa.created_at DESC
       ), gaps AS (
         SELECT l.student_id, l.family, l.exam, l.exam_version_id, (o->>'learningObjectiveId')::uuid AS objective_id
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
         -- G6: the domain is the component of THIS attempt's exam version, never another exam's blueprint
         -- that happens to share the objective.
         LEFT JOIN LATERAL (
           SELECT ac.name FROM blueprint_objective_targets t JOIN assessment_components ac ON ac.id = t.assessment_component_id
             JOIN assessment_blueprints b ON b.id = t.blueprint_id
            WHERE t.learning_objective_id = lo.id AND b.exam_version_id = g.exam_version_id
            ORDER BY ac.sequence_order NULLS LAST, ac.name LIMIT 1
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
  // G6: an objective's gap count is per exam (the same objective in two exams is two requirements).
  const byObjective = [...group((r) => `${r.family}|${r.exam}|${r.objective_id}`).values()].map((rs) => ({ family: rs[0].family, exam: rs[0].exam, code: rs[0].code, description: rs[0].description, students: distinct(rs.map((r) => r.student_id)) }));
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
      WHERE p.student_id = ANY($1::uuid[]) AND p.status <> 'ARCHIVED' AND ${studentAudienceDefinitionSql('d')}
      GROUP BY 1, 2 ORDER BY 3 DESC`,
    [studentIds]
  );
  return r.rows;
}

export interface GoalAggregate {
  /** Distinct Students with at least one active exam preparation. */
  studentsPreparing: number;
  byFramework: Array<{ framework: string; students: number }>;
  /** Each objective prepared, with what StudyUs can do for it today (capability status, not a Student result). */
  byObjective: Array<{ objectiveKey: string; label: string; framework: string; students: number; status: string; canPractice: boolean; canRunMock: boolean }>;
  /** Per Student (Teacher of those Students only): their exam goals. */
  perStudent: Array<{ studentId: string; goals: Array<{ objectiveKey: string; label: string; examDate: string | null }> }>;
}

/**
 * Exam GOALS (objective first) of an authorized Student set: who prepares
 * which exam / qualification, and the capability readiness of each objective.
 * Goals are personal; an institution never blocks or assigns them here.
 */
export async function examGoalsFor(studentIds: string[], opts: { includePerStudent: boolean; language?: string }): Promise<GoalAggregate> {
  const empty: GoalAggregate = { studentsPreparing: 0, byFramework: [], byObjective: [], perStudent: [] };
  if (studentIds.length === 0) return empty;
  const [{ objectiveByKey, objectiveForConfig }, { allObjectiveCapabilities }, { objectiveStatusKey }] = await Promise.all([
    import('./objectives/objective-catalog'),
    import('./objectives/preparation.service'),
    import('./objectives/capabilities'),
  ]);
  const rows = (
    await db.query(
      `SELECT p.student_id, p.objective_key, d.config_key, p.exam_date FROM student_exam_profiles p LEFT JOIN exam_definitions d ON d.id = p.exam_definition_id
        WHERE p.student_id = ANY($1::uuid[]) AND p.status <> 'ARCHIVED'`,
      [studentIds]
    )
  ).rows as Array<{ student_id: string; objective_key: string | null; config_key: string | null; exam_date: string | Date | null }>;
  const caps = await allObjectiveCapabilities(opts.language ?? 'es');
  const goals = rows
    .map((r) => ({ r, o: r.objective_key ? objectiveByKey(r.objective_key) : r.config_key ? objectiveForConfig(r.config_key) : null }))
    .filter((x): x is { r: (typeof rows)[number]; o: NonNullable<ReturnType<typeof objectiveByKey>> } => !!x.o);
  const byObjective = new Map<string, Set<string>>();
  const byFramework = new Map<string, Set<string>>();
  for (const { r, o } of goals) {
    if (!byObjective.has(o.key)) byObjective.set(o.key, new Set());
    byObjective.get(o.key)!.add(r.student_id);
    if (!byFramework.has(o.framework)) byFramework.set(o.framework, new Set());
    byFramework.get(o.framework)!.add(r.student_id);
  }
  return {
    studentsPreparing: new Set(goals.map((g) => g.r.student_id)).size,
    byFramework: [...byFramework.entries()].map(([framework, s]) => ({ framework, students: s.size })).sort((a, b) => b.students - a.students),
    byObjective: [...byObjective.entries()]
      .map(([key, s]) => {
        const o = objectiveByKey(key)!;
        const c = caps.get(key)!;
        return { objectiveKey: key, label: o.label, framework: o.framework, students: s.size, status: objectiveStatusKey(c), canPractice: c.canPractice, canRunMock: c.canRunReducedMock || c.canRunFullMock };
      })
      .sort((a, b) => b.students - a.students),
    perStudent: opts.includePerStudent
      ? [...new Set(goals.map((g) => g.r.student_id))].map((studentId) => ({
          studentId,
          goals: goals.filter((g) => g.r.student_id === studentId).map((g) => ({ objectiveKey: g.o.key, label: g.o.label, examDate: g.r.exam_date ? new Date(g.r.exam_date).toISOString().slice(0, 10) : null })),
        }))
      : [],
  };
}
