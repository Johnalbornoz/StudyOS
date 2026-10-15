/**
 * Cambridge International AS & A Level Mathematics 9709 -- Paper 1 Pure Mathematics 1: the OFFICIAL syllabus sections
 * and their explicit correspondences to StudyUs canonical knowledge identities (pure data, no IO).
 *
 * Two kinds of identity, never conflated:
 *   - the Cambridge section (1.1 Quadratics ... 1.8 Integration) is an OFFICIAL syllabus identity, read from the
 *     9709 syllabus for 2026 and 2027 (section 3 "Subject content" > "1 Pure Mathematics 1", printed pages 19-22;
 *     source `cie-9709-syllabus-2026-2027`, extract + digest in docs/exams/sources/cambridge-9709/);
 *   - the StudyUs canonical concept is a StudyUs knowledge identity. It never becomes a Cambridge concept, and its
 *     label alone never stands for the whole section: the section's own objective content is kept (`sectionScope`).
 *
 * Governance (decisions 2026-10-14, John): the correspondences are PILOT. They are NOT human reviewed; no reviewer is
 * recorded. Sections 1.3 and 1.4 reuse neutral StudyUs identities first governed through PAA (Spanish display labels):
 * CROSS_CURRICULUM_CANONICAL_IDENTITY, label locale mismatch recorded, localisation review pending (non-blocking).
 */
import { ASSESSMENT_APPLICABILITY_CONTRACT_VERSION, type AssessmentApplicabilityRecord } from '@/lib/assessment-adaptation/assessment-applicability';

export const CIE_9709_SOURCE_KEY = 'cie-9709-syllabus-2026-2027';
export const CIE_9709_P1_COMPONENT_ID = 'CAMBRIDGE.9709.P1';
export const CIE_9709_P1_DECISION = { decisionId: 'CIE-9709-P1-CORRESPONDENCES-2026-10-14', decision: 'APPROVED', basis: 'ARCHITECTURE_GOVERNANCE_DECISION', reviewScope: 'PILOT', humanReviewer: null, decidedAt: '2026-10-14' } as const;

export type CorrespondenceType = 'CANONICAL_IDENTITY' | 'CROSS_CURRICULUM_CANONICAL_IDENTITY';
export interface CieConceptCorrespondence {
  stableId: string;
  canonicalSubject: string;
  canonicalName: string;
  role: 'PRIMARY' | 'ADDITIONAL';
  correspondenceType: CorrespondenceType;
  correspondenceScope: 'PILOT';
  labelLocaleMismatch: boolean;
  crossLanguageIdentityReview: 'PENDING' | 'NOT_REQUIRED';
}
export interface CieSection {
  /** The official section number and title, exactly as the syllabus heads them. */
  section: string;
  title: string;
  page: number;
  /** The configuration objective (v2.cambridge.9709-as > p1) that carries the section. */
  objectiveCode: string;
  /** What the section covers, in the syllabus's own terms (summary of its learning outcomes). */
  sectionScope: readonly string[];
  concepts: readonly CieConceptCorrespondence[];
}

const same = (stableId: string, canonicalName: string, role: 'PRIMARY' | 'ADDITIONAL' = 'PRIMARY'): CieConceptCorrespondence => ({ stableId, canonicalSubject: 'Mathematics', canonicalName, role, correspondenceType: 'CANONICAL_IDENTITY', correspondenceScope: 'PILOT', labelLocaleMismatch: false, crossLanguageIdentityReview: 'NOT_REQUIRED' });
const cross = (stableId: string, canonicalName: string, role: 'PRIMARY' | 'ADDITIONAL' = 'PRIMARY'): CieConceptCorrespondence => ({ stableId, canonicalSubject: 'Matemáticas', canonicalName, role, correspondenceType: 'CROSS_CURRICULUM_CANONICAL_IDENTITY', correspondenceScope: 'PILOT', labelLocaleMismatch: true, crossLanguageIdentityReview: 'PENDING' });

