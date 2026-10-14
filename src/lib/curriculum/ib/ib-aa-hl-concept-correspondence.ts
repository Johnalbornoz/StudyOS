/**
 * IB Mathematics: analysis and approaches HL -- StudyUs CANONICAL KNOWLEDGE mapped to the governed IB source
 * (pure data, no IO). Model (decided 2026-10-14):
 *
 *   StudyUs canonical concept  (STUDYUS_CANONICAL_KNOWLEDGE -- never "an official IB concept")
 *     -> explicit governed correspondence  (IB_GOVERNED_SOURCE_REFERENCE)
 *       -> the governed IB syllabus area: an objective of the IB vertical (v2.ib.math-aa-hl), whose description the
 *          vertical records from the IBO guide (source key `ibo-math-aa-guide-2021`)
 *         -> assessment applicability: the objective's catalogue link (objective-learning-links.ts, DECLARED_REVIEWED)
 *
 * NO IB Topic layer is created: the governed IB sources hold components and assessment objectives, no topics, and
 * none is invented. The correspondence is at SYLLABUS_AREA level (the repository holds no IB content statements).
 *
 * Concept identity: every CF-IB-AAHL-01 construct maps to a concept that ALREADY EXISTS in the StudyUs catalogue
 * (Mathematics rows of dev-learning-catalog.ts). Only `math.alg.quadratics` has a governed stable identity today
 * (PAA REMAP_EXISTING; the human-certified IB bucket D02 places it). For the other seven rows a StudyUs stable identity
 * is PROPOSED here; it becomes governed only by a recorded decision (docs/audits/exam-bank/IB_CONCEPT_IDENTITY_DECISIONS.csv).
 * Until then every construct that depends on one fails closed.
 */

export const IB_AA_HL_SOURCE = { sourceKey: 'ibo-math-aa-guide-2021', configKey: 'v2.ib.math-aa-hl', recordedIn: 'src/lib/exam-core/verticals/v2/ib-math-aa-hl.ts' } as const;
export type ConceptIdentityStatus = 'GOVERNED' | 'PROPOSED_PENDING_DECISION';
export interface StudyUsConceptIdentity {
  stableId: string;
  /** The existing StudyUs catalogue concept the identity names (exact canonical subject + name). */
  canonicalSubject: 'Mathematics';
  canonicalName: string;
  origin: 'STUDYUS_CANONICAL_KNOWLEDGE';
  status: ConceptIdentityStatus;
  /** Where a GOVERNED identity is recorded. */
  governedBy: string | null;
}

/** The identities the ten constructs need: one governed, seven proposed (over existing catalogue rows). */
export const IB_AA_HL_CONCEPT_IDENTITIES: readonly StudyUsConceptIdentity[] = [
  { stableId: 'math.alg.quadratics', canonicalSubject: 'Mathematics', canonicalName: 'Quadratic functions and inequalities', origin: 'STUDYUS_CANONICAL_KNOWLEDGE', status: 'GOVERNED', governedBy: 'src/lib/curriculum/paa/paa-certified-concepts.ts (REMAP_EXISTING) + human-certified bucket D02' },
  { stableId: 'math.alg.sequences-series', canonicalSubject: 'Mathematics', canonicalName: 'Sequences and series', origin: 'STUDYUS_CANONICAL_KNOWLEDGE', status: 'PROPOSED_PENDING_DECISION', governedBy: null },
  { stableId: 'math.alg.logarithms', canonicalSubject: 'Mathematics', canonicalName: 'Logarithms', origin: 'STUDYUS_CANONICAL_KNOWLEDGE', status: 'PROPOSED_PENDING_DECISION', governedBy: null },
  { stableId: 'math.fun.rational-functions-inverses', canonicalSubject: 'Mathematics', canonicalName: 'Rational functions and inverses', origin: 'STUDYUS_CANONICAL_KNOWLEDGE', status: 'PROPOSED_PENDING_DECISION', governedBy: null },
  { stableId: 'math.calc.differentiation', canonicalSubject: 'Mathematics', canonicalName: 'Differentiation', origin: 'STUDYUS_CANONICAL_KNOWLEDGE', status: 'PROPOSED_PENDING_DECISION', governedBy: null },
  { stableId: 'math.calc.integration', canonicalSubject: 'Mathematics', canonicalName: 'Integration', origin: 'STUDYUS_CANONICAL_KNOWLEDGE', status: 'PROPOSED_PENDING_DECISION', governedBy: null },
  { stableId: 'math.prob.binomial-distribution', canonicalSubject: 'Mathematics', canonicalName: 'Binomial distribution', origin: 'STUDYUS_CANONICAL_KNOWLEDGE', status: 'PROPOSED_PENDING_DECISION', governedBy: null },
  { stableId: 'math.prob.normal-distribution', canonicalSubject: 'Mathematics', canonicalName: 'Normal distribution', origin: 'STUDYUS_CANONICAL_KNOWLEDGE', status: 'PROPOSED_PENDING_DECISION', governedBy: null },
];

