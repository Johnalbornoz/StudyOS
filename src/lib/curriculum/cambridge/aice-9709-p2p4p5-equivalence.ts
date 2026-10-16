/**
 * AICE 9709 AS Papers 2, 4 and 5 -> Cambridge International AS & A Level Mathematics 9709 Papers 2, 4 and 5: the
 * governed PILOT component equivalence, its topic correspondences and the StudyUs concept identities they use (pure
 * data, no IO).
 *
 * SOURCE (not a shared name or code): the AICE vertical v2.aice.9709-as is BUILT from the sourced syllabus record
 * AICE_SYLLABI[code 9709] (src/lib/exam-core/aice/aice-syllabi.generated.ts, confidence HIGH), whose sourceKey is the
 * official 9709 syllabus document `cie-9709-syllabus-2026-2027` (Cambridge International AS & A Level Mathematics,
 * 2026-2027 Version 4). That one record defines components p2 (Pure Mathematics 2), p4 (Mechanics) and p5
 * (Probability & Statistics 1) -- their minutes, marks, calculator rule, routes -- and lists each paper's topics. The
 * Cambridge component profiles CAMBRIDGE.9709.P2/P4/P5 (registered-systems.ts) restate the SAME records, as
 * CAMBRIDGE.9709.P1 restates components[p1]. Each AICE objective of those papers names one official topic of its paper.
 *
 * Decision (John, 2026-10-15, GOVERNANCE DECISIONS -- APPROVED, AICE): implement the missing governed supply for P2,
 * P4 and P5; reuse Cambridge 9709 content or capabilities only where an official governed source establishes the exact
 * component equivalence (it does: the same syllabus record); never infer equivalence from a shared name / code /
 * syllabus family; reuse neutral StudyUs canonical concepts. ARCHITECTURE_GOVERNANCE_DECISION, scope PILOT,
 * environment PILOT_PREVIEW, human reviewer empty, review PENDING. Never HUMAN_CERTIFIED.
 */
import { ASSESSMENT_APPLICABILITY_CONTRACT_VERSION, type AssessmentApplicabilityRecord } from '@/lib/assessment-adaptation/assessment-applicability';
import { AICE_SYLLABI } from '@/lib/exam-core/aice/aice-syllabi.generated';

export const AICE_9709_P2P4P5_DECISION = {
  decisionId: 'AICE-9709-P2P4P5-EQUIVALENCE-2026-10-15', decision: 'APPROVED', decisionType: 'ARCHITECTURE_GOVERNANCE_DECISION', scope: 'PILOT', environment: 'PILOT_PREVIEW',
  humanReviewer: null, humanReviewStatus: 'PENDING', decidedAt: '2026-10-15', authorisedBy: 'operator instruction 2026-10-15 (Track B thread): GOVERNANCE DECISIONS -- APPROVED (AICE P2, P4, P5)',
  sources: { syllabusRecord: 'src/lib/exam-core/aice/aice-syllabi.generated.ts (AICE_SYLLABI, code 9709)', syllabus: 'cie-9709-syllabus-2026-2027' },
  aiceConfigKey: 'v2.aice.9709-as',
} as const;

export type Cie9709Paper = 'p2' | 'p4' | 'p5';
export const CIE_9709_PAPER_ADAPTER: Readonly<Record<Cie9709Paper, string>> = { p2: 'CAMBRIDGE.9709.P2', p4: 'CAMBRIDGE.9709.P4', p5: 'CAMBRIDGE.9709.P5' };

/** The official topics of a paper, exactly as the sourced syllabus record lists them (topics.AS). */
export function officialTopicsOf(paper: Cie9709Paper): string[] {
  const s = AICE_SYLLABI.find((x) => x.code === '9709');
  const line = (s?.topics.AS ?? []).find((t) => t.includes(`(${paper.toUpperCase()}):`));
  return line ? line.slice(line.indexOf(':') + 1).split(';').map((t) => t.trim()) : [];
}

/**
 * StudyUs concept identities over EXISTING catalogue rows (dev-learning-catalog.ts, the rows the reviewed AICE
 * objective links name): a stable id for a row that had none. No concept is created; GOVERNED_PILOT by the decision.
 * The identities already governed (Logarithms, Differentiation, Binomial / Normal distribution) are reused as they are.
 */
