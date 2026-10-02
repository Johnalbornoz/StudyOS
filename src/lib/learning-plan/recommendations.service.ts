/**
 * Track A -- "Recomendado para mí": what the learner could add next, and why.
 * Read-only, computed from the governed sources (no second learning engine,
 * no score thresholds of its own):
 *
 *  - EXAM_GAP           open exam-gap recommendations (exam-bridge.service)
 *  - CLASS_PLAN         concepts of the class plans of the learner's ACTIVE classes
 *  - INSTITUTION_REQUIRED  REQUIRED concepts of the institution curriculum of those classes
 *  - PREREQUISITE       "before X, reinforce Y" from the canonical prerequisite graph
 *  - NEXT_CONCEPT       the next concepts of the learner's curriculum sequence,
 *                       once the concepts before them are demonstrated
 *
 * One item per canonical concept (reasons merged). Accepting goes through the
 * Personal Plan enrollment (one learner state per concept).
 */
import { db } from '@/lib/db';
import type { PedagogicalStage } from '@/lib/pedagogical-engine/types';
import { canonicalConceptLabels } from './labels';
import { getPersonalPlan } from './personal-plan.service';
import { listOpenExamRecommendations } from './exam-bridge.service';
import { resolveCurriculumContext, getBaseCurriculum, studentCatalogSubjects, catalogKeyOf } from './curriculum.service';
import { curriculumForClass } from './institution-curriculum.service';

export type RecommendationReasonType = 'EXAM_GAP' | 'CLASS_PLAN' | 'INSTITUTION_REQUIRED' | 'PREREQUISITE' | 'NEXT_CONCEPT';

export interface RecommendationReason {
  type: RecommendationReasonType;
  /** human context: class / institution name, the concept it unlocks or follows */
  detail: string | null;
  classId?: string;
  curriculumId?: string;
  examRecommendationId?: string;
  targetDate?: string | null;
}

export interface StudentRecommendation {
  canonicalConceptId: string;
  label: string;
  reasons: RecommendationReason[];
  /** already in the learner's plan (only exam gaps can be listed while in plan: "ya estás trabajando este concepto") */
  inPlan: boolean;
  learnerConceptId: string | null;
}

const PRIORITY: RecommendationReasonType[] = ['EXAM_GAP', 'CLASS_PLAN', 'INSTITUTION_REQUIRED', 'PREREQUISITE', 'NEXT_CONCEPT'];
const DEMONSTRATED: Array<PedagogicalStage | null> = ['PROVE', 'RETAIN', 'TRANSFER', 'CONSOLIDATED'];

export async function getStudentRecommendations(studentId: string, locale: string): Promise<StudentRecommendation[]> {
  const plan = await getPersonalPlan(studentId, locale);
  const inPlan = new Map(plan.entries.filter((e) => e.planStatus === 'IN_PLAN').map((e) => [e.canonicalConceptId, e]));
  const items = new Map<string, StudentRecommendation>();
  const add = (canonicalConceptId: string, reason: RecommendationReason, allowInPlan = false) => {
    const entry = inPlan.get(canonicalConceptId);
    if (entry && !allowInPlan) return;
    const item = items.get(canonicalConceptId) ?? { canonicalConceptId, label: '', reasons: [], inPlan: Boolean(entry), learnerConceptId: entry?.learnerConceptId ?? null };
    if (!item.reasons.some((r) => r.type === reason.type && r.detail === reason.detail)) item.reasons.push(reason);
    items.set(canonicalConceptId, item);
  };

  // Exam gaps (kept even when already in plan, so the learner sees "ya estás trabajando este concepto").
  for (const rec of await listOpenExamRecommendations(studentId, locale)) {
    add(rec.canonicalConceptId, { type: 'EXAM_GAP', detail: null, examRecommendationId: rec.id }, true);
  }

  // Class plans and institution curricula of the learner's ACTIVE classes.
  const classes = await db.query(
    `SELECT c.id, c.name, i.name AS institution_name FROM class_enrollments ce JOIN classes c ON c.id = ce.class_id JOIN institutions i ON i.id = c.institution_id
     WHERE ce.student_id = $1 AND ce.status = 'ACTIVE' AND i.status = 'ACTIVE'`,
    [studentId]
  );
  for (const k of classes.rows) {
    const classPlan = await db.query(`SELECT canonical_concept_id, target_date FROM class_plan_concepts WHERE class_id = $1 AND status = 'ACTIVE' ORDER BY order_index, added_at`, [k.id]);
    for (const row of classPlan.rows) {
      add(row.canonical_concept_id, { type: 'CLASS_PLAN', detail: k.name, classId: k.id, targetDate: row.target_date ? String(row.target_date).slice(0, 10) : null });
    }
    const curriculum = await curriculumForClass(k.id);
    for (const [conceptId, classification] of curriculum?.classifications ?? []) {
      if (classification === 'REQUIRED') add(conceptId, { type: 'INSTITUTION_REQUIRED', detail: k.institution_name, curriculumId: curriculum!.curriculumId, classId: k.id });
    }
  }

  // Prerequisites of what the learner is working on (not yet demonstrated).
  const working = plan.entries.filter((e) => e.planStatus === 'IN_PLAN' && !DEMONSTRATED.includes(e.stage));
  if (working.length > 0) {
    const prereqs = await db.query(
      `SELECT concept_id, prerequisite_concept_id FROM canonical_concept_prerequisites WHERE concept_id = ANY($1::uuid[])`,
      [working.map((e) => e.canonicalConceptId)]
    );
    for (const row of prereqs.rows) {
      const target = working.find((e) => e.canonicalConceptId === row.concept_id);
      const prereqEntry = inPlan.get(row.prerequisite_concept_id);
      if (prereqEntry && DEMONSTRATED.includes(prereqEntry.stage)) continue;
      add(row.prerequisite_concept_id, { type: 'PREREQUISITE', detail: target?.label ?? null });
    }
  }

  // Next concepts of each subject's curriculum sequence.
  const catalogKeys = new Set<string>();
  for (const s of await studentCatalogSubjects(studentId)) if (s.catalogKey) catalogKeys.add(s.catalogKey);
  for (const e of plan.entries) {
    const key = catalogKeyOf(e.subjectName);
    if (key) catalogKeys.add(key);
  }
  for (const key of catalogKeys) {
    const { context } = await resolveCurriculumContext(studentId, key);
    const curriculum = await getBaseCurriculum(key, context, locale);
    let suggested = 0;
    let previous: string | null = null;
    for (const concept of curriculum.concepts) {
      const entry = inPlan.get(concept.canonicalConceptId);
      if (entry) {
        previous = concept.label;
        continue;
      }
      const prereqsMet = concept.prerequisiteIds.every((id) => DEMONSTRATED.includes(inPlan.get(id)?.stage ?? null));
      if (!prereqsMet) continue;
      add(concept.canonicalConceptId, { type: 'NEXT_CONCEPT', detail: previous });
      if (++suggested >= 3) break;
    }
  }

  const labels = await canonicalConceptLabels([...items.keys()], locale);
  return [...items.values()]
    .map((item) => ({ ...item, label: labels.get(item.canonicalConceptId) ?? '', reasons: item.reasons.sort((a, b) => PRIORITY.indexOf(a.type) - PRIORITY.indexOf(b.type)) }))
    .sort((a, b) => PRIORITY.indexOf(a.reasons[0].type) - PRIORITY.indexOf(b.reasons[0].type) || a.label.localeCompare(b.label));
}
