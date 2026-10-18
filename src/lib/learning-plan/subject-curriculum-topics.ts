/**
 * T1 final delta (E) -- "Temas de tu currículo" inside a Learn subject (read-only).
 *
 * When the Student's subject is linked to a KNOWN curriculum (an exam they prepare, or the programme /
 * subject of their personal Academic Profile -- curriculum.service.ts `resolveCurriculumContext`), Learn
 * shows that curriculum's own structure, exactly as it is governed in the catalogue:
 *
 *   academic_subjects -> structure_versions (PUBLISHED) -> structure_nodes -> learning_objectives
 *     -> objective_concept_mappings (PUBLISHED) -> canonical_concepts
 *
 * NOTHING is invented. The topic unit is whatever the catalogue holds:
 *   - structure nodes that are syllabus units (any node type other than an assessment component)
 *     are the topics, with the concepts of their learning objectives;
 *   - when the only nodes are assessment components (EXAM_SECTION: "Paper 1A", "Paper 2"), a paper is
 *     not a topic: the curriculum's LEARNING OBJECTIVES are the topics ("A Space, time and motion: ..."),
 *     and an objective whose concepts are all already listed under an earlier one is not repeated.
 * A curriculum with no published objective -> concept mapping yields `topics: []` and the page says so.
 * A curriculum the Student explicitly has but whose mapping chain is not in the catalogue is
 * CURRICULUM_MAPPING_NOT_READY (fail closed): no other curriculum is shown in its place.
 *
 * Topic titles: the objective's reviewed label in the interface locale where the catalogue has one
 * (objective-localization.ts, keyed by the objective's stable code), else the stored description.
 *
 * Presentation only: no enrolment, no activation, no plan change happens here (subject autonomy is
 * untouched). Topic-level assessment / practice generation is out of scope (Blueprint Engine).
 */
import { db } from '@/lib/db';
import { canonicalConceptLabels, catalogSuppliesLabel, resolveLearnerConceptLabel } from './labels';
import { learningObjectiveLabel } from '@/lib/exam-core/catalog/objective-localization';
import { localizeComponentLabel } from '@/lib/exam-core/catalog/subject-localization';
import { catalogKeyOf, resolveCurriculumContext, type ContextReason, type CurriculumOption } from './curriculum.service';
import { CURRICULUM_MAPPING_NOT_READY, type CurriculumNotReady, type ExplicitSubjectSource } from './curriculum-context-resolution';
import { ASSESSMENT_NODE_TYPES } from './curriculum-grouping';


export interface CurriculumTopicRow {
  nodeId: string;
  nodeType: string;
  nodeLabel: string;
  nodeOrder: number;
  objectiveId: string;
  objectiveCode: string | null;
  objectiveDescription: string;
  canonicalConceptId: string | null;
}

export interface CurriculumTopicConcept {
  canonicalConceptId: string;
  label: string;
  /** The Student's own concept for it (this subject first, else any of their subjects), when they already study it. */
  learnerConceptId: string | null;
  /** The subject that holds that concept (for the link). */
  learnerSubjectId: string | null;
  /** Micro-delta M02: already in the Student's learning / plan -> the row shows "Added", never the same CTA again. */
  added: boolean;
  /** Curriculum provenance of this row: the node and the objective that hold the concept in this topic. */
  structureNodeId: string;
  learningObjectiveId: string;
}

/** Where the Student already has a catalogue concept. */
export interface LearnerConceptRef { conceptId: string; subjectId: string }

export interface CurriculumTopic {
  key: string;
  title: string;
  /** Where the topic sits in the catalogue when the topic is an objective (e.g. "Paper 1A"); null otherwise. */
  component: string | null;
  concepts: CurriculumTopicConcept[];
}

export interface SubjectCurriculumTopics {
  status: 'READY';
  context: CurriculumOption;
  reason: ContextReason;
  topics: CurriculumTopic[];
}

/**
 * The Student explicitly has a curriculum for this subject (an exam they prepare, a subject of their Academic
 * Profile) and the catalogue does not hold its mapping chain yet. Learn says so; it never shows another
 * curriculum's topics in its place.
 */
export interface SubjectCurriculumNotReady {
  status: typeof CURRICULUM_MAPPING_NOT_READY;
  notReady: CurriculumNotReady[];
  /** Official names of the curriculum that is not ready (the first one named), for the notice. */
  curriculum: { programme: string; name: string; level: string | null } | null;
}

const clean = (s: string) => s.trim().replace(/\.$/, '');

