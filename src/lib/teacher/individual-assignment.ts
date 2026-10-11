/**
 * L8 (TE-1) -- the topics the individual practice form may offer for ONE
 * learner of ONE class: the learner's own concepts that are MATCHED to a
 * topic of the class's subject. Built from an already-authorized
 * TeacherLearnerView, so it can never list a concept of another subject or
 * of another learner; the route re-checks ownership of the chosen concept.
 */
import { resolveStudentConceptForCanonicalConcept } from '@/lib/readiness/student-concept-resolution.service';
import type { TeacherLearnerView } from './learner-view.service';

export interface IndividualAssignmentConcept {
  conceptId: string;
  label: string;
  subjectName: string;
}

export async function listIndividualAssignmentConcepts(
  view: Pick<TeacherLearnerView, 'student' | 'klass' | 'concepts'>,
  resolve: (studentId: string, canonicalConceptId: string) => Promise<string | null> = resolveStudentConceptForCanonicalConcept
): Promise<IndividualAssignmentConcept[]> {
  const subjectName = view.klass.subjectName ?? view.klass.name;
  const resolved = await Promise.all(
    view.concepts
      .filter((c) => c.inLearnerPlan)
      .map(async (c) => ({ conceptId: await resolve(view.student.id, c.canonicalConceptId), label: c.topic, subjectName }))
  );
  return resolved.filter((c): c is IndividualAssignmentConcept => Boolean(c.conceptId));
}