export interface Cie9709ConceptIdentity { stableId: string; canonicalSubject: 'Mathematics'; canonicalName: string; origin: 'STUDYUS_CANONICAL_KNOWLEDGE'; status: 'GOVERNED_PILOT' | 'SUPERSEDED'; governedBy: string; /** SUPERSEDED: the existing canonical identity that replaces it. */ supersededBy?: string }
const id = (stableId: string, canonicalName: string): Cie9709ConceptIdentity => ({ stableId, canonicalSubject: 'Mathematics', canonicalName, origin: 'STUDYUS_CANONICAL_KNOWLEDGE', status: 'GOVERNED_PILOT', governedBy: AICE_9709_P2P4P5_DECISION.decisionId });
/**
 * SEMANTIC COLLISION DECISION (John, 2026-10-16, closeout governance rule "only if no equivalent canonical identity
 * already exists"): two of the six identities duplicated EXISTING canonical identities -- probability-events =
 * math.prob.probability, permutations-combinations = math.prob.counting (both PAA-certified). They are SUPERSEDED; AICE
 * P5 reuses the existing identities as CROSS_CURRICULUM_CANONICAL_IDENTITY (as Cambridge 9709 1.3 / 1.4 do). The
 * superseded records stay resolvable: the items published under them are history (retired, never rewritten).
 */
export const AICE_9709_IDENTITY_COLLISION_DECISION = {
  decisionId: 'AICE-9709-IDENTITY-COLLISION-2026-10-16', decision: 'APPROVED', decisionType: 'ARCHITECTURE_GOVERNANCE_DECISION', scope: 'PILOT', environment: 'PILOT_PREVIEW',
  humanReviewer: null, humanReviewStatus: 'PENDING', decidedAt: '2026-10-16', status: 'CONFIRMED',
  superseded: { 'math.prob.probability-events': 'math.prob.probability', 'math.prob.permutations-combinations': 'math.prob.counting' },
} as const;
const superseded = (stableId: keyof typeof AICE_9709_IDENTITY_COLLISION_DECISION.superseded, canonicalName: string): Cie9709ConceptIdentity => ({ ...id(stableId, canonicalName), status: 'SUPERSEDED', supersededBy: AICE_9709_IDENTITY_COLLISION_DECISION.superseded[stableId] });
export const CIE_9709_CONCEPT_IDENTITIES: readonly Cie9709ConceptIdentity[] = [
  id('math.calc.numerical-methods', 'Numerical methods'),
  id('math.mech.kinematics', 'Mechanics: kinematics'),
  id('math.mech.forces-equilibrium', 'Mechanics: forces and equilibrium'),
  id('math.mech.energy-work-power', 'Mechanics: energy, work and power'),
  superseded('math.prob.permutations-combinations', 'Permutations and combinations'),
  superseded('math.prob.probability-events', 'Probability and events'),
];
export const cie9709GovernedConceptByStableId = (stableId: string): Cie9709ConceptIdentity | null => CIE_9709_CONCEPT_IDENTITIES.find((x) => x.stableId === stableId) ?? null;

