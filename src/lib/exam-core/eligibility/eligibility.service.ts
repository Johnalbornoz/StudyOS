/**
 * Exam eligibility -- server entry points.
 *
 * resolveStudentExamEligibility: every preparation objective with its eligibility
 * for THIS Student (context + evidence graph + governed rules + class
 * assignments). Callers decide presentation: recommended first, the rest only on
 * explicit request ("Buscar otra preparación").
 */
import { examObjectives, type ExamObjective } from '../objectives/objective-catalog';
import { loadEligibilityGraph } from './graph';
import { loadStudentAcademicContext } from './academic-context';
import { resolveObjectiveEligibility, type ObjectiveEligibility, type StudentAcademicContext } from './rules';

export interface StudentExamEligibility {
  context: StudentAcademicContext;
  byKey: Map<string, ObjectiveEligibility>;
}

export async function resolveStudentExamEligibility(studentId: string, objectives: ExamObjective[] = examObjectives()): Promise<StudentExamEligibility> {
  const graph = await loadEligibilityGraph();
  const context = await loadStudentAcademicContext(studentId, graph);
  const list = resolveObjectiveEligibility(objectives, context, graph);
  return { context, byKey: new Map(list.map((e) => [e.key, e])) };
}

/** The eligibility of one objective for one Student. */
export async function objectiveEligibilityForStudent(studentId: string, objective: ExamObjective): Promise<ObjectiveEligibility> {
  const { byKey } = await resolveStudentExamEligibility(studentId, [objective]);
  return byKey.get(objective.key)!;
}
