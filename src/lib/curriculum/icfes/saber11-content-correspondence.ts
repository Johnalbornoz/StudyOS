/**
 * Saber 11.° Matemáticas -- official CONTENT CATEGORY -> StudyUs canonical concept correspondences (pure data, no IO).
 *
 * SABER GOVERNANCE DECISION -- APPROVED FOR PILOT (John, 2026-10-15):
 *   decision_type ARCHITECTURE_GOVERNANCE_DECISION, scope PILOT, environment PILOT_PREVIEW, human_reviewer empty,
 *   human_review_status PENDING. Never HUMAN_CERTIFIED.
 *
 * SOURCE. The official ICFES guidance governed in the repository (sources icfes-marco-matematicas-saber11 and
 * icfes-guia-saber11-2026, as the v2.saber11.math vertical records them): THREE content categories, exactly as
 * labelled there -- 'Estadística', 'Álgebra y cálculo', 'Geometría' -- and THREE competencies. The repository holds
 * no finer ICFES content taxonomy, and none is invented here.
 *
 * MODEL. A category is a DOMAIN, not a concept: no single StudyUs concept is "semantically equivalent" to it. The
 * correspondence is therefore CATEGORY_CONTAINS_CONCEPT: an existing, neutral StudyUs canonical concept that lies
 * unambiguously inside the category. The official competency is kept as a SEPARATE dimension (the item's objective)
 * and is never mapped to a concept. No "Saber" concept is created: every concept is an existing identity governed by
 * its certified PAA record. A concept whose category is ambiguous is BLOCKED (not forced) and is not used.
 *
 * A Saber item may certify for PILOT_PREVIEW only when: its competency is governed (an objective of the vertical),
 * its content category is governed (one of the three labels), its concept correspondence is source-backed (a row
 * here with governance GOVERNED_PILOT), its lineage is complete and its response / scoring capability passes.
 * An item with no canonical concept is never certified.
 */
import { ASSESSMENT_APPLICABILITY_CONTRACT_VERSION, type ApplicabilityThresholdPolicy, type AssessmentApplicabilityRecord } from '@/lib/assessment-adaptation/assessment-applicability';

export const SABER_GOVERNANCE_DECISION = {
  decisionId: 'SABER-CONTENT-CORRESPONDENCE-2026-10-15', decision: 'APPROVED', decisionType: 'ARCHITECTURE_GOVERNANCE_DECISION', scope: 'PILOT', environment: 'PILOT_PREVIEW',
  humanReviewer: null, humanReviewStatus: 'PENDING', decidedAt: '2026-10-15', authorisedBy: 'operator instruction 2026-10-15 (Track B thread): SABER GOVERNANCE DECISION -- APPROVED FOR PILOT',
  sources: ['icfes-marco-matematicas-saber11', 'icfes-guia-saber11-2026'], configKey: 'v2.saber11.math',
} as const;

/** The official content categories, exactly as the governed source labels them (question-bank/pilots/saber11-math.ts CONTENTS). */
export const SABER_CONTENT_CATEGORIES = ['Estadística', 'Álgebra y cálculo', 'Geometría'] as const;
export type SaberContentCategory = (typeof SABER_CONTENT_CATEGORIES)[number];
/** The official competencies (the objectives of the vertical): a separate dimension, never mapped to a concept. */
export const SABER_COMPETENCIES = [
  { objectiveCode: 'saber.interpretacion', label: 'Interpretación y representación' },
  { objectiveCode: 'saber.formulacion', label: 'Formulación y ejecución' },
  { objectiveCode: 'saber.argumentacion', label: 'Argumentación' },
] as const;

export interface SaberCorrespondence {
  officialContentCategory: SaberContentCategory;
  studyusConceptStableId: string;
  studyusConceptName: string;
  canonicalSubject: 'Matemáticas';
  relation: 'CATEGORY_CONTAINS_CONCEPT';
  correspondenceScope: 'PILOT';
  source: typeof SABER_GOVERNANCE_DECISION.sources;
  /** HIGH: the concept is a standard topic of the category's own name (central tendency IS statistics). */
  confidence: 'HIGH' | 'MEDIUM';
  governanceStatus: 'GOVERNED_PILOT' | 'BLOCKED';
  /** Why a row is BLOCKED (the question for the owner). */
  blockedReason?: string;
}
const row = (officialContentCategory: SaberContentCategory, studyusConceptStableId: string, studyusConceptName: string, confidence: 'HIGH' | 'MEDIUM' = 'HIGH'): SaberCorrespondence => ({
  officialContentCategory, studyusConceptStableId, studyusConceptName, canonicalSubject: 'Matemáticas', relation: 'CATEGORY_CONTAINS_CONCEPT', correspondenceScope: 'PILOT', source: SABER_GOVERNANCE_DECISION.sources, confidence, governanceStatus: 'GOVERNED_PILOT',
});
const blocked = (officialContentCategory: SaberContentCategory, studyusConceptStableId: string, studyusConceptName: string, blockedReason: string): SaberCorrespondence => ({ ...row(officialContentCategory, studyusConceptStableId, studyusConceptName, 'MEDIUM'), governanceStatus: 'BLOCKED', blockedReason });

