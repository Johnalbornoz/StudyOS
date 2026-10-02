/**
 * Track A -- attention by Subject → Concept → affected classes / students
 * for one institution curriculum subject, from REAL signals only (same
 * definition as the teacher's class progress): EXAM_GAP (latest exam result
 * per objective < 0.5), REINFORCE (canonical decision intervention), ACTIVE
 * misconceptions. Batched (fixed number of queries), aggregated counts only.
 */
import { db } from '@/lib/db';
import { getCanonicalPedagogicalDecisionsBatch } from '@/lib/pedagogical-decision/canonical-decision.service';
import { getActiveMisconceptionCountsForPairs } from '@/services/misconception.service';
import { deriveExamGaps } from '@/lib/learning-plan/exam-bridge.service';
import { canonicalConceptLabels } from '@/lib/learning-plan/labels';

export async function getCurriculumAttention(institutionId: string, curriculumId: string, locale: string) {
  const cur = (await db.query(`SELECT canonical_subject_id FROM institution_curricula WHERE id = $1 AND institution_id = $2`, [curriculumId, institutionId])).rows[0];
  if (!cur) return [];
  const enrollments = (await db.query(
    `SELECT ce.student_id, ce.class_id FROM class_enrollments ce JOIN classes c ON c.id = ce.class_id
     WHERE c.institution_curriculum_id = $1 AND c.institution_id = $2 AND ce.status = 'ACTIVE'`,
    [curriculumId, institutionId]
  )).rows as Array<{ student_id: string; class_id: string }>;
  if (enrollments.length === 0) return [];
  const learners = [...new Set(enrollments.map((e) => e.student_id))];
  const subjectConcepts = (await db.query(`SELECT id FROM canonical_concepts WHERE canonical_subject_id = $1 AND status = 'ACTIVE'`, [cur.canonical_subject_id])).rows.map((r: any) => r.id as string);
  const entries = (await db.query(
    `SELECT student_id, canonical_concept_id, learner_concept_id FROM student_plan_entries WHERE student_id = ANY($1::uuid[]) AND canonical_concept_id = ANY($2::uuid[]) AND plan_status = 'IN_PLAN'`,
    [learners, subjectConcepts]
  )).rows as Array<{ student_id: string; canonical_concept_id: string; learner_concept_id: string }>;
  const pairs = entries.map((e) => ({ studentId: e.student_id, conceptId: e.learner_concept_id }));
  const [decisions, misconceptions, gaps] = await Promise.all([getCanonicalPedagogicalDecisionsBatch({ pairs }), getActiveMisconceptionCountsForPairs(pairs), deriveExamGaps(learners, subjectConcepts)]);
  const affected = new Map<string, Set<string>>();
  const add = (conceptId: string, studentId: string) => affected.set(conceptId, (affected.get(conceptId) ?? new Set()).add(studentId));
  for (const e of entries) {
    const k = `${e.student_id}:${e.learner_concept_id}`;
    if (decisions.get(k)?.decision.intervention === 'REINFORCE' || (misconceptions.get(k)?.activeCount ?? 0) > 0) add(e.canonical_concept_id, e.student_id);
  }
  for (const g of gaps) add(g.canonicalConceptId, g.studentId);
  const classesOf = new Map<string, Set<string>>();
  for (const e of enrollments) classesOf.set(e.student_id, (classesOf.get(e.student_id) ?? new Set()).add(e.class_id));
  const labels = await canonicalConceptLabels([...affected.keys()], locale);
  return [...affected.entries()]
    .map(([conceptId, students]) => ({
      conceptId,
      label: labels.get(conceptId) ?? '',
      students: students.size,
      classes: new Set([...students].flatMap((s) => [...(classesOf.get(s) ?? [])])).size,
    }))
    .sort((a, b) => b.students - a.students || a.label.localeCompare(b.label));
}
