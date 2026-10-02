/**
 * Track A -- Class Learning Plan (governed by the class's Teacher), the class
 * learner matrix and detected needs.
 *
 *  - Only the Teacher of the class (approved membership + active scope).
 *  - Only ACTIVE canonical concepts of the class's subject; nobody here
 *    creates canonical concepts (unknown concepts go to concept proposals).
 *  - A concept outside the institution curriculum is SUPPLEMENTAL and the
 *    institution's coordinators are told.
 *  - Removing a concept from the class plan only retires the CLASS_PLAN
 *    sources; learner concepts, learner state, evidence and history stay.
 *  - Class plan ≠ personal plan: adding to the class plan enrolls nobody.
 *    Learners see it as a recommendation; the Teacher assigns it (to all or
 *    some learners) into their personal plans with a CLASS_PLAN source
 *    (universal enrollment: one learner state per concept, progress never
 *    reset), or creates a task through the existing assignment flow.
 *  - Matrix and needs are read-only projections of the canonical decision and
 *    exam results, scoped to ACTIVE learners of the class and its subject.
 */
import { db } from '@/lib/db';
import { canTeacherAccessLearner } from '@/lib/authorization';
import { getCanonicalPedagogicalDecision } from '@/lib/pedagogical-decision/canonical-decision.service';
import type { PedagogicalStage } from '@/lib/pedagogical-engine/types';
import { notifyInstitutionAdmins } from '@/lib/notifications/role-notifications.service';
import { getTeacherClass, type TeacherClassContext } from '@/lib/teacher/class-assignment.service';
import { canonicalConceptLabels } from './labels';
import { curriculumForClass, recordCurriculumEvent, type CurriculumClassification } from './institution-curriculum.service';
import { deactivateClassSources, enrollCanonicalConcept } from './personal-plan.service';
import { deriveExamGaps } from './exam-bridge.service';

export class ClassPlanError extends Error {
  constructor(public readonly code: 'NOT_TEACHER' | 'CLASS_SUBJECT_REQUIRED' | 'CONCEPT_NOT_IN_CLASS_SUBJECT' | 'NOT_FOUND') {
    super(code);
    this.name = 'ClassPlanError';
  }
}

async function requireTeacherClass(actorUserId: string, classId: string): Promise<TeacherClassContext> {
  const klass = await getTeacherClass(actorUserId, classId);
  if (!klass) throw new ClassPlanError('NOT_TEACHER');
  if (!klass.subjectId) throw new ClassPlanError('CLASS_SUBJECT_REQUIRED');
  return klass;
}

async function activeLearners(classId: string): Promise<Array<{ id: string; name: string }>> {
  const r = await db.query(
    `SELECT s.id, COALESCE(s.name, s.email, '') AS name FROM class_enrollments ce JOIN students s ON s.id = ce.student_id
     WHERE ce.class_id = $1 AND ce.status = 'ACTIVE' ORDER BY s.name NULLS LAST, s.email`,
    [classId]
  );
  return r.rows;
}

export interface ClassPlanConceptView {
  canonicalConceptId: string;
  label: string;
  classification: CurriculumClassification | null;
  inClassPlan: boolean;
  priority: 'HIGH' | 'NORMAL' | 'LOW' | null;
  targetDate: string | null;
  period: string | null;
  requiredForClass: boolean;
  supplemental: boolean;
  orderIndex: number | null;
  /** ACTIVE learners who have it in their personal plan */
  studentsWithConcept: number;
  prerequisiteLabels: string[];
}

export interface ClassPlanView {
  klass: TeacherClassContext;
  hasInstitutionCurriculum: boolean;
  activeLearners: number;
  concepts: ClassPlanConceptView[];
}