export type CorrespondenceType = 'SYLLABUS_AREA_CORRESPONDENCE';
export interface IbConstructCorrespondence {
  constructId: string;
  studyusCanonicalConceptId: string;
  conceptExistingOrNew: 'EXISTING_GOVERNED' | 'EXISTING_CATALOGUE_CONCEPT_IDENTITY_PROPOSED';
  ibSourceReference: { sourceKey: string; configKey: string; component: 'p1' | 'p2'; objectiveCode: string; syllabusAreaWords: string };
  ibCorrespondenceType: CorrespondenceType;
  /** The applicability evidence the register already holds for the objective -> concept link. */
  assessmentApplicability: { componentId: 'IB.MATH_AA_HL.P1' | 'IB.MATH_AA_HL.P2'; evidence: 'OBJECTIVE_CONCEPT_LINK'; reference: string; reviewState: 'DECLARED_REVIEWED' };
}

const p1 = (constructId: string, stableId: string, objectiveCode: string, syllabusAreaWords: string): IbConstructCorrespondence => ({
  constructId, studyusCanonicalConceptId: stableId, conceptExistingOrNew: stableId === 'math.alg.quadratics' ? 'EXISTING_GOVERNED' : 'EXISTING_CATALOGUE_CONCEPT_IDENTITY_PROPOSED',
  ibSourceReference: { sourceKey: IB_AA_HL_SOURCE.sourceKey, configKey: IB_AA_HL_SOURCE.configKey, component: objectiveCode.startsWith('aahl.p2') ? 'p2' : 'p1', objectiveCode, syllabusAreaWords },
  ibCorrespondenceType: 'SYLLABUS_AREA_CORRESPONDENCE',
  assessmentApplicability: { componentId: objectiveCode.startsWith('aahl.p2') ? 'IB.MATH_AA_HL.P2' : 'IB.MATH_AA_HL.P1', evidence: 'OBJECTIVE_CONCEPT_LINK', reference: objectiveCode, reviewState: 'DECLARED_REVIEWED' },
});
/** One per CF-IB-AAHL-01 construct. `syllabusAreaWords` are the words of the objective's governed description that cover it. */
export const IB_AA_HL_CORRESPONDENCES: readonly IbConstructCorrespondence[] = [
  p1('tf.math.series.geometric-sum-to-infinity', 'math.alg.sequences-series', 'aahl.p1.algebra', 'sequences and series'),
  p1('tf.math.logarithms.equation-one-admissible-root', 'math.alg.logarithms', 'aahl.p1.algebra', 'logarithms'),
  p1('tf.math.functions.inverse-function-value', 'math.fun.rational-functions-inverses', 'aahl.p1.functions', 'inverses'),
  p1('tf.math.quadratic.minimum-value', 'math.alg.quadratics', 'aahl.p1.functions', 'quadratics'),
  p1('tf.math.calculus.definite-integral-polynomial', 'math.calc.integration', 'aahl.p1.calculus', 'integration'),
  p1('tf.math.calculus.area-between-curve-and-axis', 'math.calc.integration', 'aahl.p1.calculus', 'integration'),
  p1('tf.math.calculus.tangent-gradient-at-a-point', 'math.calc.differentiation', 'aahl.p1.calculus', 'differentiation'),
  p1('tf.math.calculus.cubic-local-maximum', 'math.calc.differentiation', 'aahl.p1.calculus', 'differentiation'),
  p1('tf.math.probability.binomial-exact-probability', 'math.prob.binomial-distribution', 'aahl.p2.statistics', 'distributions'),
  p1('tf.math.probability.normal-symmetry', 'math.prob.normal-distribution', 'aahl.p2.statistics', 'distributions'),
];

export type CorrespondenceGovernance = 'GOVERNED' | 'SOURCE_BACKED_IDENTITY_PENDING_DECISION' | 'NOT_DEFENSIBLE';
/** Governance of one correspondence: defensible (source + link + catalogue row), and governed only with a governed identity. */
export function governanceOf(c: IbConstructCorrespondence, facts: { objectiveDescription: (code: string) => string | null; objectiveLinks: (code: string) => readonly { subject: string; name: string }[]; catalogue: readonly { subject: string; name: string }[] }): { status: CorrespondenceGovernance; reasons: string[] } {
  const reasons: string[] = [];
  const id = IB_AA_HL_CONCEPT_IDENTITIES.find((x) => x.stableId === c.studyusCanonicalConceptId);
  if (!id) reasons.push('NO_IDENTITY_RECORD');
  const description = facts.objectiveDescription(c.ibSourceReference.objectiveCode);
  if (!description || !description.toLowerCase().includes(c.ibSourceReference.syllabusAreaWords)) reasons.push('SYLLABUS_AREA_DOES_NOT_NAME_THE_CONSTRUCT');
  if (id && !facts.objectiveLinks(c.ibSourceReference.objectiveCode).some((l) => l.subject === id.canonicalSubject && l.name === id.canonicalName)) reasons.push('NO_OBJECTIVE_LINK_TO_THE_CONCEPT');
  if (id && !facts.catalogue.some((r) => r.subject === id.canonicalSubject && r.name === id.canonicalName)) reasons.push('CONCEPT_NOT_IN_THE_CATALOGUE');
  if (reasons.length) return { status: 'NOT_DEFENSIBLE', reasons };
  return id!.status === 'GOVERNED' ? { status: 'GOVERNED', reasons } : { status: 'SOURCE_BACKED_IDENTITY_PENDING_DECISION', reasons: ['IDENTITY_NOT_YET_GOVERNED'] };
}
