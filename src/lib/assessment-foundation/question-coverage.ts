/**
 * B1 -- QuestionCoverage: the store-neutral description of WHAT a question measures and WHERE it may be used
 * (pure contract + per-store projections, no IO).
 *
 * StudyOS keeps two physical question stores (Model B). They are not merged and no item links one to the
 * other; both are read through this one contract:
 *
 *   REVIEWED_EXAM_BANK   question_bank_items -> approved_items. Keyed on a learning objective; canonical
 *                        concepts are reached through the curriculum's objective <-> concept mappings.
 *   LEARNING_ITEM_CACHE  question_bank_candidates. Per Student, generated, keyed on that Student's own
 *                        concept; the canonical concept is reached through the explicit learner-concept link.
 *
 * Honesty rules:
 *   - A field the source does not record is UNKNOWN, never a default (no estimated time exists today; no
 *     licence is attached to an item unless its sources say so).
 *   - An exam item's concepts come from its OBJECTIVE's mappings. That does not say every mapped concept is
 *     equally assessed by this particular item: each concept is reported with role UNSPECIFIED and the
 *     basis OBJECTIVE_MAPPING, carrying the mapping's own relation. No evidence weight is fabricated.
 *   - A learning question whose learner concept has no CANONICAL link is UNRESOLVED. No label is matched,
 *     and a TRANSITIONAL (label-matched, unconfirmed) link is not a canonical link: it counts as unresolved
 *     for every assessment use (B1-C). The unconfirmed correspondence is kept visible for governance in
 *     `unconfirmedConceptId`; nothing may plan with it.
 *   - A question may cover 0..N canonical concepts; the contract carries a role per concept (PRIMARY /
 *     SUPPORTING / UNSPECIFIED) so item-level attribution can arrive without a redesign.
 *
 * This contract describes. It never selects, ranks or counts.
 */
import type { CurriculumScopeRef, ObjectiveConceptRelation } from '@/lib/curriculum/curriculum-scope';
import { canonicalConceptIdForAssessment, type ConceptIdentity } from '@/lib/catalog/concept-identity';
import type { EligibilityFacts } from '@/lib/exam-core/question-bank/lifecycle';
import { known, knownOrUnknown, NOT_APPLICABLE, UNKNOWN, type Known } from './known';

export const QUESTION_COVERAGE_VERSION = 1 as const;

export const QUESTION_STORES = ['REVIEWED_EXAM_BANK', 'LEARNING_ITEM_CACHE'] as const;
export type QuestionStore = (typeof QUESTION_STORES)[number];

/** A question by reference. `id` is `approved_items.id` or `question_bank_candidates.id`, per store. */
export interface QuestionRef {
  store: QuestionStore;
  id: string;
}

export const questionRefKey = (ref: QuestionRef): string => `${ref.store}:${ref.id}`;

/**
 * One provenance vocabulary over the stores. The first five are the reviewed bank's own
 * (`question_bank_items.provenance`); GENERATED_UNREVIEWED is the learning cache's content class.
 * STUDYUS_AUTHORED = written by an identified person; STUDYUS_GENERATED = drafted by a model, and it stays
 * so after a person edits or reviews it.
 */
export type QuestionProvenance = 'OFFICIAL' | 'LICENSED' | 'STUDYUS_GENERATED' | 'STUDYUS_AUTHORED' | 'FIXTURE' | 'GENERATED_UNREVIEWED';

/**
 * Reuse rights (`question_bank_content_rights.reuse_rights`). How a source can be READ (`source_access`,
 * e.g. PUBLICLY_ACCESSIBLE) is a different fact and grants nothing: only an established reuse right does.
 */
export const REUSE_RIGHTS = ['STUDYUS_OWNED', 'LICENSED_FOR_USE', 'OFFICIALLY_AUTHORIZED', 'UNKNOWN', 'PROHIBITED'] as const;
export type ReuseRights = (typeof REUSE_RIGHTS)[number];
export const ESTABLISHED_REUSE_RIGHTS: ReadonlySet<ReuseRights> = new Set(['STUDYUS_OWNED', 'LICENSED_FOR_USE', 'OFFICIALLY_AUTHORIZED']);

export type RightsContentType = 'ITEM_VERSION' | 'STIMULUS_VERSION' | 'ASSET';

/** The current rights record of one piece of content. `reuseRights: null` = no record exists. */
export interface ContentRightsFact {
  contentType: RightsContentType;
  contentId: string;
  sourceAccess: string | null;
  reuseRights: ReuseRights | null;
  /** Inside the record's validity dates on the day it was read. */
  inForce: boolean;
}