/** Curriculum browser + class plan: every concept of the class subject with curriculum relevance and coverage. */
export async function getClassPlanView(actorUserId: string, classId: string, locale: string): Promise<ClassPlanView> {
  const klass = await requireTeacherClass(actorUserId, classId);
  const [concepts, plan, curriculum, learners] = await Promise.all([
    db.query(`SELECT id FROM canonical_concepts WHERE canonical_subject_id = $1 AND status = 'ACTIVE' ORDER BY name`, [klass.subjectId]),
    db.query(`SELECT * FROM class_plan_concepts WHERE class_id = $1`, [classId]),
    curriculumForClass(classId),
    activeLearners(classId),
  ]);
  const ids = concepts.rows.map((r: any) => r.id);
  const [coverage, prereqs] = await Promise.all([
    db.query(
      `SELECT canonical_concept_id, COUNT(DISTINCT student_id)::int AS n FROM student_plan_entries
       WHERE student_id = ANY($1::uuid[]) AND canonical_concept_id = ANY($2::uuid[]) AND plan_status = 'IN_PLAN' GROUP BY 1`,
      [learners.map((l) => l.id), ids]
    ),
    db.query(`SELECT concept_id, prerequisite_concept_id FROM canonical_concept_prerequisites WHERE concept_id = ANY($1::uuid[])`, [ids]),
  ]);
  const labels = await canonicalConceptLabels([...ids, ...prereqs.rows.map((r: any) => r.prerequisite_concept_id)], locale);
  const planBy = new Map<string, any>(plan.rows.map((r: any) => [r.canonical_concept_id, r]));
  const coverageBy = new Map<string, number>(coverage.rows.map((r: any) => [r.canonical_concept_id, r.n]));
  const view = ids.map((id: string) => {
    const p = planBy.get(id);
    const active = p?.status === 'ACTIVE';
    return {
      canonicalConceptId: id,
      label: labels.get(id) ?? '',
      classification: curriculum?.classifications.get(id) ?? null,
      inClassPlan: active,
      priority: active ? p.priority : null,
      targetDate: active && p.target_date ? String(p.target_date instanceof Date ? p.target_date.toISOString() : p.target_date).slice(0, 10) : null,
      period: active ? p.period : null,
      requiredForClass: active ? p.required_for_class : false,
      supplemental: active ? p.supplemental : false,
      orderIndex: active ? p.order_index : null,
      studentsWithConcept: coverageBy.get(id) ?? 0,
      prerequisiteLabels: prereqs.rows.filter((r: any) => r.concept_id === id).map((r: any) => labels.get(r.prerequisite_concept_id) ?? ''),
    };
  });
  const rank = (c: ClassPlanConceptView) => (c.inClassPlan ? 0 : c.classification === 'REQUIRED' ? 1 : c.classification ? 2 : 3);
  view.sort((a: ClassPlanConceptView, b: ClassPlanConceptView) => rank(a) - rank(b) || (a.orderIndex ?? 0) - (b.orderIndex ?? 0) || a.label.localeCompare(b.label));
  return { klass, hasInstitutionCurriculum: Boolean(curriculum), activeLearners: learners.length, concepts: view };
}

/** Add (or restore / update) a concept in the class plan. Supplemental when outside the institution curriculum (coordinators notified). */
export async function addToClassPlan(
  actorUserId: string,
  classId: string,
  canonicalConceptId: string,
  opts: { priority?: 'HIGH' | 'NORMAL' | 'LOW'; targetDate?: string | null; period?: string | null; requiredForClass?: boolean } = {}
): Promise<{ supplemental: boolean; created: boolean }> {
  const klass = await requireTeacherClass(actorUserId, classId);
  const ok = await db.query(`SELECT name FROM canonical_concepts WHERE id = $1 AND canonical_subject_id = $2 AND status = 'ACTIVE'`, [canonicalConceptId, klass.subjectId]);
  if (!ok.rows[0]) throw new ClassPlanError('CONCEPT_NOT_IN_CLASS_SUBJECT');
  const curriculum = await curriculumForClass(classId);
  const supplemental = Boolean(curriculum) && !curriculum!.classifications.has(canonicalConceptId);
  const r = await db.query(
    `INSERT INTO class_plan_concepts (class_id, canonical_concept_id, priority, target_date, period, required_for_class, supplemental, order_index, added_by_user_id)
     VALUES ($1, $2, COALESCE($3, 'NORMAL'), $4, $5, COALESCE($6, false), $7, (SELECT COALESCE(MAX(order_index), 0) + 1 FROM class_plan_concepts WHERE class_id = $1), $8)
     ON CONFLICT (class_id, canonical_concept_id) DO UPDATE SET
       priority = COALESCE($3, class_plan_concepts.priority), target_date = COALESCE($4, class_plan_concepts.target_date),
       period = COALESCE($5, class_plan_concepts.period), required_for_class = COALESCE($6, class_plan_concepts.required_for_class),
       supplemental = $7, status = 'ACTIVE', removed_at = NULL, removed_by_user_id = NULL, updated_at = now()
     RETURNING (xmax = 0) AS inserted, (SELECT status FROM class_plan_concepts WHERE class_id = $1 AND canonical_concept_id = $2) AS prior_status`,
    [classId, canonicalConceptId, opts.priority ?? null, opts.targetDate ?? null, opts.period ?? null, opts.requiredForClass ?? null, supplemental, actorUserId]
  );
  const created = Boolean(r.rows[0]?.inserted) || r.rows[0]?.prior_status === 'REMOVED';
  if (created) {
    await recordCurriculumEvent({ institutionId: klass.institutionId, classId, canonicalConceptId, eventType: supplemental ? 'SUPPLEMENTAL_ADDED' : 'CLASS_PLAN_ADDED', actorUserId });
    if (supplemental) {
      await notifyInstitutionAdmins(klass.institutionId, {
        type: 'CURRICULUM_SUPPLEMENTAL_CONCEPT',
        title: 'Concepto complementario en una clase',
        message: `Un docente añadió «${ok.rows[0].name}» como concepto complementario en ${klass.name}.`,
        payload: { className: klass.name, conceptName: ok.rows[0].name },
        actionHref: `/dashboard/institution/${klass.institutionId}/curriculum`,
      });
    }
  } else {
    await recordCurriculumEvent({ institutionId: klass.institutionId, classId, canonicalConceptId, eventType: 'CLASS_PLAN_UPDATED', actorUserId, detail: opts as Record<string, unknown> });
  }
  return { supplemental, created };
}

