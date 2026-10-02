/**
 * Track A -- Class Progress Intelligence: the query layer (read-only).
 *
 * Only for the Teacher of the class (approved membership + active scope,
 * `getTeacherClass`); every ACTIVE learner of a class the Teacher teaches is
 * within `canTeacherAccessLearner` by construction (same rule: an ACTIVE
 * enrollment in a class covered by the Teacher's assignment). Scope is the
 * class subject only -- concepts of the class plan and of the class's
 * assignments; never tutor transcripts, parent data, billing, other
 * subjects or learners outside the class.
 *
 * Performance: a FIXED number of queries whatever the class size -- the
 * canonical decisions for every (learner × concept) pair come from
 * `getCanonicalPedagogicalDecisionsBatch` (3 batched reads + the same pure
 * engine), memory from one batched read, exam gaps from the exam bridge's
 * batched derivation. `queryCount` is returned for regression checks.
 */
import { db } from '@/lib/db';
import { getCanonicalPedagogicalDecisionsBatch } from '@/lib/pedagogical-decision/canonical-decision.service';
import { getTwinMemorySignalsForPairs } from '@/services/memory-read.service';
import { getActiveMisconceptionCountsForPairs } from '@/services/misconception.service';
import { deriveExamGaps } from '@/lib/learning-plan/exam-bridge.service';
import { canonicalConceptLabels } from '@/lib/learning-plan/labels';
import { getTeacherClass, type TeacherClassContext } from './class-assignment.service';
import { computeClassProgress, type ProgressInputs, type ProgressConcept, type ClassProgressComputed } from './class-progress.compute';

export const PERIODS = ['7d', '30d', 'period', 'all'] as const;
export type ProgressPeriod = (typeof PERIODS)[number];

export interface ClassProgressFilters {
  period: ProgressPeriod;
  /** Class-plan period label for `period`; defaults to the label of the nearest upcoming target date. */
  periodLabel?: string | null;
  topic?: string | null;
  concept?: string | null;
  assignment?: string | null;
  students?: string[] | null;
}

export class ClassProgressError extends Error {
  constructor(public readonly code: 'NOT_TEACHER' | 'CLASS_SUBJECT_REQUIRED') {
    super(code);
    this.name = 'ClassProgressError';
  }
}

export interface ClassProgressView extends ClassProgressComputed {
  klass: TeacherClassContext;
  filters: ClassProgressFilters & { periodLabel: string | null; windowFrom: string | null };
  options: {
    topics: Array<{ key: string; label: string }>;
    concepts: Array<{ id: string; label: string; topicKey: string | null }>;
    assignments: Array<{ groupId: string; title: string }>;
    periods: string[];
    learners: Array<{ studentId: string; name: string }>;
  };
  concepts: ProgressConcept[];
  topicSource: 'CURRICULUM_BASE' | 'PUBLISHED_CURRICULUM' | 'NONE';
  queryCount: number;
}

const iso = (v: any): string | null => (v ? (v instanceof Date ? v.toISOString() : new Date(v).toISOString()) : null);
const day = (v: any): string | null => (v ? (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)) : null);

