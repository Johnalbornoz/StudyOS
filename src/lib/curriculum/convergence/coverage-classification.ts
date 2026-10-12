/**
 * Curriculum convergence -- coverage classification (pure rules, no IO).
 *
 * Two questions about the catalogue, answered row by row and never by force:
 *
 *   1. An academic subject without a canonical subject: can its canonical subject be stated deterministically?
 *   2. A published structure version with nodes and no concept mapping: should it have mappings at all?
 *
 * No fuzzy match becomes canonical truth here. A canonical subject is stated only on one of two facts:
 *   MAPPING_EVIDENCE  every PUBLISHED objective -> concept mapping of the subject lands in ONE canonical subject
 *                     (the catalogue's reviewed mappings already say which subject it is);
 *   EXACT_NAME        exactly one ACTIVE canonical subject carries the identical name.
 * Prefix, similarity, translation and "closest" matches are not used. Everything else is classified and, when
 * it needs a person, queued for review.
 */

/** IB Diploma Programme core components: assessed work (essay, exhibition), not subjects with a concept catalogue. */
export const NON_ACADEMIC_COMPONENT_CONFIG_KEYS: ReadonlySet<string> = new Set(['v2.ib.s.extended-essay', 'v2.ib.s.theory-of-knowledge']);

/** Outgoing courses the governed IB catalogue keeps beside their successor ("outgoing" in the official entry). */
export const LEGACY_COURSE_CONFIG_KEYS: ReadonlySet<string> = new Set(['v2.ib.s.history-hl', 'v2.ib.s.history-sl', 'v2.ib.s.world-religions-sl']);

/** `exam-vertical-config:<key>` -> `<key>`; null for any other locator. */
export const configKeyOf = (sourceLocator: string | null | undefined): string | null => (sourceLocator?.startsWith('exam-vertical-config:') ? sourceLocator.slice('exam-vertical-config:'.length) : null);

export type AcademicSubjectMappingClass = 'MAPPABLE_DETERMINISTICALLY' | 'NEEDS_HUMAN_DECISION' | 'NOT_APPLICABLE' | 'DUPLICATE_LEGACY' | 'DATA_ERROR';

export interface UnmappedAcademicSubjectFacts {
  academicSubjectId: string;
  programme: string;
  name: string;
  level: string | null;
  status: string;
  /** Config key of its PUBLISHED structure version, when it comes from an exam configuration. */
  configKey: string | null;
  /** ACTIVE canonical subjects its PUBLISHED objective -> concept mappings land in. */
  mappedCanonicalSubjectIds: string[];
  /** ACTIVE canonical subjects with the identical name (case-insensitive, trimmed). */
  exactNameCanonicalSubjectIds: string[];
}

export interface AcademicSubjectMappingDecision {
  academicSubjectId: string;
  classification: AcademicSubjectMappingClass;
  /** Set only for MAPPABLE_DETERMINISTICALLY. */
  canonicalSubjectId: string | null;
  basis: 'MAPPING_EVIDENCE' | 'EXACT_NAME' | null;
  reason: string;
}

export function classifyUnmappedAcademicSubject(f: UnmappedAcademicSubjectFacts): AcademicSubjectMappingDecision {
  const out = (classification: AcademicSubjectMappingClass, reason: string, canonicalSubjectId: string | null = null, basis: AcademicSubjectMappingDecision['basis'] = null): AcademicSubjectMappingDecision => ({ academicSubjectId: f.academicSubjectId, classification, canonicalSubjectId, basis, reason });
  const evidence = [...new Set(f.mappedCanonicalSubjectIds)];
  const exact = [...new Set(f.exactNameCanonicalSubjectIds)];
  if (exact.length > 1) return out('DATA_ERROR', `${exact.length} ACTIVE canonical subjects carry the name "${f.name}"`);
  if (evidence.length === 1 && exact.length === 1 && exact[0] !== evidence[0]) return out('DATA_ERROR', 'its published concept mappings land in one canonical subject and its name is another canonical subject');
  if (evidence.length === 1) return out('MAPPABLE_DETERMINISTICALLY', 'every published objective -> concept mapping of the subject lands in this one canonical subject', evidence[0], 'MAPPING_EVIDENCE');
  if (evidence.length > 1) return out('NEEDS_HUMAN_DECISION', `its published concept mappings land in ${evidence.length} canonical subjects`);
  if (f.configKey && NON_ACADEMIC_COMPONENT_CONFIG_KEYS.has(f.configKey)) return out('NOT_APPLICABLE', 'programme core component (assessed work), not a subject with a concept catalogue');
  if (f.status === 'RETIRED') return out('DUPLICATE_LEGACY', 'the academic subject is retired');
  if (f.configKey && LEGACY_COURSE_CONFIG_KEYS.has(f.configKey)) return out('DUPLICATE_LEGACY', 'outgoing course kept beside its successor');
  if (exact.length === 1) return out('MAPPABLE_DETERMINISTICALLY', 'exactly one ACTIVE canonical subject carries the identical name', exact[0], 'EXACT_NAME');
  return out('NEEDS_HUMAN_DECISION', 'no canonical subject of the catalogue is this subject: creating or choosing one is a catalogue decision');
}

export type StructureVersionMappingClass = 'HAS_CONCEPT_MAPPINGS' | 'EXPECTED_TO_HAVE_CONCEPT_MAPPINGS' | 'STRUCTURAL_ONLY' | 'NON_ACADEMIC_COMPONENT' | 'MAPPING_DATA_MISSING' | 'LEGACY_RETIRED';

export interface StructureVersionFacts {
  structureVersionId: string;
  status: string;
  subjectStatus: string;
  configKey: string | null;
  nodes: number;
  activeObjectives: number;
  publishedConceptMappings: number;
  /** The academic subject has a canonical subject that holds at least one ACTIVE concept. */
  canonicalSubjectHasConcepts: boolean;
}

/**
 * Why a published structure version has (or has not) concept mappings. Only EXPECTED_TO_HAVE_CONCEPT_MAPPINGS
 * and MAPPING_DATA_MISSING are gaps, and both FAIL CLOSED at resolution (CURRICULUM_MAPPING_NOT_READY):
 *   EXPECTED_...          objectives and a canonical concept catalogue exist; only the reviewed mappings are missing;
 *   MAPPING_DATA_MISSING  objectives exist but the catalogue has no canonical subject / concepts to map them to.
 */
export function classifyStructureVersion(f: StructureVersionFacts): StructureVersionMappingClass {
  if (f.publishedConceptMappings > 0) return 'HAS_CONCEPT_MAPPINGS';
  if (f.status !== 'PUBLISHED' || f.subjectStatus === 'RETIRED' || (f.configKey && LEGACY_COURSE_CONFIG_KEYS.has(f.configKey))) return 'LEGACY_RETIRED';
  if (f.configKey && NON_ACADEMIC_COMPONENT_CONFIG_KEYS.has(f.configKey)) return 'NON_ACADEMIC_COMPONENT';
  if (f.activeObjectives === 0) return 'STRUCTURAL_ONLY';
  return f.canonicalSubjectHasConcepts ? 'EXPECTED_TO_HAVE_CONCEPT_MAPPINGS' : 'MAPPING_DATA_MISSING';
}

/** A version of this class legitimately has no concept mapping; the others are missing data that fails closed. */
export const isValidWithoutMappings = (c: StructureVersionMappingClass): boolean => c === 'STRUCTURAL_ONLY' || c === 'NON_ACADEMIC_COMPONENT' || c === 'LEGACY_RETIRED';
