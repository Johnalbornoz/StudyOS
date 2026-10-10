/**
 * B1 -- PreparationContext reads over `student_exam_profiles`. Read-only; composes the existing resolvers
 * (exam-profile resolution, curriculum scope) and never writes a target.
 */
import { db } from '@/lib/db';
import { getStudentExamProfile, listStudentExamProfiles } from '@/lib/assessment/student-exam-profile.service';
import type { PreparationGoal, StudentExamProfile } from '@/lib/assessment/types';
import { resolveExamProfiles } from '@/lib/learning-plan/exam-profile-resolution';
import { publishedScopeRefForSubject } from '@/lib/curriculum/curriculum-scope.service';
import type { CurriculumScopeRef } from '@/lib/curriculum/curriculum-scope';
import { projectPreparationContext, type PreparationContext } from './preparation-context';

async function goalsFor(profileIds: string[]): Promise<Map<string, PreparationGoal[]>> {
  const out = new Map<string, PreparationGoal[]>();
  if (profileIds.length === 0) return out;
  const r = await db.query(`SELECT id, student_exam_profile_id, goal_type, target_value, competency_id FROM preparation_goals WHERE student_exam_profile_id = ANY($1::uuid[]) ORDER BY created_at`, [profileIds]).catch(() => ({ rows: [] as any[] }));
  for (const g of r.rows) {
    const goal: PreparationGoal = { id: g.id, studentExamProfileId: g.student_exam_profile_id, goalType: g.goal_type, targetValue: g.target_value, competencyId: g.competency_id };
    out.set(goal.studentExamProfileId, [...(out.get(goal.studentExamProfileId) ?? []), goal]);
  }
  return out;
}

async function project(profiles: StudentExamProfile[]): Promise<PreparationContext[]> {
  if (profiles.length === 0) return [];
  const [resolved, goals] = await Promise.all([
    resolveExamProfiles(profiles.map((p) => ({ id: p.id, examDefinitionId: p.examDefinitionId, examVersionId: p.examVersionId, objectiveKey: p.objectiveKey ?? null, objectiveContext: p.objectiveContext ?? null }))),
    goalsFor(profiles.map((p) => p.id)),
  ]);
  const subjectIds = [...new Set(profiles.flatMap((p) => resolved.get(p.id)?.academicSubjectIds ?? []))];
  const refs = new Map<string, CurriculumScopeRef>();
  await Promise.all(
    subjectIds.map(async (id) => {
      const ref = await publishedScopeRefForSubject(id);
      if (ref) refs.set(id, ref);
    })
  );
  return profiles.map((p) => {
    const r = resolved.get(p.id) ?? null;
    const scopes = (r?.academicSubjectIds ?? []).map((id) => refs.get(id)).filter((x): x is CurriculumScopeRef => !!x);
    return projectPreparationContext(p, r, goals.get(p.id) ?? [], scopes);
  });
}

export async function loadPreparationContext(examTargetId: string): Promise<PreparationContext | null> {
  const profile = await getStudentExamProfile(examTargetId);
  if (!profile) return null;
  return (await project([profile]))[0] ?? null;
}

/** Every non-archived exam target of the Student, newest first. */
export async function loadPreparationContexts(studentId: string): Promise<PreparationContext[]> {
  return project(await listStudentExamProfiles(studentId));
}