/** May content with this rights fact be reused today? */
export const reuseEstablished = (f: Pick<ContentRightsFact, 'reuseRights' | 'inForce'>): boolean => f.reuseRights !== null && ESTABLISHED_REUSE_RIGHTS.has(f.reuseRights) && f.inForce;

/** The stimulus version an item version is asked about (Question Bank fact). */
export interface StimulusFact {
  stimulusId: string;
  stimulusVersionId: string;
  /** Order of the question inside its group. */
  position: number;
  lifecycle: string;
  /** An approving review of the stimulus version exists. */
  humanApproved: boolean;
  isCurrentVersion: boolean;
  retired: boolean;
  /** The kind of set, as the Question Bank names it (`question_bank_stimuli.kind`: PASSAGE, PAIRED_PASSAGE, TABLE ...). */
  kind: string;
  /**
   * How many of the group's questions a form may take (`selection_min_items` / `selection_max_items` of the
   * stimulus version). null = the group is taken whole. B1 reports the rule; B2 applies it.
   */
  selection: { minItems: number; maxItems: number } | null;
}

/** A figure / graph the item version depends on, directly or through its stimulus. */
export interface AssetFact {
  assetId: string;
  lifecycle: string;
}

export type ConceptCoverageRole = 'PRIMARY' | 'SUPPORTING' | 'UNSPECIFIED';

export type ConceptCoverageBasis =
  /** Stated for THIS item version by a reviewer (`question_bank_item_concepts`). */
  | 'ITEM_ATTRIBUTION'
  /** Derived from the item's learning objective through the curriculum's objective <-> concept mapping. */
  | 'OBJECTIVE_MAPPING'
  /** The learning question was generated for the Student's concept, whose canonical link is explicit. */
  | 'LEARNER_CONCEPT_LINK';

export interface ConceptCoverage {
  canonicalConceptId: string;
  role: ConceptCoverageRole;
  basis: ConceptCoverageBasis;
  /** The curriculum mapping's relation, when the basis is OBJECTIVE_MAPPING. */
  relationType?: ObjectiveConceptRelation;
}

export type ConceptResolution =
  | { status: 'RESOLVED' }
  /** The item reaches an objective / learner concept, but no canonical concept is linked. Kept visible. */
  | { status: 'UNRESOLVED'; reason: 'OBJECTIVE_HAS_NO_CONCEPT_MAPPING' | 'LEARNER_CONCEPT_NOT_LINKED' | 'LEARNER_CONCEPT_LINK_TRANSITIONAL' | 'NO_ANCHOR' };

export interface QuestionCoverage {
  v: typeof QUESTION_COVERAGE_VERSION;
  ref: QuestionRef;
  /** The Student who owns a per-student cached item; null for the shared reviewed bank. */
  ownerStudentId: string | null;
  learningObjectiveIds: Known<string[]>;
  /** The learner concept a cached learning question was generated for (not an identity outside that Student). */
  learnerConceptId: string | null;
  /** Canonical concepts this question covers. Only CANONICAL identities appear here. */
  concepts: ConceptCoverage[];
  /**
   * A correspondence that exists only as an unconfirmed label match (TRANSITIONAL). Information for data
   * governance; NOT coverage, and never an input to eligibility, planning, readiness or attribution.
   */
  unconfirmedConceptId: string | null;
  conceptResolution: ConceptResolution;
  /** Structure versions the item belongs to (through its objective). */
  curriculumApplicability: Known<CurriculumScopeRef[]>;
  examApplicability: Known<{ examVersionId: string; assessmentComponentId: string | null }>;
  questionType: Known<string>;
  /** Item difficulty on the 1-5 scale both stores use. */
  difficulty: Known<number>;
  marks: Known<number>;
  /** No source records an estimated time today. */
  estimatedSeconds: Known<number>;
  language: Known<string>;
  provenance: QuestionProvenance;
  /** Licence status of the sources the item cites. Descriptive only: it is not a right to reuse and no eligibility rule reads it. */
  licensing: Known<{ statuses: string[]; sourceIds: string[] }>;
  /**
   * Rights of the item version and of everything it depends on (its stimulus version, every asset).
   * Reviewed bank: always starts with the ITEM_VERSION fact. Learning cache: empty.
   */
  rights: ContentRightsFact[];
  stimulus: StimulusFact | null;
  assets: AssetFact[];
  usage: Known<{ eligibility: string[] | null; examAlignment: string | null }>;
  review: {
    lifecycle: Known<string>;
    /** True only when a human review decision exists for the version. */
    humanReviewed: Known<boolean>;
  };
  /** The reviewed bank's own eligibility facts, passed through for the existing delivery rule (`isEligible`). */
  bankFacts: EligibilityFacts | null;
  /** The learning cache's own validation status. */
  cacheStatus: Known<string>;
}