export const SABER_CONTENT_CORRESPONDENCES: readonly SaberCorrespondence[] = [
  row('Estadística', 'math.stat.central-tendency', 'Medidas de tendencia central'),
  row('Estadística', 'math.stat.data-representation', 'Representación e interpretación de datos'),
  row('Álgebra y cálculo', 'math.alg.linear-equations', 'Ecuaciones lineales'),
  row('Álgebra y cálculo', 'math.fun.linear-functions-lines', 'Rectas y funciones lineales'),
  row('Álgebra y cálculo', 'math.alg.linear-systems', 'Sistemas de ecuaciones'),
  row('Geometría', 'math.geo.plane-figures-area-perimeter', 'Área y perímetro'),
  row('Geometría', 'math.geo.pythagorean-theorem', 'Teorema de Pitágoras'),
  // Ambiguous: the repository's source says nothing finer than the category label, and these sit on a boundary.
  blocked('Estadística', 'math.prob.probability', 'Probabilidad', 'The governed source names the category "Estadística" only; whether ICFES places probability under it is not recorded in the repository.'),
  blocked('Álgebra y cálculo', 'math.num.percent', 'Porcentajes', 'Percentages are arithmetic; whether ICFES files them under "Álgebra y cálculo" (or treats them as generic content of every category) is not recorded.'),
  blocked('Geometría', 'math.geo.coordinate-plane', 'Plano cartesiano: coordenadas, distancia y punto medio', 'Coordinate geometry sits between "Geometría" and "Álgebra y cálculo"; not forced.'),
];
export const saberCorrespondenceOf = (stableId: string): SaberCorrespondence | null => SABER_CONTENT_CORRESPONDENCES.find((c) => c.studyusConceptStableId === stableId && c.governanceStatus === 'GOVERNED_PILOT') ?? null;

/**
 * The applicability register of the Saber component: one record per GOVERNED_PILOT correspondence. Basis
 * OFFICIAL_EXAM_STRUCTURE (the official content category is a node of the official structure and the concept is a
 * certified identity), review state UNREVIEWED -- the truth: no person reviewed the correspondence.
 */
export const SABER_COMPONENT_ID = 'ICFES.SABER11_MATEMATICAS';
export const SABER_APPLICABILITY: readonly AssessmentApplicabilityRecord[] = SABER_CONTENT_CORRESPONDENCES.filter((c) => c.governanceStatus === 'GOVERNED_PILOT').map((c) => ({
  v: ASSESSMENT_APPLICABILITY_CONTRACT_VERSION, concept: { stableId: c.studyusConceptStableId, canonicalSubject: c.canonicalSubject },
  scope: { systemProfileId: 'ICFES', subject: 'Matemáticas', componentId: SABER_COMPONENT_ID }, basis: 'OFFICIAL_EXAM_STRUCTURE',
  evidence: [{ kind: 'OFFICIAL_STRUCTURE_NODE_WITH_CERTIFIED_CONCEPT', reference: `saber.content.${c.officialContentCategory}`, recordedIn: 'src/lib/curriculum/icfes/saber11-content-correspondence.ts', sourceReference: c.source.join(', '), reviewState: 'UNREVIEWED' }],
}));

/**
 * The PILOT threshold under which those records establish applicability: the EA-1 rules unchanged, plus an official
 * structure node at UNREVIEWED -- for the ICFES system only, in PILOT_PREVIEW, by the decision above. It never
 * replaces the EA-1 threshold for any other system.
 */
export const SABER_PILOT_APPLICABILITY_THRESHOLD: ApplicabilityThresholdPolicy = {
  policyId: 'studyus.assessment-applicability-threshold.saber-pilot', version: '1', authority: 'STUDYUS_POLICY',
  satisfiedBy: [{ basis: 'OFFICIAL_EXAM_STRUCTURE', minimumReviewState: 'UNREVIEWED' }, { basis: 'REVIEWED_CATALOGUE_LINK', minimumReviewState: 'DECLARED_REVIEWED' }],
  note: `PILOT only (${SABER_GOVERNANCE_DECISION.decisionId}): an official ICFES content category carrying an existing certified StudyUs concept by a governed, not yet reviewed, correspondence. Human review PENDING.`,
};