/** Remove from the class plan: retires CLASS_PLAN sources only; nothing a learner learned is touched. */
export async function removeFromClassPlan(actorUserId: string, classId: string, canonicalConceptId: string): Promise<{ sourcesRetired: number }> {
  const klass = await requireTeacherClass(actorUserId, classId);
  const r = await db.query(
    `UPDATE class_plan_concepts SET status = 'REMOVED', removed_at = now(), removed_by_user_id = $3, updated_at = now()
     WHERE class_id = $1 AND canonical_concept_id = $2 AND status = 'ACTIVE' RETURNING id`,
    [classId, canonicalConceptId, actorUserId]
  );
  if (r.rows.length === 0) throw new ClassPlanError('NOT_FOUND');
  const sourcesRetired = await deactivateClassSources({ classId, canonicalConceptId, sourceTypes: ['CLASS_PLAN'], reason: 'REMOVED_FROM_CLASS_PLAN', actorUserId });
  await recordCurriculumEvent({ institutionId: klass.institutionId, classId, canonicalConceptId, eventType: 'CLASS_PLAN_REMOVED', actorUserId, detail: { sourcesRetired } });
  return { sourcesRetired };
}

// ---------------------------------------------------------------------------
// Matrix and needs
// ---------------------------------------------------------------------------

export const MATRIX_BUCKETS = ['NOT_STARTED', 'LEARN', 'PRACTICE', 'PROVE', 'RETAIN', 'TRANSFER', 'CONSOLIDATED'] as const;
export type MatrixBucket = (typeof MATRIX_BUCKETS)[number];

export interface MatrixRow {
  canonicalConceptId: string;
  label: string;
  cells: Record<MatrixBucket, Array<{ studentId: string; name: string }>>;
}

/** Pure: the matrix column of one learner for one concept. */
export function matrixBucket(inPlan: boolean, stage: PedagogicalStage | null): MatrixBucket {
  if (!inPlan || !stage) return 'NOT_STARTED';
  return stage;
}

