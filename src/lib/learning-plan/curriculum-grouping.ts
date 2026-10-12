/**
 * Curriculum convergence -- where a Learn concept sits in the subject view (pure rules, no IO).
 *
 * The Student's own topic hierarchy (topics -> subtopics) classifies the concepts they typed or uploaded.
 * A concept added from the catalogue has no such classification, but it is NOT unclassified: its recorded
 * curriculum provenance (learner_concept_curriculum_provenance) says where it belongs. Such a concept is
 * grouped under its curriculum, and "Sin clasificar" / "Otros conceptos" keeps only the concepts that
 * genuinely have no resolvable classification.
 *
 *   topic     the curriculum                 "<programme> · <subject> · <level>"   (official catalogue names)
 *   subtopic  the curriculum unit            a syllabus node (its label); when the node is an assessment
 *                                            component (a paper is not a topic) the learning objective
 *
 * This is the same unit rule the catalogue screen uses (subject-curriculum-topics.ts `buildCurriculumTopics`),
 * so a concept is listed in Learn under the heading it was added from. Nothing is inferred: a concept without
 * a recorded provenance stays where it was.
 */
import { learningObjectiveLabel } from '@/lib/exam-core/catalog/objective-localization';
import { levelDisplayLabel, localizeCatalogSubjectName } from '@/lib/exam-core/catalog/subject-localization';

/** Node types that are assessment components, never syllabus topics. */
export const ASSESSMENT_NODE_TYPES: ReadonlySet<string> = new Set(['EXAM_SECTION', 'PAPER', 'COMPONENT']);

export interface ConceptCurriculumPlacement {
  academicSubjectId: string;
  structureVersionId: string;
  structureNodeId: string;
  learningObjectiveId: string;
  programme: string;
  subject: string;
  level: string | null;
  nodeType: string;
  nodeLabel: string;
  nodeOrder: number;
  objectiveCode: string | null;
  objectiveDescription: string;
}

export interface CurriculumGroupedTopic<C> {
  id: string;
  name: string;
  subtopics: Array<{ id: string; name: string; concepts: C[] }>;
}

const clean = (s: string) => s.trim().replace(/\.$/, '');

/** The curriculum unit a placement belongs to: the syllabus node, else (assessment component) the objective. */
export function curriculumUnitOf(p: ConceptCurriculumPlacement, locale: string): { key: string; title: string } {
  if (!ASSESSMENT_NODE_TYPES.has(p.nodeType)) return { key: `node:${p.structureNodeId}`, title: clean(p.nodeLabel) };
  return { key: `lo:${p.learningObjectiveId}`, title: learningObjectiveLabel(p.objectiveCode, locale) ?? clean(p.objectiveDescription) };
}

/**
 * Split the concepts that have no place in the Student's own hierarchy into curriculum groups (those with a
 * recorded provenance) and the genuinely unclassified rest. Input order is kept inside every group.
 */
export function groupUnassignedByCurriculum<C extends { id: string }>(
  unassigned: readonly C[],
  placements: ReadonlyMap<string, ConceptCurriculumPlacement>,
  locale: string
): { curriculumTopics: CurriculumGroupedTopic<C>[]; unassigned: C[] } {
  const topics = new Map<string, CurriculumGroupedTopic<C> & { order: Map<string, number> }>();
  const rest: C[] = [];
  for (const concept of unassigned) {
    const p = placements.get(concept.id);
    if (!p) {
      rest.push(concept);
      continue;
    }
    const topicId = `curriculum:${p.structureVersionId}`;
    let topic = topics.get(topicId);
    if (!topic) {
      topic = { id: topicId, name: [p.programme, localizeCatalogSubjectName(p.subject, locale), levelDisplayLabel(p.level, locale)].filter(Boolean).join(' · '), subtopics: [], order: new Map() };
      topics.set(topicId, topic);
    }
    const unit = curriculumUnitOf(p, locale);
    const subtopicId = `${topicId}:${unit.key}`;
    let subtopic = topic.subtopics.find((s) => s.id === subtopicId);
    if (!subtopic) {
      subtopic = { id: subtopicId, name: unit.title, concepts: [] };
      topic.subtopics.push(subtopic);
      topic.order.set(subtopicId, p.nodeOrder);
    }
    subtopic.concepts.push(concept);
  }
  const curriculumTopics = [...topics.values()].map(({ order, ...topic }) => ({
    ...topic,
    // catalogue order of the units (node order), stable for equal orders
    subtopics: topic.subtopics.map((s, i) => ({ s, i })).sort((a, b) => (order.get(a.s.id) ?? 0) - (order.get(b.s.id) ?? 0) || a.i - b.i).map((x) => x.s),
  }));
  return { curriculumTopics, unassigned: rest };
}