/* ------------------------------------------------------------------ */
/* Reviewed exam bank projection                                        */
/* ------------------------------------------------------------------ */

export interface ReviewedBankItemRow {
  approvedItemId: string;
  learningObjectiveId: string;
  questionType: string | null;
  /** `approved_items.content` (JSONB): difficulty, marks, language are read from it; nothing else is trusted. */
  content: Record<string, unknown> | null;
  status: string;
  bankLifecycleStatus: string | null;
  usageEligibility: string[] | null;
  examAlignment: string | null;
  calibrationConfidence: string | null;
  contentOrigin: string | null;
  sourceIds: string[] | null;
  /** From the bank identity (`question_bank_items`), when the version has one. */
  bankItem: { provenance: string; examVersionId: string | null; assessmentComponentId: string | null; currentVersionId: string | null; retired: boolean; language: string | null } | null;
  /** `assessment_sources.license_status` of the item's sources (empty when the item cites none). */
  sourceLicenses: string[];
  humanReviewDecisions: number;
  /** The structure version of the item's objective. */
  scope: CurriculumScopeRef | null;
  /** PUBLISHED objective <-> concept mappings of the item's objective. */
  objectiveConcepts: Array<{ canonicalConceptId: string; relationType: ObjectiveConceptRelation }>;
  /** Item-level attribution of this version (`question_bank_item_concepts`). Absent / empty = unattributed (legacy). */
  itemConcepts?: Array<{ canonicalConceptId: string; role: 'PRIMARY' | 'SUPPORTING' }>;
  /** Current rights record of the version. null / absent = none exists. */
  itemRights?: RightsRecord | null;
  stimulus?: (StimulusFact & { rights: RightsRecord | null }) | null;
  assets?: Array<AssetFact & { rights: RightsRecord | null }>;
}

export type RightsRecord = Pick<ContentRightsFact, 'sourceAccess' | 'reuseRights' | 'inForce'>;

const NO_RIGHTS: RightsRecord = { sourceAccess: null, reuseRights: null, inForce: false };
const rightsFact = (contentType: RightsContentType, contentId: string, r: RightsRecord | null | undefined): ContentRightsFact => ({ contentType, contentId, ...(r ?? NO_RIGHTS) });

const numberIn = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** A version with no bank identity, or one whose content says so, is a fixture: never assumed to be real content. */
function reviewedProvenance(row: ReviewedBankItemRow): QuestionProvenance {
  const c = row.content ?? {};
  if (row.contentOrigin === 'FIXTURE' || c.contentOrigin === 'FIXTURE' || c.contentStatus === 'DEV_CERT_FIXTURE') return 'FIXTURE';
  const p = row.bankItem?.provenance;
  return p === 'OFFICIAL' || p === 'LICENSED' || p === 'STUDYUS_GENERATED' || p === 'STUDYUS_AUTHORED' ? p : 'FIXTURE';
}

