/**
 * EA-1 (D1) -- the ASSESSMENT APPLICABILITY register of the mathematics proof of concept (pure data, no IO).
 *
 * Five canonical concepts x the six component profiles. EVERY RECORD IS A FACT THE REPOSITORY ALREADY HOLDS, and a
 * test rebuilds the whole register from the two places it comes from:
 *   OFFICIAL_EXAM_STRUCTURE    `PAA_TOPICS` (the certified PAA hierarchy): an OFFICIAL Topic, with its guide page,
 *                              whose `certifiedConceptId` is the concept. Review state CERTIFIED.
 *   REVIEWED_CATALOGUE_LINK    `allLearningLinks()`: an objective of the component's configuration whose link names
 *                              the concept's exact (canonical subject, name). The catalogue modules declare their
 *                              links reviewed and record no reviewer, so the state is DECLARED_REVIEWED.
 * Nothing else is here. Where the repository records neither, there is NO record: the applicability is NONE and
 * stays NOT_ESTABLISHED. No record was added because a concept "obviously" belongs to an exam, and none bridges
 * `Matemáticas` and `Mathematics`: `math.alg.quadratics` is applicable to IB and Cambridge because their own
 * objectives link the Mathematics concept, not because of its name.
 *
 * Scope is the COMPONENT the evidence is for: an IB link of a Paper 1 objective says nothing about Paper 2.
 * (`aasl.p1.functions` also links quadratics, for Mathematics AA SL Paper 1 -- a component that is not modelled.)
 */
import { ASSESSMENT_APPLICABILITY_CONTRACT_VERSION, type ApplicabilityEvidence, type AssessmentApplicabilityRecord } from './assessment-applicability';

const PAA_HIERARCHY = 'src/lib/curriculum/paa/paa-hierarchy.ts (PAA_TOPICS)';
const topic = (code: string, page: number): ApplicabilityEvidence => ({ kind: 'OFFICIAL_STRUCTURE_NODE_WITH_CERTIFIED_CONCEPT', reference: `paa.topic.${code}`, recordedIn: PAA_HIERARCHY, sourceReference: `cb-paa-guia-2021 p.${page}`, reviewState: 'CERTIFIED' });
const link = (objectiveCode: string, recordedIn: string): ApplicabilityEvidence => ({ kind: 'OBJECTIVE_CONCEPT_LINK', reference: objectiveCode, recordedIn, sourceReference: null, reviewState: 'DECLARED_REVIEWED' });
const paa = (stableId: string, canonicalSubject: string, ...evidence: ApplicabilityEvidence[]): AssessmentApplicabilityRecord => ({ v: ASSESSMENT_APPLICABILITY_CONTRACT_VERSION, concept: { stableId, canonicalSubject }, scope: { systemProfileId: 'PAA', subject: 'Matemáticas', componentId: 'PAA.MATEMATICAS' }, basis: 'OFFICIAL_EXAM_STRUCTURE', evidence });
const linked = (stableId: string, canonicalSubject: string, scope: AssessmentApplicabilityRecord['scope'], ...evidence: ApplicabilityEvidence[]): AssessmentApplicabilityRecord => ({ v: ASSESSMENT_APPLICABILITY_CONTRACT_VERSION, concept: { stableId, canonicalSubject }, scope, basis: 'REVIEWED_CATALOGUE_LINK', evidence });

const OBJECTIVE_LINKS = 'src/lib/exam-core/catalog/objective-learning-links.ts';
const AICE_LINKS = 'src/lib/exam-core/catalog/aice-learning-links.ts';
const PISA_LINKS = 'src/lib/exam-core/catalog/pisa-learning-links.ts';
const PISA_SCOPE = { systemProfileId: 'PISA', subject: 'Matemáticas', componentId: 'PISA.MATHEMATICS' };

/** Which objective-code prefix belongs to which modelled component. The test uses it to find EVERY link the repository records. */
export const MATH_POC_COMPONENT_OBJECTIVE_PREFIX: Readonly<Record<string, string>> = { 'IB.MATH_AA_HL.P1': 'aahl.p1.', 'IB.MATH_AA_HL.P2': 'aahl.p2.', 'CAMBRIDGE.9709.P1': 'aice.9709.p1.', 'PISA.MATHEMATICS': 'pisa.', 'ICFES.SABER11_MATEMATICAS': 'saber.' };
/** PISA objective codes of reading and science share the `pisa.` prefix; the mathematics ones are these content areas. */
export const PISA_MATHEMATICS_OBJECTIVE = /^pisa\.(cantidad|incertidumbre|cambio|espacio)\./;

export const MATH_POC_APPLICABILITY: readonly AssessmentApplicabilityRecord[] = [
  paa('math.num.ratio-proportion', 'Matemáticas', topic('028', 35)),
  paa('math.fun.linear-functions-lines', 'Matemáticas', topic('044', 35), topic('046', 35), topic('050', 35)),
  paa('math.alg.quadratics', 'Mathematics', topic('040', 35), topic('047', 35)),
  paa('math.prob.probability', 'Matemáticas', topic('067', 36)),
  paa('math.stat.data-representation', 'Matemáticas', topic('065', 36)),
  linked('math.alg.quadratics', 'Mathematics', { systemProfileId: 'IB', subject: 'Mathematics: analysis and approaches', componentId: 'IB.MATH_AA_HL.P1' }, link('aahl.p1.functions', OBJECTIVE_LINKS)),
  linked('math.alg.quadratics', 'Mathematics', { systemProfileId: 'CAMBRIDGE', subject: 'Mathematics (9709)', componentId: 'CAMBRIDGE.9709.P1' }, link('aice.9709.p1.quadratics', AICE_LINKS)),
  linked('math.num.ratio-proportion', 'Matemáticas', PISA_SCOPE, link('pisa.cantidad.formular', PISA_LINKS)),
  linked('math.prob.probability', 'Matemáticas', PISA_SCOPE, link('pisa.incertidumbre.interpretar', PISA_LINKS), link('pisa.incertidumbre.razonar', PISA_LINKS)),
];
