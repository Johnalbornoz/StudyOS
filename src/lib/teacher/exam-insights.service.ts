/**
 * L8 (TE-2) -- exam insights of ONE class, for its Teacher only.
 *
 * Product ruling: a Teacher may see per-Student exam gaps and goals only for
 * Students of a class they teach; a Coordinator does not inherit that detail
 * through the Teacher surface. So the gate here is `getTeacherClass` (an
 * APPROVED TEACHER membership with an ACTIVE assignment covering this class)
 * and NOT `canAccessClass`, which also admits the institution's admins. The
 * roster read keeps its own guard as a second check.
 *
 * Projection only: gaps and goals come from the exam bridge's own
 * aggregations (`examGapsFor`, `examGoalsFor`), limited to the class's ACTIVE
 * roster. Nothing here scores, classifies or writes.
 */
import { db } from '@/lib/db';
import { stateSql } from '@/lib/exam-core/catalog/readiness-view';
import { examGapsFor, examGoalsFor, type GapAggregate, type GoalAggregate } from '@/lib/exam-core/exam-gaps.service';
import { getTeacherClass, type TeacherClassContext } from './class-assignment.service';
import { getTeacherClassRoster, type TeacherRosterStudent } from './read-model.service';

export class TeacherExamInsightsAccessDeniedError extends Error {
  constructor(classId: string) {
    super(`actor is not a teacher of class ${classId}`);
    this.name = 'TeacherExamInsightsAccessDeniedError';
  }
}

export interface AicePlanEntryRow {
  student_id: string;
  syllabus_code: string;
  level: string;
  expected_series_year: number | null;
  expected_series_month: number | null;
  readiness: string | null;
}

export interface TeacherClassExamInsights {
  klass: TeacherClassContext;
  students: TeacherRosterStudent[];
  gaps: GapAggregate;
  goals: GoalAggregate;
  aice: AicePlanEntryRow[];
}

export async function getTeacherClassExamInsights(actorUserId: string, classId: string, opts: { family?: string | null } = {}): Promise<TeacherClassExamInsights> {
  const klass = await getTeacherClass(actorUserId, classId);
  if (!klass) throw new TeacherExamInsightsAccessDeniedError(classId);
  let students: TeacherRosterStudent[];
  try {
    students = await getTeacherClassRoster(actorUserId, classId);
  } catch {
    throw new TeacherExamInsightsAccessDeniedError(classId);
  }
  const ids = students.map((s) => s.studentId);
  const [gaps, goals] = await Promise.all([
    examGapsFor(ids, { families: opts.family ? [opts.family] : undefined, includePerStudent: true }),
    examGoalsFor(ids, { includePerStudent: true }),
  ]);
  const aice: AicePlanEntryRow[] = ids.length
    ? (
        await db.query(
          `SELECT p.student_id, e.syllabus_code, e.level, e.expected_series_year, e.expected_series_month,
                  (SELECT ${stateSql('n', 'STUDENT')} FROM assessment_structure_nodes n WHERE n.status = 'ACTIVE' AND n.node_type = 'LEVEL'
                    AND n.metadata->'bind'->>'configKey' = 'v2.aice.' || e.syllabus_code || '-' || CASE e.level WHEN 'AS' THEN 'as' ELSE 'a' END LIMIT 1) AS readiness
             FROM aice_diploma_plans p JOIN aice_plan_entries e ON e.plan_id = p.id
            WHERE p.student_id = ANY($1::uuid[]) AND p.status = 'ACTIVE' ORDER BY e.syllabus_code`,
          [ids]
        )
      ).rows
    : [];
  return { klass, students, gaps, goals, aice };
}

export interface StudentExamInsightRow {
  studentId: string;
  name: string;
  goals: Array<{ objectiveKey: string; label: string; examDate: string | null }>;
  /** Objectives classified GAP or DEVELOPING in the latest scored attempt of each exam; 0 when none is recorded. */
  gaps: number;
  concepts: Array<{ canonicalConceptId: string; name: string }>;
  aice: Array<{ syllabusCode: string; level: string; series: string | null }>;
}

/**
 * Pure: one row per roster Student, most gaps first. A Student that is not
 * on the roster never produces a row, whatever the aggregates contain.
 */
export function examInsightsByStudent(data: Pick<TeacherClassExamInsights, 'students' | 'gaps' | 'goals' | 'aice'>): StudentExamInsightRow[] {
  const gapsOf = new Map(data.gaps.perStudent.map((p) => [p.studentId, p]));
  const goalsOf = new Map(data.goals.perStudent.map((p) => [p.studentId, p.goals]));
  return data.students
    .map((s) => ({
      studentId: s.studentId,
      name: s.name,
      goals: goalsOf.get(s.studentId) ?? [],
      gaps: gapsOf.get(s.studentId)?.gaps ?? 0,
      concepts: (gapsOf.get(s.studentId)?.concepts ?? []).map((c) => ({ canonicalConceptId: c.canonicalConceptId, name: c.name })),
      aice: data.aice
        .filter((a) => a.student_id === s.studentId)
        .map((a) => ({
          syllabusCode: a.syllabus_code,
          level: a.level,
          series: a.expected_series_year ? `${a.expected_series_year}${a.expected_series_month ? `-${String(a.expected_series_month).padStart(2, '0')}` : ''}` : null,
        })),
    }))
    .sort((a, b) => b.gaps - a.gaps || a.name.localeCompare(b.name));
}
