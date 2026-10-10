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
 *
 * Topic titles: the objective's reviewed label in the interface locale where the catalogue has one
 * (objective-localization.ts, keyed by the objective's stable code), else the stored description.
 *
 * Presentation only: no enrolment, no activation, no plan change happens here (subject autonomy is
 * untouched). Topic-level assessment / practice generation is out of scope (Blueprint Engine).
 */
import { db } from '@/lib/db';
import { canonicalConceptLabels } from './labels';
import { learningObjectiveLabel } from '@/lib/exam-core/catalog/objective-localization';
import { catalogKeyOf, resolveCurriculumContext, type ContextReason, type CurriculumOption } from './curriculum.service';

/** Node types that are assessment components, never syllabus topics. */
const ASSESSMENT_NODE_TYPES = new Set(['EXAM_SECTION', 'PAPER', 'COMPONENT']);

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
  /** The Student's own concept for it in THIS subject, when they already study it. */
  learnerConceptId: string | null;
}

export interface CurriculumTopic {
  key: string;
  title: string;
  /** Where the topic sits in the catalogue when the topic is an objective (e.g. "Paper 1A"); null otherwise. */
  component: string | null;
  concepts: CurriculumTopicConcept[];
}

export interface SubjectCurriculumTopics {
  context: CurriculumOption;
  reason: ContextReason;
  topics: CurriculumTopic[];
}

const clean = (s: string) => s.trim().replace(/\.$/, '');

/** Pure: catalogue rows -> topics (see the module comment for the two shapes). */
export function buildCurriculumTopics(rows: CurriculumTopicRow[], labels: Map<string, string>, learnerByCanonical: Map<string, string>, locale = 'en'): CurriculumTopic[] {
  const concept = (id: string): CurriculumTopicConcept => ({ canonicalConceptId: id, label: labels.get(id) ?? '', learnerConceptId: learnerByCanonical.get(id) ?? null });
  const mapped = rows.filter((r) => r.canonicalConceptId && labels.has(r.canonicalConceptId));
  const byNodeTopics = mapped.some((r) => !ASSESSMENT_NODE_TYPES.has(r.nodeType));
  const topics = new Map<string, CurriculumTopic>();
  const add = (key: string, title: string, component: string | null, id: string) => {
    if (!topics.has(key)) topics.set(key, { key, title, component, concepts: [] });
    const t = topics.get(key)!;
    if (!t.concepts.some((c) => c.canonicalConceptId === id)) t.concepts.push(concept(id));
  };
  if (byNodeTopics) {
    for (const r of mapped) if (!ASSESSMENT_NODE_TYPES.has(r.nodeType)) add(`node:${r.nodeId}`, clean(r.nodeLabel), null, r.canonicalConceptId!);
    return [...topics.values()];
  }
  for (const r of mapped) add(`lo:${r.objectiveId}`, learningObjectiveLabel(r.objectiveCode, locale) ?? clean(r.objectiveDescription), clean(r.nodeLabel) || null, r.canonicalConceptId!);
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

/** "IB Diploma Programme · Physics · HL" parts, for the section title (official names; the caller localizes the subject). */
export function curriculumContextParts(context: Pick<CurriculumOption, 'programme' | 'name' | 'level'>): { programme: string; subject: string; level: string | null } {
  return { programme: context.programme, subject: context.name, level: context.level };
}

/**
 * The curriculum topics of one of the Student's subjects, or null when the subject is not linked to a
 * known curriculum (then Learn shows no curriculum section at all).
 */
export async function loadSubjectCurriculumTopics(studentId: string, subject: { id: string; name: string }, locale: string): Promise<SubjectCurriculumTopics | null> {
  const catalogKey = catalogKeyOf(subject.name);
  if (!catalogKey) return null;
  const { context, reason } = await resolveCurriculumContext(studentId, catalogKey);
  if (!context) return null;
  const [rows, learner] = await Promise.all([
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
    db.query(
      `SELECT m.canonical_concept_id, c.id AS concept_id
         FROM concept_catalog_mapping m JOIN concepts c ON c.id = m.learner_concept_id
        WHERE c.subject_id = $1 AND m.status = 'MATCHED'`,
      [subject.id]
    ),
  ]);
  const topicRows: CurriculumTopicRow[] = rows.rows.map((r: any) => ({
    nodeId: r.node_id, nodeType: r.node_type, nodeLabel: r.node_label ?? '', nodeOrder: r.order_index ?? 0,
    objectiveId: r.objective_id, objectiveCode: r.objective_code, objectiveDescription: r.objective_description ?? '', canonicalConceptId: r.canonical_concept_id,
  }));
  const labels = await canonicalConceptLabels(topicRows.map((r) => r.canonicalConceptId).filter((v): v is string => !!v), locale);
  const learnerByCanonical = new Map<string, string>(learner.rows.map((r: any) => [r.canonical_concept_id, r.concept_id]));
  return { context, reason, topics: buildCurriculumTopics(topicRows, labels, learnerByCanonical, locale) };
}

/**
 * G -- catalogue display labels for the Student's own concepts: a learner concept linked to a canonical
 * concept (concept_catalog_mapping MATCHED) is shown with that concept's label in the interface locale
 * (canonical_concept_localizations). Unlinked concepts, and locales without a label, keep the stored
 * label. Display only -- no row is renamed.
 */
export async function catalogLabelsForLearnerConcepts(conceptIds: string[], locale: string): Promise<Map<string, string>> {
  const ids = [...new Set(conceptIds.filter(Boolean))];
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const r = await db
    .query(
      `SELECT m.learner_concept_id, l.label
         FROM concept_catalog_mapping m
         JOIN canonical_concept_localizations l ON l.canonical_concept_id = m.canonical_concept_id AND l.language = $2
        WHERE m.learner_concept_id = ANY($1::uuid[]) AND m.status = 'MATCHED'`,
      [ids, locale]
    )
    .catch(() => ({ rows: [] as any[] }));
  for (const row of r.rows) if (row.label) out.set(row.learner_concept_id, row.label);
  return out;
}