export const CIE_9709_P1_SECTIONS: readonly CieSection[] = [
  { section: '1.1', title: 'Quadratics', page: 19, objectiveCode: 'cie.9709.p1.quadratics', sectionScope: ['completing the square and its use', 'the discriminant', 'quadratic equations and inequalities', 'simultaneous linear / quadratic equations', 'equations quadratic in a function of x'], concepts: [same('math.alg.quadratics', 'Quadratic functions and inequalities')] },
  { section: '1.2', title: 'Functions', page: 19, objectiveCode: 'cie.9709.p1.functions', sectionScope: ['function, domain, range, one-one, inverse, composition', 'range and composition', 'inverse of a one-one function', 'graph of a function and its inverse', 'transformations of graphs'], concepts: [same('math.fun.rational-functions-inverses', 'Rational functions and inverses'), cross('math.fun.functions', 'Funciones', 'ADDITIONAL')] },
  { section: '1.3', title: 'Coordinate geometry', page: 20, objectiveCode: 'cie.9709.p1.coordinate-geometry', sectionScope: ['equation of a straight line', 'gradients, distances, midpoints, intersections, parallel and perpendicular lines', 'equation of a circle', 'lines and circles', 'graphs, equations and points of intersection'], concepts: [cross('math.geo.coordinate-plane', 'Plano cartesiano: coordenadas, distancia y punto medio'), cross('math.fun.linear-functions-lines', 'Rectas y funciones lineales', 'ADDITIONAL')] },
  { section: '1.4', title: 'Circular measure', page: 20, objectiveCode: 'cie.9709.p1.circular-measure', sectionScope: ['the radian; radians and degrees', 'arc length and sector area'], concepts: [cross('math.geo.circles', 'Círculo: circunferencia, área y arcos')] },
  { section: '1.5', title: 'Trigonometry', page: 21, objectiveCode: 'cie.9709.p1.trigonometry', sectionScope: ['graphs of sine, cosine and tangent', 'exact values', 'inverse trigonometric notation', 'identities', 'solutions of simple trigonometric equations in an interval'], concepts: [same('math.trig.ratios', 'Trigonometry and triangles')] },
  { section: '1.6', title: 'Series', page: 21, objectiveCode: 'cie.9709.p1.series', sectionScope: ['binomial expansion of (a + b)^n', 'arithmetic and geometric progressions', 'nth term and sum of n terms', 'convergence and sum to infinity of a geometric progression'], concepts: [same('math.alg.sequences-series', 'Sequences and series')] },
  { section: '1.7', title: 'Differentiation', page: 22, objectiveCode: 'cie.9709.p1.differentiation', sectionScope: ['gradient as a limit; notation', 'derivative of x^n, sums, chain rule', 'gradients, tangents, normals, increasing / decreasing, rates of change', 'stationary points and their nature'], concepts: [same('math.calc.differentiation', 'Differentiation')] },
  { section: '1.8', title: 'Integration', page: 22, objectiveCode: 'cie.9709.p1.integration', sectionScope: ['integration as the reverse of differentiation', 'constant of integration', 'definite integrals', 'areas and volumes of revolution'], concepts: [same('math.calc.integration', 'Integration')] },
];

export const CIE_9709_P1_LINKS_RECORDED_IN = 'src/lib/curriculum/cambridge/cie-9709-p1-correspondence.ts (CIE_9709_P1_SECTIONS)';
/**
 * The applicability register of CAMBRIDGE.9709.P1: one record per (concept, component), backed by the official
 * section -> concept correspondence. Basis REVIEWED_CATALOGUE_LINK at DECLARED_REVIEWED (the pilot governance
 * decision; no human review is claimed), with the official syllabus locator of the section as source reference.
 */
export const CIE_9709_P1_APPLICABILITY: readonly AssessmentApplicabilityRecord[] = [...new Set(CIE_9709_P1_SECTIONS.flatMap((s) => s.concepts.map((c) => c.stableId)))].map((stableId) => {
  const sections = CIE_9709_P1_SECTIONS.filter((s) => s.concepts.some((c) => c.stableId === stableId));
  const concept = sections[0].concepts.find((c) => c.stableId === stableId)!;
  return {
    v: ASSESSMENT_APPLICABILITY_CONTRACT_VERSION, concept: { stableId, canonicalSubject: concept.canonicalSubject },
    scope: { systemProfileId: 'CAMBRIDGE', subject: 'Mathematics (9709)', componentId: CIE_9709_P1_COMPONENT_ID },
    basis: 'REVIEWED_CATALOGUE_LINK' as const,
    evidence: sections.map((s) => ({ kind: 'OBJECTIVE_CONCEPT_LINK' as const, reference: s.objectiveCode, recordedIn: CIE_9709_P1_LINKS_RECORDED_IN, sourceReference: `${CIE_9709_SOURCE_KEY} > 3 Subject content > 1 Pure Mathematics 1 > ${s.section} ${s.title} (p. ${s.page})`, reviewState: 'DECLARED_REVIEWED' as const })),
  } as AssessmentApplicabilityRecord;
});

/** The objective -> learning links of the configuration (the same correspondences, in the catalogue's link shape). */
export const CIE_9709_P1_LEARNING_LINKS: Record<string, { concepts: { subject: string; name: string }[]; skills: string[]; competencies: string[] }> = Object.fromEntries(
  CIE_9709_P1_SECTIONS.map((s) => [s.objectiveCode, { concepts: s.concepts.map((c) => ({ subject: c.canonicalSubject, name: c.canonicalName })), skills: ['Razonamiento algebraico'], competencies: ['dev.comp.math-reasoning'] }]),
);

/**
 * A register with the Cambridge records added: a (concept, component) pair the base register already holds keeps ONE
 * record, with the Cambridge evidence appended (math.alg.quadratics x CAMBRIDGE.9709.P1 is linked by the AICE
 * reference objective too). Nothing is replaced; no record is duplicated.
 */
export function withCie9709P1Applicability(base: readonly AssessmentApplicabilityRecord[]): AssessmentApplicabilityRecord[] {
  const key = (r: AssessmentApplicabilityRecord) => `${r.concept.stableId}|${r.scope.componentId}`;
  const extra = new Map(CIE_9709_P1_APPLICABILITY.map((r) => [key(r), r]));
  const merged = base.map((r) => { const add = extra.get(key(r)); if (!add) return r; extra.delete(key(r)); return { ...r, evidence: [...r.evidence, ...add.evidence] } as AssessmentApplicabilityRecord; });
  return [...merged, ...extra.values()];
}
