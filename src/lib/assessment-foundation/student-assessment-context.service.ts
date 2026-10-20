/**
 * B1 -- loads a StudentAssessmentContext from the existing authorities. Read-only: nothing is created,
 * matched or repaired here.
 */
import { loadResolvedStudentContext } from '@/lib/student/student-context.server';
import { resolveStudentConceptIdentities } from '@/lib/catalog/concept-identity.service';
import { publishedScopeRefForSubject } from '@/lib/curriculum/curriculum-scope.service';
import type { CurriculumScopeRef } from '@/lib/curriculum/curriculum-scope';
import { loadPreparationContext } from './preparation-context.service';
import { composeStudentAssessmentContext, validateAssessmentIntent, type AssessmentIntent, type IntentIssue, type StudentAssessmentContext } from './student-assessment-context';

export type StudentAssessmentContextResult = { ok: true; context: StudentAssessmentContext } | { ok: false; issues: IntentIssue[] };

export async function loadStudentAssessmentContext(studentId: string, intent: AssessmentIntent): Promise<StudentAssessmentContextResult> {
  const [student, concepts, preparation] = await Promise.all([
    loadResolvedStudentContext(studentId),
    resolveStudentConceptIdentities(studentId),
    intent.examTargetId ? loadPreparationContext(intent.examTargetId) : Promise.resolve(null),
  ]);
  const issues = validateAssessmentIntent(studentId, intent, preparation);
  if (issues.length > 0) return { ok: false, issues };
  const academicSubjectIds = [...new Set(student.profileSubjects.map((s) => s.academicSubjectId))];
  const profileScopes = (await Promise.all(academicSubjectIds.map((id) => publishedScopeRefForSubject(id)))).filter((x): x is CurriculumScopeRef => !!x);
  return {
    ok: true,
    context: composeStudentAssessmentContext({
      studentId,
      intent,
      academic: {
        contextType: student.contextType,
        profileCompleted: student.profileCompleted,
        programme: student.programme ? { id: student.programme.id, name: student.programme.name } : null,
        qualification: student.qualification,
        academicSubjectIds,
      },
      concepts,
      preparation,
      profileScopes,
    }),
  };
}
