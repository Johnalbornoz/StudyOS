/**
 * Track A -- a Teacher assignment puts a catalog concept into a learner's
 * plan when the learner does not have it yet.
 *
 * Thin adapter over the universal Personal Plan enrollment
 * (`enrollCanonicalConcept`, see src/lib/learning-plan/personal-plan.service.ts):
 * one learner concept per (student, canonical concept), reused untouched when
 * it exists, created as a zero "not started" concept otherwise, with the
 * TEACHER_ASSIGNMENT source recorded for the class. No evidence, mastery
 * progress, knowledge state, phase recognition, retention or transfer is ever
 * written here.
 *
 * Callers MUST already have authorized the Teacher for the class, the
 * learner as ACTIVE in it, and the canonical concept as belonging to the
 * class's subject.
 */
import { db } from '@/lib/db';
import { enrollCanonicalConcept, canonicalConceptKey } from '@/lib/learning-plan/personal-plan.service';

export { canonicalConceptKey };
export const TEACHER_ASSIGNMENT_ORIGIN = 'TEACHER_ASSIGNMENT';

export interface PlanConcept {
  conceptId: string;
  /** true when this call put the concept into the learner's plan (it was not there, or was archived). */
  added: boolean;
}

export async function ensureConceptInLearnerPlan(params: { studentId: string; canonicalConceptId: string; classId: string; actorUserId?: string | null }): Promise<PlanConcept> {
  const r = await enrollCanonicalConcept(params.studentId, params.canonicalConceptId, {
    type: 'TEACHER_ASSIGNMENT',
    key: params.classId,
    classId: params.classId,
    actorUserId: params.actorUserId ?? null,
  });
  return { conceptId: r.learnerConceptId, added: r.conceptCreated || r.entryCreated || r.restored };
}

/** Which of these ACTIVE learners already have the canonical concept in their plan (for the Teacher's preview). */
export async function learnersHavingCanonicalConcept(studentIds: string[], canonicalConceptId: string): Promise<Set<string>> {
  if (studentIds.length === 0) return new Set();
  const r = await db.query(
    `SELECT DISTINCT s.student_id FROM subjects s
     JOIN concepts c ON c.subject_id = s.id
     JOIN concept_catalog_mapping m ON m.learner_concept_id = c.id AND m.status = 'MATCHED'
     WHERE s.student_id = ANY($1::uuid[]) AND m.canonical_concept_id = $2`,
    [studentIds, canonicalConceptId]
  );
  return new Set(r.rows.map((row: any) => row.student_id));
}
