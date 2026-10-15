/**
 * AICE 9709 Paper 1 -> Cambridge 9709 Paper 1: the governed PILOT equivalence (pure data, no IO).
 *
 * The Cambridge AICE Diploma is a qualification awarded on Cambridge International AS & A Level examinations: the
 * sourced AICE curriculum (`cie-aice-curriculum`, aice-subjects.generated.ts) lists 9709 Mathematics as a Group 1
 * subject at AS and A Level, and the AICE vertical v2.aice.9709-as is built from the SAME syllabus document that
 * governs the Cambridge pair CAMBRIDGE.9709.P1 (`cie-9709-syllabus-2026-2027`, 2026-2027 Version 4). AICE Paper 1 is
 * therefore the same component, and each of its four practice objectives is one official 9709 P1 syllabus section.
 *
 * Decision (John, 2026-10-15): ARCHITECTURE_GOVERNANCE_DECISION, scope PILOT, environment PILOT_PREVIEW, no human
 * reviewer (review PENDING; never HUMAN_CERTIFIED). It authorises ONE thing: the AICE P1 buckets are filled from the
 * governed CAMBRIDGE.9709.P1 constructs, adapter and certification. No AICE content is created; AICE has no rule
 * profile of its own and none is invented.
 */
export const AICE_9709_P1_EQUIVALENCE_DECISION = {
  decisionId: 'AICE-9709-P1-EQUIVALENCE-2026-10-15', decision: 'APPROVED', decisionType: 'ARCHITECTURE_GOVERNANCE_DECISION', scope: 'PILOT', environment: 'PILOT_PREVIEW',
  humanReviewer: null, humanReviewStatus: 'PENDING', decidedAt: '2026-10-15', authorisedBy: 'operator instruction 2026-10-15 (Track B thread): AICE P1 equivalence = PILOT, reuse CAMBRIDGE.9709.P1',
  sources: { aiceCurriculum: 'cie-aice-curriculum', syllabus: 'cie-9709-syllabus-2026-2027' },
  aiceConfigKey: 'v2.aice.9709-as', cambridgeConfigKey: 'v2.cambridge.9709-as', governedPair: 'CAMBRIDGE.9709.P1',
} as const;

export interface AiceSectionEquivalence { aiceObjectiveCode: string; cambridgeObjectiveCode: string; syllabusSection: string; conceptStableId: string; conceptName: string }
/** One per AICE P1 objective: the official 9709 P1 section it is, and the StudyUs concept both already name. */
export const AICE_9709_P1_EQUIVALENCES: readonly AiceSectionEquivalence[] = [
  { aiceObjectiveCode: 'aice.9709.p1.quadratics', cambridgeObjectiveCode: 'cie.9709.p1.quadratics', syllabusSection: '1.1 Quadratics', conceptStableId: 'math.alg.quadratics', conceptName: 'Quadratic functions and inequalities' },
  { aiceObjectiveCode: 'aice.9709.p1.series', cambridgeObjectiveCode: 'cie.9709.p1.series', syllabusSection: '1.6 Series', conceptStableId: 'math.alg.sequences-series', conceptName: 'Sequences and series' },
  { aiceObjectiveCode: 'aice.9709.p1.differentiation', cambridgeObjectiveCode: 'cie.9709.p1.differentiation', syllabusSection: '1.7 Differentiation', conceptStableId: 'math.calc.differentiation', conceptName: 'Differentiation' },
  { aiceObjectiveCode: 'aice.9709.p1.integration', cambridgeObjectiveCode: 'cie.9709.p1.integration', syllabusSection: '1.8 Integration', conceptStableId: 'math.calc.integration', conceptName: 'Integration' },
];
