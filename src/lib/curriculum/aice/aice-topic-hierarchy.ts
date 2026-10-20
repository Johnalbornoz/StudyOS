/**
 * Curriculum convergence -- the Cambridge AS & A Level syllabus Topic layer (pure data rules, no IO).
 *
 * Source: the governed reference `docs/exams/v2/sources/aice-reference-syllabi.json` (cambridgeinternational.org),
 * through its generated copy `exam-core/aice/aice-syllabi.generated.ts`. Nothing is written here by hand: the
 * Topic labels are the syllabus' own topic names, in the syllabus' own order.
 *
 * A syllabus has a usable Topic layer only when the source lists it AT TOPIC GRANULARITY -- one entry, one
 * topic ("Kinematics", "4 The macroeconomy"). Where the source holds a compound entry (a paper or a section
 * with its topics inside one string, e.g. 9709 "Pure Mathematics 1 (P1): Quadratics; Functions; ..."), the
 * Topic layer is NOT derived by splitting text: that syllabus is CURRICULUM_DATA_NOT_READY until the source is
 * regenerated at topic granularity.
 *
 * Levels: the AS Level subject holds the AS topics; the A Level subject holds the AS topics and the A Level
 * topics (the source's A Level routes are the AS components plus the A Level ones).
 *
 * The source carries no topic -> objective or topic -> concept link. The Topic nodes are syllabus structure
 * only; objectives stay where the exam configuration put them (under their paper).
 */
import { AICE_SYLLABI, type AiceSyllabus } from '@/lib/exam-core/aice/aice-syllabi.generated';

export const AICE_TOPIC_NODE_TYPE = 'TOPIC' as const;
export const AICE_TOPIC_SOURCE = 'AICE_REFERENCE_SYLLABUS' as const;
export const CURRICULUM_DATA_NOT_READY = 'CURRICULUM_DATA_NOT_READY' as const;

export type AiceLevel = 'AS' | 'A';

/** One entry is one topic: it names neither a list (";") nor a container with its content (":"). */
export const isTopicGranular = (entry: string): boolean => !/[;:]/.test(entry);

export function aiceSyllabusTopicReadiness(s: Pick<AiceSyllabus, 'topics'>): { ready: boolean; gap: string | null } {
  const entries = Object.values(s.topics).flat();
  if (entries.length === 0) return { ready: false, gap: 'the governed source lists no topics' };
  const compound = entries.filter((e) => !isTopicGranular(e));
  if (compound.length > 0) return { ready: false, gap: `the governed source lists ${compound.length} of ${entries.length} entries as compound text (a paper / section with its topics inside one string), not at topic granularity` };
  return { ready: true, gap: null };
}

export interface AiceTopicNode {
  /** Stable key: aice.<syllabus>.topic.<source level>.<NN> (NN = position in the source list). */
  code: string;
  label: string;
  /** The level list of the source the topic comes from. */
  sourceLevel: AiceLevel;
  orderIndex: number;
  sourceLocator: string;
}

export interface AiceTopicStructure {
  syllabusCode: string;
  level: AiceLevel;
  /** `structure_versions.source_locator` of the structure the exam configuration published for this syllabus + level. */
  structureSourceLocator: string;
  topics: AiceTopicNode[];
}

/** Topic nodes come after the paper nodes of the exam configuration. */
const ORDER_BASE = 100;

const levelTopics = (s: AiceSyllabus, sourceLevel: AiceLevel, offset: number): AiceTopicNode[] =>
  (s.topics[sourceLevel] ?? []).map((label, i) => ({
    code: `aice.${s.code}.topic.${sourceLevel.toLowerCase()}.${String(i + 1).padStart(2, '0')}`,
    label,
    sourceLevel,
    orderIndex: ORDER_BASE + offset + i,
    sourceLocator: `aice-reference-syllabi.json#${s.code}.topics.${sourceLevel}[${i}] (${s.sourceKey})`,
  }));

/** The Topic layer of every syllabus whose governed source is at topic granularity, per level structure. */
export function aiceTopicStructures(syllabi: readonly AiceSyllabus[] = AICE_SYLLABI): AiceTopicStructure[] {
  const out: AiceTopicStructure[] = [];
  for (const s of syllabi) {
    if (!aiceSyllabusTopicReadiness(s).ready) continue;
    const as = levelTopics(s, 'AS', 0);
    out.push({ syllabusCode: s.code, level: 'AS', structureSourceLocator: `exam-vertical-config:v2.aice.${s.code}-as`, topics: as });
    out.push({ syllabusCode: s.code, level: 'A', structureSourceLocator: `exam-vertical-config:v2.aice.${s.code}-a`, topics: [...as, ...levelTopics(s, 'A', as.length)] });
  }
  return out;
}

/** Syllabi of the governed source that have no usable Topic layer, with the exact source gap. */
export function aiceSyllabiWithoutTopicLayer(syllabi: readonly AiceSyllabus[] = AICE_SYLLABI): Array<{ syllabusCode: string; status: typeof CURRICULUM_DATA_NOT_READY; gap: string }> {
  return syllabi.flatMap((s) => {
    const r = aiceSyllabusTopicReadiness(s);
    return r.ready ? [] : [{ syllabusCode: s.code, status: CURRICULUM_DATA_NOT_READY, gap: r.gap! }];
  });
}