export async function getClassProgress(actorUserId: string, classId: string, filters: ClassProgressFilters, locale: string, nowDate: Date = new Date()): Promise<ClassProgressView> {
  let queries = 0;
  const q = async (sql: string, params: unknown[]) => {
    queries += 1;
    return db.query(sql, params);
  };
  const klass = await getTeacherClass(actorUserId, classId);
  if (!klass) throw new ClassProgressError('NOT_TEACHER');
  if (!klass.subjectId) throw new ClassProgressError('CLASS_SUBJECT_REQUIRED');
  const now = nowDate.toISOString();

  // Learners (ACTIVE in this class) -- the selection filter only narrows within them.
  const roster = (await q(
    `SELECT s.id, COALESCE(s.name, s.email, '') AS name FROM class_enrollments ce JOIN students s ON s.id = ce.student_id
     WHERE ce.class_id = $1 AND ce.status = 'ACTIVE' ORDER BY s.name NULLS LAST, s.email`,
    [classId]
  )).rows as Array<{ id: string; name: string }>;

  // Scope concepts: class plan + concepts of the class's assignments (class subject only).
  const [planRows, assignmentRows] = await Promise.all([
    q(`SELECT cpc.canonical_concept_id, cpc.target_date, cpc.period, cpc.added_at FROM class_plan_concepts cpc
       JOIN canonical_concepts cc ON cc.id = cpc.canonical_concept_id AND cc.canonical_subject_id = $2
       WHERE cpc.class_id = $1 AND cpc.status = 'ACTIVE'`, [classId, klass.subjectId]),
    q(`SELECT ti.assignment_group_id, ti.student_id, ti.assigned_at, ti.due_at, ti.title, ti.owner_scope, cc.id AS canonical_concept_id, cc.name AS concept_name,
              CASE WHEN ti.status = 'COMPLETED' OR tie.completed_at IS NOT NULL THEN 'COMPLETED' ELSE ti.status END AS status
       FROM teacher_interventions ti
       LEFT JOIN concept_catalog_mapping m ON m.learner_concept_id = ti.concept_id AND m.status = 'MATCHED'
       LEFT JOIN canonical_concepts cc ON cc.id = m.canonical_concept_id AND cc.canonical_subject_id = $2
       LEFT JOIN LATERAL (SELECT completed_at FROM teacher_intervention_executions WHERE teacher_intervention_id = ti.id AND completed_at IS NOT NULL LIMIT 1) tie ON true
       WHERE ti.class_id = $1 AND ti.status <> 'CANCELLED'`, [classId, klass.subjectId]),
  ]);
  const allConceptIds = [...new Set([...planRows.rows.map((r: any) => r.canonical_concept_id), ...assignmentRows.rows.filter((r: any) => r.canonical_concept_id).map((r: any) => r.canonical_concept_id)])];

  // Topics (no canonical topic level): the structure of the class's EXPLICITLY bound curriculum.
  // A bound class never borrows another curriculum's structure (SEP is never grouped by Cambridge);
  // only an unbound class falls back to the published version covering most of its concepts.
  const topicVersion = await q(
    `SELECT CASE WHEN (SELECT institution_curriculum_id FROM classes WHERE id = $1) IS NOT NULL THEN
       (SELECT ic.base_structure_version_id FROM institution_curricula ic JOIN classes c ON c.id = $1 WHERE ic.id = c.institution_curriculum_id)
     ELSE
       (SELECT sn.structure_version_id FROM objective_concept_mappings ocm
        JOIN learning_objectives lo ON lo.id = ocm.learning_objective_id JOIN structure_nodes sn ON sn.id = lo.structure_node_id
        JOIN structure_versions sv ON sv.id = sn.structure_version_id AND sv.status = 'PUBLISHED'
        WHERE ocm.status = 'PUBLISHED' AND ocm.canonical_concept_id = ANY($2::uuid[])
        GROUP BY sn.structure_version_id ORDER BY COUNT(DISTINCT ocm.canonical_concept_id) DESC, sn.structure_version_id LIMIT 1)
     END AS version_id,
     (SELECT 1 FROM institution_curricula ic JOIN classes c ON c.id = $1 WHERE ic.id = c.institution_curriculum_id AND ic.base_structure_version_id IS NOT NULL) AS from_base`,
    [classId, allConceptIds]
  );
  const versionId: string | null = topicVersion.rows[0]?.version_id ?? null;
  const topicSource: ClassProgressView['topicSource'] = !versionId ? 'NONE' : topicVersion.rows[0]?.from_base ? 'CURRICULUM_BASE' : 'PUBLISHED_CURRICULUM';
  const topicRows = versionId
    ? (await q(
        `SELECT DISTINCT ON (ocm.canonical_concept_id) ocm.canonical_concept_id, sn.id AS topic_key, COALESCE(snl.label, sn.source_label, sn.code, '') AS topic_label
         FROM objective_concept_mappings ocm
         JOIN learning_objectives lo ON lo.id = ocm.learning_objective_id JOIN structure_nodes sn ON sn.id = lo.structure_node_id AND sn.structure_version_id = $1
         LEFT JOIN LATERAL (SELECT label FROM structure_node_localizations l WHERE l.structure_node_id = sn.id AND l.language = $3 LIMIT 1) snl ON true
         WHERE ocm.status = 'PUBLISHED' AND ocm.canonical_concept_id = ANY($2::uuid[])
         ORDER BY ocm.canonical_concept_id, sn.order_index`,
        [versionId, allConceptIds, locale]
      )).rows
    : [];
  const topicBy = new Map<string, { key: string; label: string }>(topicRows.map((r: any) => [r.canonical_concept_id, { key: r.topic_key, label: r.topic_label }]));
  queries += 1; // labels
  const labels = await canonicalConceptLabels(allConceptIds, locale);
  const planBy = new Map<string, any>(planRows.rows.map((r: any) => [r.canonical_concept_id, r]));

  const allConcepts: ProgressConcept[] = allConceptIds
    .map((id) => ({
      id,
      label: labels.get(id) ?? '',
      topicKey: topicBy.get(id)?.key ?? null,
      topicLabel: topicBy.get(id)?.label ?? null,
      inClassPlan: planBy.has(id),
      targetDate: day(planBy.get(id)?.target_date),
      period: planBy.get(id)?.period ?? null,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // Period window.
  const periods = [...new Set(planRows.rows.map((r: any) => r.period).filter(Boolean))].sort() as string[];
  let periodLabel: string | null = null;
  let windowFrom: string | null = null;
  if (filters.period === '7d') windowFrom = new Date(nowDate.getTime() - 7 * 86_400_000).toISOString();
  else if (filters.period === '30d') windowFrom = new Date(nowDate.getTime() - 30 * 86_400_000).toISOString();
  else if (filters.period === 'period') {
    const upcoming = planRows.rows.filter((r: any) => r.period && r.target_date && day(r.target_date)! >= now.slice(0, 10)).sort((a: any, b: any) => day(a.target_date)!.localeCompare(day(b.target_date)!));
    periodLabel = filters.periodLabel && periods.includes(filters.periodLabel) ? filters.periodLabel : upcoming[0]?.period ?? periods[0] ?? null;
    const added = planRows.rows.filter((r: any) => r.period === periodLabel).map((r: any) => iso(r.added_at)!).sort();
    windowFrom = added[0] ?? null;
  }

  // Scope filters.
  const groupRows = assignmentRows.rows.filter((r: any) => r.assignment_group_id === filters.assignment);
  let concepts = allConcepts;
  if (filters.period === 'period' && periodLabel) concepts = concepts.filter((c) => c.period === periodLabel);
  if (filters.topic) concepts = concepts.filter((c) => c.topicKey === filters.topic);
  if (filters.concept) concepts = concepts.filter((c) => c.id === filters.concept);
  if (filters.assignment) concepts = concepts.filter((c) => groupRows.some((r: any) => r.canonical_concept_id === c.id));
  let learners = roster;
  if (filters.students?.length) learners = learners.filter((l) => filters.students!.includes(l.id));
  if (filters.assignment) learners = learners.filter((l) => groupRows.some((r: any) => r.student_id === l.id));

  const learnerIds = learners.map((l) => l.id);
  const conceptIds = concepts.map((c) => c.id);
  const entries = (await q(
    `SELECT student_id, canonical_concept_id, learner_concept_id FROM student_plan_entries
     WHERE student_id = ANY($1::uuid[]) AND canonical_concept_id = ANY($2::uuid[]) AND plan_status = 'IN_PLAN'`,
    [learnerIds, conceptIds]
  )).rows as Array<{ student_id: string; canonical_concept_id: string; learner_concept_id: string }>;
  const pairKeys = entries.map((e) => ({ studentId: e.student_id, conceptId: e.learner_concept_id }));

  queries += 5; // 3 batched decision inputs + memory + misconceptions
  const [decisions, memory, misconceptions] = await Promise.all([
    getCanonicalPedagogicalDecisionsBatch({ pairs: pairKeys, now }),
    getTwinMemorySignalsForPairs(db, pairKeys, nowDate),
    getActiveMisconceptionCountsForPairs(pairKeys),
  ]);

  queries += 3; // exam gap derivation (own + Track B results + mappings)
  const gaps = await deriveExamGaps(learnerIds, conceptIds);
  const attemptIds = [...new Set(gaps.map((g) => g.examAttemptId))];
  const objectiveIds = [...new Set(gaps.map((g) => g.learningObjectiveId))];
  const [examMeta, examDates] = await Promise.all([
    q(`SELECT ea.id AS attempt_id, ed.name AS exam_name
       FROM exam_attempts ea JOIN student_exam_profiles sep ON sep.id = ea.student_exam_profile_id JOIN exam_definitions ed ON ed.id = sep.exam_definition_id
       WHERE ea.id = ANY($1::uuid[])`, [attemptIds]),
    // Exam dates only for exams whose blueprint covers this class subject.
    q(`SELECT sep.student_id, ed.name AS exam_name, sep.exam_date FROM student_exam_profiles sep JOIN exam_definitions ed ON ed.id = sep.exam_definition_id
       WHERE sep.student_id = ANY($1::uuid[]) AND sep.exam_date IS NOT NULL AND EXISTS (
         SELECT 1 FROM exam_versions ev JOIN assessment_blueprints b ON b.exam_version_id = ev.id JOIN blueprint_objective_targets bot ON bot.blueprint_id = b.id
         JOIN objective_concept_mappings ocm ON ocm.learning_objective_id = bot.learning_objective_id AND ocm.status = 'PUBLISHED'
         JOIN canonical_concepts cc ON cc.id = ocm.canonical_concept_id AND cc.canonical_subject_id = $2
         WHERE ev.exam_definition_id = ed.id)`, [learnerIds, klass.subjectId]),
  ]);
  const loCodes = objectiveIds.length
    ? new Map<string, string>((await q(`SELECT id, code FROM learning_objectives WHERE id = ANY($1::uuid[])`, [objectiveIds])).rows.map((r: any) => [r.id, r.code]))
    : new Map<string, string>();
  const examName = new Map<string, string>(examMeta.rows.map((r: any) => [r.attempt_id, r.exam_name]));

  const input: ProgressInputs = {
    now,
    windowFrom,
    learners: learners.map((l) => ({ id: l.id, name: l.name })),
    concepts,
    pairs: entries.map((e) => {
      const k = `${e.student_id}:${e.learner_concept_id}`;
      const d = decisions.get(k);
      const m = memory.get(k);
      const mc = misconceptions.get(k);
      return {
        studentId: e.student_id,
        conceptId: e.canonical_concept_id,
        learnerConceptId: e.learner_concept_id,
        decision: d?.decision ?? null,
        evidence: (d?.evidenceRows ?? []).map((r) => ({ id: r.id, timestamp: r.timestamp })),
        memory: m ? { retentionDue: m.retentionDue, nextReviewAt: m.nextReviewAt } : null,
        misconception: mc ? { activeCount: mc.activeCount, lastSeenAt: mc.lastSeenAt } : null,
      };
    }),
    examGaps: gaps.map((g) => ({ studentId: g.studentId, conceptId: g.canonicalConceptId, examName: examName.get(g.examAttemptId) ?? '', objectiveCode: loCodes.get(g.learningObjectiveId) ?? null, fraction: g.fraction, at: iso(g.at)! })),
    assignments: assignmentRows.rows
      .filter((r: any) => !filters.assignment || r.assignment_group_id === filters.assignment)
      .filter((r: any) => !r.canonical_concept_id || conceptIds.includes(r.canonical_concept_id))
      .map((r: any) => ({ groupId: r.assignment_group_id, title: r.title || r.concept_name || '', conceptId: r.canonical_concept_id, studentId: r.student_id, status: r.status, assignedAt: iso(r.assigned_at)!, dueAt: iso(r.due_at), institutional: r.owner_scope === 'INSTITUTION' })),
    examDates: examDates.rows.map((r: any) => ({ studentId: r.student_id, examName: r.exam_name, examDate: day(r.exam_date)! })),
  };

  const assignmentOptions = new Map<string, string>();
  for (const r of assignmentRows.rows) if (!assignmentOptions.has(r.assignment_group_id)) assignmentOptions.set(r.assignment_group_id, r.title || r.concept_name || '');
  const topics = new Map<string, string>();
  for (const c of allConcepts) if (c.topicKey && !topics.has(c.topicKey)) topics.set(c.topicKey, c.topicLabel ?? '');

  return {
    ...computeClassProgress(input),
    klass,
    filters: { ...filters, periodLabel, windowFrom },
    options: {
      topics: [...topics.entries()].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label)),
      concepts: allConcepts.map((c) => ({ id: c.id, label: c.label, topicKey: c.topicKey })),
      assignments: [...assignmentOptions.entries()].map(([groupId, title]) => ({ groupId, title })),
      periods,
      learners: roster.map((l) => ({ studentId: l.id, name: l.name })),
    },
    concepts,
    topicSource,
    queryCount: queries + 2, // + getTeacherClass (membership + class)
  };
}

export function parseProgressFilters(sp: Record<string, string | string[] | undefined>): ClassProgressFilters {
  const one = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v) || null;
  };
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const period = (PERIODS as readonly string[]).includes(one('period') ?? '') ? (one('period') as ProgressPeriod) : '30d';
  const students = (Array.isArray(sp.students) ? sp.students.join(',') : sp.students ?? '').split(',').filter((s) => uuid.test(s));
  const uuidOrNull = (v: string | null) => (v && uuid.test(v) ? v : null);
  const label = one('periodLabel');
  return {
    period,
    periodLabel: label && label.length <= 60 ? label : null,
    topic: uuidOrNull(one('topic')),
    concept: uuidOrNull(one('concept')),
    assignment: uuidOrNull(one('assignment')),
    students: students.length ? students : null,
  };
}