/** Concept × learning phase for the class plan concepts (plus concepts already assigned to the class). */
export async function getClassLearnerMatrix(actorUserId: string, classId: string, locale: string): Promise<{ klass: TeacherClassContext; rows: MatrixRow[]; learners: number }> {
  const klass = await requireTeacherClass(actorUserId, classId);
  const learners = await activeLearners(classId);
  const concepts = await db.query(
    `SELECT canonical_concept_id FROM class_plan_concepts WHERE class_id = $1 AND status = 'ACTIVE'
     UNION
     SELECT m.canonical_concept_id FROM teacher_interventions ti JOIN concept_catalog_mapping m ON m.learner_concept_id = ti.concept_id AND m.status = 'MATCHED'
     WHERE ti.class_id = $1 AND ti.status <> 'CANCELLED'`,
    [classId]
  );
  const conceptIds: string[] = concepts.rows.map((r: any) => r.canonical_concept_id);
  const entries = await db.query(
    `SELECT student_id, canonical_concept_id, learner_concept_id FROM student_plan_entries
     WHERE student_id = ANY($1::uuid[]) AND canonical_concept_id = ANY($2::uuid[]) AND plan_status = 'IN_PLAN'`,
    [learners.map((l) => l.id), conceptIds]
  );
  const entryBy = new Map<string, string>(entries.rows.map((e: any) => [`${e.student_id}:${e.canonical_concept_id}`, e.learner_concept_id]));
  const labels = await canonicalConceptLabels(conceptIds, locale);
  const rows: MatrixRow[] = [];
  for (const conceptId of conceptIds) {
    const cells = Object.fromEntries(MATRIX_BUCKETS.map((b) => [b, [] as Array<{ studentId: string; name: string }>])) as MatrixRow['cells'];
    await Promise.all(
      learners.map(async (l) => {
        const learnerConceptId = entryBy.get(`${l.id}:${conceptId}`);
        let stage: PedagogicalStage | null = null;
        if (learnerConceptId) stage = (await getCanonicalPedagogicalDecision({ studentId: l.id, conceptId: learnerConceptId }).then((r) => r.decision).catch(() => null))?.stage ?? 'LEARN';
        cells[matrixBucket(Boolean(learnerConceptId), stage)].push({ studentId: l.id, name: l.name });
      })
    );
    for (const b of MATRIX_BUCKETS) cells[b].sort((a, c) => a.name.localeCompare(c.name));
    rows.push({ canonicalConceptId: conceptId, label: labels.get(conceptId) ?? '', cells });
  }
  rows.sort((a, b) => a.label.localeCompare(b.label));
  return { klass, rows, learners: learners.length };
}

export interface ClassNeed {
  canonicalConceptId: string;
  label: string;
  students: Array<{ studentId: string; name: string }>;
}

/**
 * Detected needs: recent exam gaps of the class's ACTIVE learners on concepts
 * of the class subject (aggregated). Academic signal only -- never tutor
 * conversations, other exams' subjects or other classes.
 */
export async function getClassNeeds(actorUserId: string, classId: string, locale: string): Promise<ClassNeed[]> {
  const klass = await requireTeacherClass(actorUserId, classId);
  const learners = await activeLearners(classId);
  const allowed: typeof learners = [];
  for (const l of learners) if (await canTeacherAccessLearner(actorUserId, l.id)) allowed.push(l);
  const subjectConcepts = (await db.query(`SELECT id FROM canonical_concepts WHERE canonical_subject_id = $1 AND status = 'ACTIVE'`, [klass.subjectId])).rows.map((r: any) => r.id);
  const gaps = await deriveExamGaps(allowed.map((l) => l.id), subjectConcepts);
  const byConcept = new Map<string, Set<string>>();
  for (const g of gaps) byConcept.set(g.canonicalConceptId, (byConcept.get(g.canonicalConceptId) ?? new Set()).add(g.studentId));
  const labels = await canonicalConceptLabels([...byConcept.keys()], locale);
  return [...byConcept.entries()]
    .map(([id, students]) => ({
      canonicalConceptId: id,
      label: labels.get(id) ?? '',
      students: allowed.filter((l) => students.has(l.id)).map((l) => ({ studentId: l.id, name: l.name })),
    }))
    .sort((a, b) => b.students.length - a.students.length || a.label.localeCompare(b.label));
}

/** Assignment preview for a concept: who has it, who will add it, who is already advanced (PROVE or beyond). */
export async function previewAssignment(actorUserId: string, classId: string, canonicalConceptId: string, studentIds?: string[] | null): Promise<{ have: number; willAdd: number; advanced: number }> {
  await requireTeacherClass(actorUserId, classId);
  const learners = (await activeLearners(classId)).map((l) => l.id).filter((id) => !studentIds?.length || studentIds.includes(id));
  const entries = await db.query(
    `SELECT student_id, learner_concept_id FROM student_plan_entries WHERE student_id = ANY($1::uuid[]) AND canonical_concept_id = $2 AND plan_status = 'IN_PLAN'`,
    [learners, canonicalConceptId]
  );
  let advanced = 0;
  await Promise.all(
    entries.rows.map(async (e: any) => {
      const stage = (await getCanonicalPedagogicalDecision({ studentId: e.student_id, conceptId: e.learner_concept_id }).then((r) => r.decision).catch(() => null))?.stage;
      if (stage === 'PROVE' || stage === 'RETAIN' || stage === 'TRANSFER' || stage === 'CONSOLIDATED') advanced += 1;
    })
  );
  return { have: entries.rows.length, willAdd: learners.length - entries.rows.length, advanced };
}