export function coverageOfReviewedBankItem(row: ReviewedBankItemRow): QuestionCoverage {
  const provenance = reviewedProvenance(row);
  const content = row.content ?? {};
  const seen = new Set<string>();
  const concepts: ConceptCoverage[] = [];
  // A reviewer's attribution of THIS version replaces what the objective mapping would only suggest.
  const attributed = row.itemConcepts ?? [];
  for (const a of [...attributed].sort((x, y) => (x.role === y.role ? 0 : x.role === 'PRIMARY' ? -1 : 1))) {
    if (seen.has(a.canonicalConceptId)) continue;
    seen.add(a.canonicalConceptId);
    concepts.push({ canonicalConceptId: a.canonicalConceptId, role: a.role, basis: 'ITEM_ATTRIBUTION' });
  }
  if (attributed.length === 0) for (const m of row.objectiveConcepts) {
    if (seen.has(m.canonicalConceptId)) continue;
    seen.add(m.canonicalConceptId);
    concepts.push({ canonicalConceptId: m.canonicalConceptId, role: 'UNSPECIFIED', basis: 'OBJECTIVE_MAPPING', relationType: m.relationType });
  }
  const stimulus = row.stimulus ?? null;
  const assets = row.assets ?? [];
  const rights: ContentRightsFact[] = [
    rightsFact('ITEM_VERSION', row.approvedItemId, row.itemRights),
    ...(stimulus ? [rightsFact('STIMULUS_VERSION', stimulus.stimulusVersionId, stimulus.rights)] : []),
    ...assets.map((a) => rightsFact('ASSET', a.assetId, a.rights)),
  ];
  const bankFacts: EligibilityFacts = {
    lifecycle: (row.bankLifecycleStatus as EligibilityFacts['lifecycle']) ?? null,
    usage: row.usageEligibility,
    alignment: row.examAlignment,
    provenance,
    status: row.status,
    isCurrentVersion: row.bankItem ? row.bankItem.currentVersionId === row.approvedItemId : true,
    retired: row.bankItem?.retired ?? false,
    calibrationConfidence: (row.calibrationConfidence as EligibilityFacts['calibrationConfidence']) ?? null,
  };
  return {
    v: QUESTION_COVERAGE_VERSION,
    ref: { store: 'REVIEWED_EXAM_BANK', id: row.approvedItemId },
    ownerStudentId: null,
    learningObjectiveIds: known([row.learningObjectiveId]),
    learnerConceptId: null,
    concepts,
    unconfirmedConceptId: null,
    conceptResolution: concepts.length > 0 ? { status: 'RESOLVED' } : { status: 'UNRESOLVED', reason: 'OBJECTIVE_HAS_NO_CONCEPT_MAPPING' },
    curriculumApplicability: row.scope ? known([row.scope]) : UNKNOWN,
    examApplicability: row.bankItem?.examVersionId ? known({ examVersionId: row.bankItem.examVersionId, assessmentComponentId: row.bankItem.assessmentComponentId ?? null }) : UNKNOWN,
    questionType: knownOrUnknown(row.questionType),
    difficulty: knownOrUnknown(numberIn(content.difficulty)),
    marks: knownOrUnknown(numberIn(content.marks)),
    estimatedSeconds: UNKNOWN,
    language: knownOrUnknown(row.bankItem?.language ?? (typeof content.language === 'string' ? content.language : null)),
    provenance,
    licensing: row.sourceIds && row.sourceIds.length > 0 ? known({ statuses: [...new Set(row.sourceLicenses)], sourceIds: [...row.sourceIds] }) : UNKNOWN,
    rights,
    stimulus: stimulus ? { stimulusId: stimulus.stimulusId, stimulusVersionId: stimulus.stimulusVersionId, position: stimulus.position, lifecycle: stimulus.lifecycle, humanApproved: stimulus.humanApproved, isCurrentVersion: stimulus.isCurrentVersion, retired: stimulus.retired, kind: stimulus.kind, selection: stimulus.selection ? { ...stimulus.selection } : null } : null,
    assets: assets.map((a) => ({ assetId: a.assetId, lifecycle: a.lifecycle })),
    usage: known({ eligibility: row.usageEligibility, examAlignment: row.examAlignment }),
    review: { lifecycle: knownOrUnknown(row.bankLifecycleStatus), humanReviewed: known(row.humanReviewDecisions > 0) },
    bankFacts,
    cacheStatus: NOT_APPLICABLE,
  };
}

/* ------------------------------------------------------------------ */
/* Learning item cache projection                                       */
/* ------------------------------------------------------------------ */

export interface LearningCacheItemRow {
  candidateId: string;
  studentId: string;
  learnerConceptId: string;
  activityType: string | null;
  questionType: string | null;
  difficulty: number | null;
  language: string | null;
  validationStatus: string;
  /** The explicit identity of the learner concept (never a label match). null = the concept row is gone. */
  identity: ConceptIdentity | null;
}