export interface AiceTopicEquivalence { aiceObjectiveCode: string; paper: Cie9709Paper; officialTopic: string; conceptStableId: string; conceptName: string; /** the canonical subject of the identity (an existing PAA identity is 'Matemáticas') */ conceptSubject?: 'Mathematics' | 'Matemáticas'; /** CROSS_CURRICULUM: an existing identity whose display label is not the AICE link's row name (localisation review pending) */ correspondence?: 'CANONICAL_IDENTITY' | 'CROSS_CURRICULUM_CANONICAL_IDENTITY'; linkedCatalogueRow?: string }
/** One per AICE objective of P2 / P4 / P5: the official topic of its paper it is, and the StudyUs concept its reviewed link names. */
/** AS PUBLISHED with AICE-9709-P2P4P5-A1 (2026-10-15): the input of that batch. */
export const AICE_9709_P2P4P5_EQUIVALENCES_2026_10_15: readonly AiceTopicEquivalence[] = [
  { aiceObjectiveCode: 'aice.9709.p2.logarithms', paper: 'p2', officialTopic: 'Logarithmic and exponential functions', conceptStableId: 'math.alg.logarithms', conceptName: 'Logarithms' },
  { aiceObjectiveCode: 'aice.9709.p2.differentiation', paper: 'p2', officialTopic: 'Differentiation', conceptStableId: 'math.calc.differentiation', conceptName: 'Differentiation' },
  { aiceObjectiveCode: 'aice.9709.p2.numerical', paper: 'p2', officialTopic: 'Numerical solution of equations', conceptStableId: 'math.calc.numerical-methods', conceptName: 'Numerical methods' },
  { aiceObjectiveCode: 'aice.9709.p4.kinematics', paper: 'p4', officialTopic: 'Kinematics of motion in a straight line', conceptStableId: 'math.mech.kinematics', conceptName: 'Mechanics: kinematics' },
  { aiceObjectiveCode: 'aice.9709.p4.forces', paper: 'p4', officialTopic: 'Forces and equilibrium', conceptStableId: 'math.mech.forces-equilibrium', conceptName: 'Mechanics: forces and equilibrium' },
  { aiceObjectiveCode: 'aice.9709.p4.energy', paper: 'p4', officialTopic: 'Energy, work and power', conceptStableId: 'math.mech.energy-work-power', conceptName: 'Mechanics: energy, work and power' },
  { aiceObjectiveCode: 'aice.9709.p5.permutations', paper: 'p5', officialTopic: 'Permutations and combinations', conceptStableId: 'math.prob.permutations-combinations', conceptName: 'Permutations and combinations' },
  { aiceObjectiveCode: 'aice.9709.p5.probability', paper: 'p5', officialTopic: 'Probability', conceptStableId: 'math.prob.probability-events', conceptName: 'Probability and events' },
  { aiceObjectiveCode: 'aice.9709.p5.distributions', paper: 'p5', officialTopic: 'Discrete random variables', conceptStableId: 'math.prob.binomial-distribution', conceptName: 'Binomial distribution' },
  { aiceObjectiveCode: 'aice.9709.p5.normal', paper: 'p5', officialTopic: 'The normal distribution', conceptStableId: 'math.prob.normal-distribution', conceptName: 'Normal distribution' },
];
/** LIVE: P5 permutations / probability on the EXISTING canonical identities (AICE-9709-IDENTITY-COLLISION-2026-10-16). */
export const AICE_9709_P2P4P5_EQUIVALENCES: readonly AiceTopicEquivalence[] = AICE_9709_P2P4P5_EQUIVALENCES_2026_10_15.map((e) =>
  e.aiceObjectiveCode === 'aice.9709.p5.permutations' ? { ...e, conceptStableId: 'math.prob.counting', conceptName: 'Técnicas de conteo', conceptSubject: 'Matemáticas', correspondence: 'CROSS_CURRICULUM_CANONICAL_IDENTITY', linkedCatalogueRow: 'Mathematics / Permutations and combinations' }
  : e.aiceObjectiveCode === 'aice.9709.p5.probability' ? { ...e, conceptStableId: 'math.prob.probability', conceptName: 'Probabilidad', conceptSubject: 'Matemáticas', correspondence: 'CROSS_CURRICULUM_CANONICAL_IDENTITY', linkedCatalogueRow: 'Mathematics / Probability and events' }
  : e);


const LINKS_RECORDED_IN = 'src/lib/exam-core/catalog/aice-learning-links.ts (AICE_LEARNING_LINKS)';
/** The applicability register of CAMBRIDGE.9709.P2/P4/P5: the reviewed AICE objective -> concept link, scoped to its paper. */
const applicabilityOf = (rows: readonly AiceTopicEquivalence[]): readonly AssessmentApplicabilityRecord[] => rows.map((e) => ({
  v: ASSESSMENT_APPLICABILITY_CONTRACT_VERSION, concept: { stableId: e.conceptStableId, canonicalSubject: e.conceptSubject ?? 'Mathematics' },
  scope: { systemProfileId: 'CAMBRIDGE', subject: 'Mathematics (9709)', componentId: CIE_9709_PAPER_ADAPTER[e.paper] },
  basis: 'REVIEWED_CATALOGUE_LINK' as const,
  evidence: [{ kind: 'OBJECTIVE_CONCEPT_LINK' as const, reference: e.aiceObjectiveCode, recordedIn: LINKS_RECORDED_IN, sourceReference: `cie-9709-syllabus-2026-2027 > ${e.paper.toUpperCase()} topic "${e.officialTopic}" (AICE_SYLLABI[9709].topics.AS)`, reviewState: 'DECLARED_REVIEWED' as const }],
} as AssessmentApplicabilityRecord));
/**
 * LIVE register: the records of the live equivalences PLUS, as history, the records of the two superseded identities
 * (the batch published under them must stay reproducible; their bank rows are retired, so they serve nothing).
 */
export const AICE_9709_P2P4P5_APPLICABILITY: readonly AssessmentApplicabilityRecord[] = (() => {
  const live = applicabilityOf(AICE_9709_P2P4P5_EQUIVALENCES);
  const history = applicabilityOf(AICE_9709_P2P4P5_EQUIVALENCES_2026_10_15).filter((r) => r.concept.stableId in AICE_9709_IDENTITY_COLLISION_DECISION.superseded);
  return [...live, ...history];
})();
/** AS PUBLISHED with AICE-9709-P2P4P5-A1 and TB-PAA-MATH-MC-A1 (before the collision decision). */
export const AICE_9709_P2P4P5_APPLICABILITY_2026_10_15: readonly AssessmentApplicabilityRecord[] = applicabilityOf(AICE_9709_P2P4P5_EQUIVALENCES_2026_10_15);