/**
 * Assign a class-plan concept to all (or the selected) ACTIVE learners: each
 * gets it in their personal plan with a CLASS_PLAN source keyed by the class.
 * Concepts not yet in the class plan are added first. Learners the Teacher
 * cannot access are skipped; learners who already had it keep their state.
 */
export async function assignClassPlanConcept(
  actorUserId: string,
  classId: string,
  canonicalConceptId: string,
  studentIds?: string[] | null
): Promise<{ assigned: number; added: number; alreadyHad: number; skipped: number }> {
  const klass = await requireTeacherClass(actorUserId, classId);
  const inPlan = await db.query(`SELECT 1 FROM class_plan_concepts WHERE class_id = $1 AND canonical_concept_id = $2 AND status = 'ACTIVE'`, [classId, canonicalConceptId]);
  if (!inPlan.rows[0]) await addToClassPlan(actorUserId, classId, canonicalConceptId);
  const learners = (await activeLearners(classId)).filter((l) => !studentIds?.length || studentIds.includes(l.id));
  if (studentIds?.length && learners.length !== new Set(studentIds).size) throw new ClassPlanError('NOT_FOUND');
  let added = 0;
  let alreadyHad = 0;
  let skipped = 0;
  for (const l of learners) {
    if (!(await canTeacherAccessLearner(actorUserId, l.id))) {
      skipped += 1;
      continue;
    }
    const r = await enrollCanonicalConcept(l.id, canonicalConceptId, { type: 'CLASS_PLAN', key: classId, classId, institutionId: klass.institutionId, actorUserId });
    if (r.conceptCreated || r.entryCreated || r.restored) added += 1;
    else alreadyHad += 1;
  }
  await recordCurriculumEvent({ institutionId: klass.institutionId, classId, canonicalConceptId, eventType: 'CLASS_PLAN_UPDATED', actorUserId, detail: { action: 'ASSIGNED', added, alreadyHad, skipped, selected: Boolean(studentIds?.length) } });
  return { assigned: added + alreadyHad, added, alreadyHad, skipped };
}

export interface ClassStudentPlan {
  studentId: string;
  name: string;
  concepts: Array<{ canonicalConceptId: string; label: string; stage: PedagogicalStage | null; sources: string[] }>;
}

/**
 * Student-centric view: for each ACTIVE learner of the class, the concepts of
 * the class subject in their personal plan, with phase and source types
 * (types only -- never another class's or exam's identifiers). Read-only.
 */
export async function getClassStudentPlans(actorUserId: string, classId: string, locale: string): Promise<ClassStudentPlan[]> {
  const klass = await requireTeacherClass(actorUserId, classId);
  const learners = await activeLearners(classId);
  const entries = await db.query(
    `SELECT e.student_id, e.canonical_concept_id, e.learner_concept_id,
            COALESCE(array_agg(DISTINCT s.source_type) FILTER (WHERE s.active), '{}') AS sources
     FROM student_plan_entries e
     JOIN canonical_concepts cc ON cc.id = e.canonical_concept_id AND cc.canonical_subject_id = $2
     LEFT JOIN student_concept_sources s ON s.student_id = e.student_id AND s.canonical_concept_id = e.canonical_concept_id
     WHERE e.student_id = ANY($1::uuid[]) AND e.plan_status = 'IN_PLAN'
     GROUP BY e.student_id, e.canonical_concept_id, e.learner_concept_id`,
    [learners.map((l) => l.id), klass.subjectId]
  );
  const labels = await canonicalConceptLabels(entries.rows.map((e: any) => e.canonical_concept_id), locale);
  const stages = await Promise.all(
    entries.rows.map((e: any) => getCanonicalPedagogicalDecision({ studentId: e.student_id, conceptId: e.learner_concept_id }).then((r) => r.decision?.stage ?? null).catch(() => null))
  );
  return learners.map((l) => ({
    studentId: l.id,
    name: l.name,
    concepts: entries.rows
      .map((e: any, i: number) => ({ e, stage: stages[i] }))
      .filter(({ e }: any) => e.student_id === l.id)
      .map(({ e, stage }: any) => ({ canonicalConceptId: e.canonical_concept_id, label: labels.get(e.canonical_concept_id) ?? '', stage, sources: e.sources ?? [] }))
      .sort((a: any, b: any) => a.label.localeCompare(b.label)),
  }));
}