export function coverageOfLearningCacheItem(row: LearningCacheItemRow): QuestionCoverage {
  const id = row.identity;
  // B1-C: only a CANONICAL identity is coverage. TRANSITIONAL behaves as unresolved.
  const canonicalId = canonicalConceptIdForAssessment(id);
  const concepts: ConceptCoverage[] = canonicalId ? [{ canonicalConceptId: canonicalId, role: 'PRIMARY', basis: 'LEARNER_CONCEPT_LINK' }] : [];
  const transitional = id?.status === 'TRANSITIONAL';
  return {
    v: QUESTION_COVERAGE_VERSION,
    ref: { store: 'LEARNING_ITEM_CACHE', id: row.candidateId },
    ownerStudentId: row.studentId,
    // Generation deliberately does not populate a learning objective for cached questions.
    learningObjectiveIds: UNKNOWN,
    learnerConceptId: row.learnerConceptId,
    concepts,
    unconfirmedConceptId: transitional ? id.canonicalConceptId : null,
    conceptResolution: concepts.length > 0 ? { status: 'RESOLVED' } : { status: 'UNRESOLVED', reason: transitional ? 'LEARNER_CONCEPT_LINK_TRANSITIONAL' : 'LEARNER_CONCEPT_NOT_LINKED' },
    // A cached question belongs to a Student's concept, not to a structure version or an exam.
    curriculumApplicability: UNKNOWN,
    examApplicability: NOT_APPLICABLE,
    questionType: knownOrUnknown(row.questionType),
    difficulty: knownOrUnknown(row.difficulty),
    marks: NOT_APPLICABLE,
    estimatedSeconds: UNKNOWN,
    language: knownOrUnknown(row.language),
    provenance: 'GENERATED_UNREVIEWED',
    licensing: NOT_APPLICABLE,
    rights: [],
    stimulus: null,
    assets: [],
    usage: NOT_APPLICABLE,
    review: { lifecycle: NOT_APPLICABLE, humanReviewed: known(false) },
    bankFacts: null,
    cacheStatus: known(row.validationStatus),
  };
}

/* ------------------------------------------------------------------ */
/* Read helpers (Q1 / B2 consume these; none selects)                   */
/* ------------------------------------------------------------------ */

/** Canonical concepts the question covers. Never includes an unconfirmed (TRANSITIONAL) correspondence. */
export const coveredConceptIds = (c: QuestionCoverage): string[] => c.concepts.map((x) => x.canonicalConceptId);

export const isMultiConcept = (c: QuestionCoverage): boolean => c.concepts.length > 1;

/**
 * The one concept a correct answer to this question is DIRECT evidence of: its PRIMARY concept, stated for
 * the item version. null for an unattributed (legacy) item -- a concept derived from the objective mapping
 * is never direct -- and a SUPPORTING concept never is.
 */
export const directEvidenceConceptId = (c: QuestionCoverage): string | null => {
  const primary = c.concepts.filter((x) => x.role === 'PRIMARY' && x.basis === 'ITEM_ATTRIBUTION');
  return primary.length === 1 ? primary[0].canonicalConceptId : null;
};

/** Can this question satisfy a direct-evidence requirement for the concept? Only through its PRIMARY concept. */
export const satisfiesDirectRequirement = (c: QuestionCoverage, canonicalConceptId: string): boolean => directEvidenceConceptId(c) === canonicalConceptId;

export interface CoverageSummary {
  total: number;
  byStore: Record<QuestionStore, number>;
  resolved: number;
  unresolved: number;
  multiConcept: number;
  /** Questions whose only correspondence is an unconfirmed label match (counted as unresolved). */
  transitional: number;
  /** Distinct canonical concepts and objectives reached by the given questions. */
  canonicalConceptIds: string[];
  learningObjectiveIds: string[];
  byProvenance: Partial<Record<QuestionProvenance, number>>;
  humanReviewed: number;
  licenceKnown: number;
}

/** A descriptive roll-up for readiness read models. It reports; it never chooses questions. */
export function summarizeCoverage(items: readonly QuestionCoverage[]): CoverageSummary {
  const out: CoverageSummary = { total: items.length, byStore: { REVIEWED_EXAM_BANK: 0, LEARNING_ITEM_CACHE: 0 }, resolved: 0, unresolved: 0, multiConcept: 0, transitional: 0, canonicalConceptIds: [], learningObjectiveIds: [], byProvenance: {}, humanReviewed: 0, licenceKnown: 0 };
  const concepts = new Set<string>();
  const objectives = new Set<string>();
  for (const c of items) {
    out.byStore[c.ref.store] += 1;
    if (c.conceptResolution.status === 'RESOLVED') out.resolved += 1;
    else out.unresolved += 1;
    if (isMultiConcept(c)) out.multiConcept += 1;
    if (c.unconfirmedConceptId) out.transitional += 1;
    for (const id of coveredConceptIds(c)) concepts.add(id);
    if (c.learningObjectiveIds.state === 'KNOWN') for (const id of c.learningObjectiveIds.value) objectives.add(id);
    out.byProvenance[c.provenance] = (out.byProvenance[c.provenance] ?? 0) + 1;
    if (c.review.humanReviewed.state === 'KNOWN' && c.review.humanReviewed.value) out.humanReviewed += 1;
    if (c.licensing.state === 'KNOWN') out.licenceKnown += 1;
  }
  out.canonicalConceptIds = [...concepts].sort();
  out.learningObjectiveIds = [...objectives].sort();
  return out;
}