/** Pure: catalogue rows -> topics (see the module comment for the two shapes). */
export function buildCurriculumTopics(
  rows: CurriculumTopicRow[],
  labels: Map<string, string>,
  learnerByCanonical: Map<string, LearnerConceptRef>,
  locale = 'en',
  inPlan: ReadonlySet<string> = new Set()
): CurriculumTopic[] {
  const concept = (id: string, r: CurriculumTopicRow): CurriculumTopicConcept => {
    const ref = learnerByCanonical.get(id) ?? null;
    return { canonicalConceptId: id, label: labels.get(id) ?? '', learnerConceptId: ref?.conceptId ?? null, learnerSubjectId: ref?.subjectId ?? null, added: !!ref || inPlan.has(id), structureNodeId: r.nodeId, learningObjectiveId: r.objectiveId };
  };
  const mapped = rows.filter((r) => r.canonicalConceptId && labels.has(r.canonicalConceptId));
  const byNodeTopics = mapped.some((r) => !ASSESSMENT_NODE_TYPES.has(r.nodeType));
  const topics = new Map<string, CurriculumTopic>();
  const add = (key: string, title: string, component: string | null, r: CurriculumTopicRow) => {
    const id = r.canonicalConceptId!;
    if (!topics.has(key)) topics.set(key, { key, title, component, concepts: [] });
    const t = topics.get(key)!;
    if (!t.concepts.some((c) => c.canonicalConceptId === id)) t.concepts.push(concept(id, r));
  };
  if (byNodeTopics) {
    for (const r of mapped) if (!ASSESSMENT_NODE_TYPES.has(r.nodeType)) add(`node:${r.nodeId}`, clean(r.nodeLabel), null, r);
    return [...topics.values()];
  }
  for (const r of mapped) add(`lo:${r.objectiveId}`, learningObjectiveLabel(r.objectiveCode, locale) ?? clean(r.objectiveDescription), clean(r.nodeLabel) || null, r);
  // An objective that only re-assesses concepts already listed (another paper on the same content) is not a new topic.
  const seen = new Set<string>();
  const out: CurriculumTopic[] = [];
  for (const t of topics.values()) {
    if (t.concepts.every((c) => seen.has(c.canonicalConceptId))) continue;
    for (const c of t.concepts) seen.add(c.canonicalConceptId);
    out.push(t);
  }
  return out;
}

/**
 * C14-P1-03: the Exam Prep section is shown only when it adds something -- a preparation whose curriculum IS the
 * Learning curriculum (same published structure version) is already on the page.
 */
export function distinctExamCurriculum<T extends SubjectCurriculumTopics | SubjectCurriculumNotReady | null>(learning: SubjectCurriculumTopics | SubjectCurriculumNotReady | null, exam: T): T | null {
  if (!exam) return null;
  if (exam.status === 'READY' && learning?.status === 'READY' && learning.context.structureVersionId === exam.context.structureVersionId) return null;
  if (exam.status !== 'READY' && learning?.status !== 'READY' && learning) return null; // the Learning notice already says the curriculum is not loaded
  return exam;
}

/** "IB Diploma Programme · Physics · HL" parts, for the section title (official names; the caller localizes the subject). */
export function curriculumContextParts(context: Pick<CurriculumOption, 'programme' | 'name' | 'level'>): { programme: string; subject: string; level: string | null } {
  return { programme: context.programme, subject: context.name, level: context.level };
}

/**
 * C14-P1-03 -- which explicit curriculum a Learn section shows:
 *   LEARNING   the Student's own Learning curriculum (their Academic Profile subjects) -- "Temas de tu currículo";
 *   EXAM_PREP  the curriculum an ACTIVE exam preparation assesses -- an ADDITIONAL Exam Prep section that never
 *              takes the Learning curriculum's place, title or position, and never re-buckets Learning concepts;
 *   ANY        every explicit source in authority order (the original single resolution; kept for other callers).
 */
export type CurriculumScope = 'LEARNING' | 'EXAM_PREP' | 'ANY';
export const CURRICULUM_SCOPE_SOURCES: Record<CurriculumScope, readonly ExplicitSubjectSource[] | undefined> = {
  LEARNING: ['ACADEMIC_PROFILE'],
  EXAM_PREP: ['EXAM_PROFILE'],
  ANY: undefined,
};

/**
 * The curriculum topics of one of the Student's subjects, or null when the subject is not linked to a
 * known curriculum (then Learn shows no curriculum section at all).
 */
