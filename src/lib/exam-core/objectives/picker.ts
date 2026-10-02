/**
 * Exam preparation -- data for "¿Para qué examen quieres prepararte?" (server).
 *
 * Every objective, all selectable, with its short status and the Student's own
 * active preparation for it. The academic context only ORDERS / highlights
 * ("Sugerido para tu perfil") -- it never hides an objective and never forces
 * an institution's curriculum on the Student.
 */
import { db } from '@/lib/db';
import { getAcademicProfile } from '@/services/academic-profile.service';
import { examObjectives, OBJECTIVE_FRAMEWORKS, type ObjectiveFramework } from './objective-catalog';
import { allObjectiveCapabilities } from './preparation.service';
import { objectiveStatusKey } from './capabilities';

/** Frameworks compatible with the Student's academic context (pure; suggestions only). */
export function suggestFrameworks(ctx: { countryOfStudy?: string | null; curriculumType?: string | null } | null): ObjectiveFramework[] {
  if (!ctx) return [];
  const out: ObjectiveFramework[] = [];
  if (ctx.curriculumType === 'ib') out.push('IB_DP');
  if (ctx.countryOfStudy === 'CO') out.push('SABER11', 'PISA');
  if (ctx.countryOfStudy === 'MX') out.push('PAA', 'PISA');
  if (ctx.countryOfStudy === 'US' && ctx.curriculumType !== 'ib') out.push('CIE_AICE', 'CIE_AS_A');
  return [...new Set(out)];
}

export async function loadPickerData(studentId: string, language: string) {
  const [caps, mine, profile] = await Promise.all([
    allObjectiveCapabilities(language),
    db.query(`SELECT id, objective_key FROM student_exam_profiles WHERE student_id = $1 AND status <> 'ARCHIVED' AND objective_key IS NOT NULL`, [studentId]),
    getAcademicProfile(studentId).catch(() => null),
  ]);
  const myByKey = new Map(mine.rows.map((r: any) => [r.objective_key as string, r.id as string]));
  const suggested = suggestFrameworks(profile);
  const frameworks = [...OBJECTIVE_FRAMEWORKS].sort((a, b) => Number(suggested.includes(b.key)) - Number(suggested.includes(a.key)));
  return {
    frameworks,
    suggested,
    objectives: examObjectives().map((o) => ({
      key: o.key,
      framework: o.framework,
      kind: o.kind,
      label: o.label,
      context: o.context,
      status: objectiveStatusKey(caps.get(o.key)!),
      preparationId: myByKey.get(o.key) ?? null,
      searchText: o.searchText,
    })),
  };
}