export async function loadSubjectCurriculumTopics(studentId: string, subject: { id: string; name: string }, locale: string, scope: CurriculumScope = 'ANY'): Promise<SubjectCurriculumTopics | SubjectCurriculumNotReady | null> {
  const catalogKey = catalogKeyOf(subject.name);
  if (!catalogKey) return null;
  const { context, reason, notReady } = await (scope === 'ANY'
    ? resolveCurriculumContext(studentId, catalogKey)
    : resolveCurriculumContext(studentId, catalogKey, null, CURRICULUM_SCOPE_SOURCES[scope]));
  if (!context && reason === CURRICULUM_MAPPING_NOT_READY) {
    const named = await db
      .query(`SELECT asub.name, asub.level, ap.name AS programme FROM academic_subjects asub JOIN academic_programmes ap ON ap.id = asub.programme_id WHERE asub.id = $1`, [notReady[0]?.academicSubjectId ?? null])
      .catch(() => ({ rows: [] as any[] }));
    return { status: CURRICULUM_MAPPING_NOT_READY, notReady, curriculum: named.rows[0] ? { programme: named.rows[0].programme, name: named.rows[0].name, level: named.rows[0].level } : null };
  }
  if (!context) return null;
  const [rows, learner, plan] = await Promise.all([
    db.query(
      `SELECT sn.id AS node_id, sn.node_type, COALESCE(snl.label, sn.source_label, sn.code, '') AS node_label, sn.order_index,
              lo.id AS objective_id, lo.code AS objective_code, lo.description AS objective_description, cc.id AS canonical_concept_id
         FROM structure_nodes sn
         JOIN learning_objectives lo ON lo.structure_node_id = sn.id AND lo.status = 'ACTIVE'
         LEFT JOIN objective_concept_mappings ocm ON ocm.learning_objective_id = lo.id AND ocm.status = 'PUBLISHED' AND ocm.relation_type IN ('FULL', 'PARTIAL')
         LEFT JOIN canonical_concepts cc ON cc.id = ocm.canonical_concept_id AND cc.status = 'ACTIVE'
         LEFT JOIN LATERAL (SELECT label FROM structure_node_localizations l WHERE l.structure_node_id = sn.id AND l.language = $2 LIMIT 1) snl ON true
        WHERE sn.structure_version_id = $1
        ORDER BY sn.order_index, lo.code NULLS LAST, cc.name`,
      [context.structureVersionId, locale]
    ),
    // The Student's own concepts linked to the catalogue, in ANY of their subjects (this subject first): adding a
    // concept may place it in the subject the catalogue assigns, and the row must still read as added.
    db.query(
      `SELECT m.canonical_concept_id, c.id AS concept_id, c.subject_id
         FROM concept_catalog_mapping m JOIN concepts c ON c.id = m.learner_concept_id JOIN subjects s ON s.id = c.subject_id
        WHERE s.student_id = $1 AND s.status <> 'archived' AND m.status = 'MATCHED'
        ORDER BY (c.subject_id = $2) DESC, c.created_at`,
      [studentId, subject.id]
    ),
    db.query(`SELECT canonical_concept_id FROM student_plan_entries WHERE student_id = $1 AND plan_status <> 'ARCHIVED'`, [studentId]).catch(() => ({ rows: [] as any[] })),
  ]);
  const topicRows: CurriculumTopicRow[] = rows.rows.map((r: any) => ({
    nodeId: r.node_id, nodeType: r.node_type, nodeLabel: r.node_label ?? '', nodeOrder: r.order_index ?? 0,
    objectiveId: r.objective_id, objectiveCode: r.objective_code, objectiveDescription: r.objective_description ?? '', canonicalConceptId: r.canonical_concept_id,
  }));
  const labels = await canonicalConceptLabels(topicRows.map((r) => r.canonicalConceptId).filter((v): v is string => !!v), locale);
  const learnerByCanonical = new Map<string, LearnerConceptRef>();
  for (const r of learner.rows as any[]) if (!learnerByCanonical.has(r.canonical_concept_id)) learnerByCanonical.set(r.canonical_concept_id, { conceptId: r.concept_id, subjectId: r.subject_id });
  const inPlan = new Set<string>(plan.rows.map((r: any) => r.canonical_concept_id as string));
  const topics = buildCurriculumTopics(topicRows, labels, learnerByCanonical, locale, inPlan);
  // M03 / M03d: assessment components (IB and Cambridge) through the one component display path.
  return { status: 'READY', context, reason, topics: topics.map((t) => ({ ...t, component: t.component ? localizeComponentLabel(context.programme, t.component, locale) : null })) };
}

/**
 * G -- catalogue display labels for the Student's own concepts: a learner concept linked to a canonical
 * concept (concept_catalog_mapping MATCHED) is shown with the catalogue's label in the interface locale,
 * through the shared resolver (labels.ts): stored localization, else the governed concept-label list.
 * Unlinked concepts (what the Student typed), and concepts the catalogue has no label for, keep their
 * stored label. Display only -- no row is renamed.
 */
export async function catalogLabelsForLearnerConcepts(conceptIds: string[], locale: string): Promise<Map<string, string>> {
  const ids = [...new Set(conceptIds.filter(Boolean))];
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const r = await db
    .query(
      `SELECT m.learner_concept_id, cc.name AS canonical_name, l.label AS catalog_localized
         FROM concept_catalog_mapping m
         JOIN canonical_concepts cc ON cc.id = m.canonical_concept_id
         LEFT JOIN canonical_concept_localizations l ON l.canonical_concept_id = m.canonical_concept_id AND l.language = $2
        WHERE m.learner_concept_id = ANY($1::uuid[]) AND m.status = 'MATCHED'`,
      [ids, locale]
    )
    .catch(() => ({ rows: [] as any[] }));
  // Only concepts LINKED to the catalogue appear here, and only when the catalogue supplies a label (stored
  // localization, else the governed list). Everything else -- every concept the Student typed -- keeps its own title.
  for (const row of r.rows) {
    const facts = { canonicalName: row.canonical_name as string, catalogLocalized: row.catalog_localized as string | null };
    if (catalogSuppliesLabel(facts, locale)) out.set(row.learner_concept_id, resolveLearnerConceptLabel(facts, locale)!);
  }
  return out;
}
