/**
 * POST-CANARY -- DIFFICULTY AND PAPER-FIDELITY PROFILE, VERSION 2 (pure). FOR FUTURE SPECIFICATIONS.
 *
 * WHY. In the Canary 0 of 76 CHALLENGE candidates were approved, and the approved IB and Cambridge items were
 * correct but far below the level of those papers. A band was one word, and "aligned with the specification" stood
 * in for "at the level of the paper". This profile states the demand of a band and the floor of a paper as
 * numbers that can be checked.
 *
 * HONESTY. NOTHING HERE IS A STATEMENT OF ANY EXAMINATION BOARD. Every number in this file is STUDYUS_POLICY,
 * PROVISIONAL, and REQUIRES SUBJECT-MATTER-EXPERT CONFIRMATION. What the repository records as official about a
 * component (its calculator rule, response formats, mark structure) is not restated here: `composeDemand` reads
 * it from the specification, with the provenance the specification carries.
 *
 * NO EXISTING ARTIFACT MOVES. The adaptation engine, its schema and every specification id are untouched. The
 * demand block is composed BESIDE a specification (`composeDemand(specification)`), given to generator version 4
 * as the optional `demand` member of a unit, and checked by `demandCheck`. A specification without a demand block
 * is a legacy specification and is handled exactly as before.
 */
import type { AdaptationSpecification } from '@/lib/assessment-adaptation/adaptation-specification';
import type { SpecificationCandidate } from '@/lib/exam-core/question-bank/production/specification-candidate';

export const DEMAND_PROFILE_V2 = {
  id: 'studyus.demand-profile.mathematics', version: '2.0.0-provisional', authority: 'STUDYUS_POLICY', status: 'PROVISIONAL', requiresSubjectMatterExpertConfirmation: true,
  notOfficial: 'No number in this profile is taken from, or claims to be, the standard of any examination board.',
  /** What a band demands, whatever the paper. Reasoning steps are steps a mark scheme can reward one by one. */
  bands: {
    FOUNDATIONAL: { targetCognitiveDemand: 'apply one known procedure to a directly stated situation', reasoningSteps: { min: 1, max: 2 }, nonRoutineElementRequired: false, representationTransitions: { min: 0, max: 1 }, numberTypes: ['whole numbers', 'simple fractions or one-decimal values'], algebraicComplexity: 'one relation, coefficients given or read directly' },
    STANDARD: { targetCognitiveDemand: 'choose and carry out a procedure of several steps; read a result back', reasoningSteps: { min: 2, max: 4 }, nonRoutineElementRequired: false, representationTransitions: { min: 0, max: 2 }, numberTypes: ['integers including negatives', 'fractions', 'decimals'], algebraicComplexity: 'one relation the learner sets up or rearranges' },
    CHALLENGE: { targetCognitiveDemand: 'plan a solution that is not signposted; connect two ideas or representations; justify', reasoningSteps: { min: 4, max: 8 }, nonRoutineElementRequired: true, representationTransitions: { min: 1, max: 3 }, numberTypes: ['non-integer rationals', 'parameters or unknown constants', 'values that must be chosen or bounded'], algebraicComplexity: 'a relation with a parameter, a constraint or two linked relations' },
  },
  /** A closed item cannot show working: its demand is carried by the stem and, for a selected response, by its distractors. */
  closedItemReasoningSteps: { FOUNDATIONAL: { min: 1 }, STANDARD: { min: 2 }, CHALLENGE: { min: 3 } },
  byResponseType: {
    SELECTED_RESPONSE: { expectedResponseDepth: 'one choice', distractorSophistication: { FOUNDATIONAL: 'each distractor is the result of one named single error', STANDARD: 'each distractor is the result of a named error at a different step; no distractor is eliminable by magnitude alone', CHALLENGE: 'at least two distractors are the result of a correct method applied to a plausible misreading or of stopping one step early; none is eliminable without working' } },
    NUMERIC_ENTRY: { expectedResponseDepth: 'one number in a stated form (unit, rounding)', distractorSophistication: null },
    CONSTRUCTED_RESPONSE: { expectedResponseDepth: { FOUNDATIONAL: 'working of one or two lines', STANDARD: 'method shown, each step rewarded', CHALLENGE: 'a justified argument: a REASONING mark point is required' }, distractorSophistication: null },
  },
  /** The non-routine element a CHALLENGE item must have, by what the family evidences. One of the listed kinds, declared and evidenced by a REASONING mark point. */
  nonRoutineElements: {
    PROCEDURAL: ['an unknown constant to be determined from a condition', 'a result to be interpreted or checked against a constraint', 'a reverse problem (the usual answer is given, a given is asked)'],
    MODELLING: ['a constraint that makes the unconstrained optimum inadmissible', 'a model to be chosen between two candidates', 'a parameter whose effect must be explained'],
    REASONING: ['a claim that is true for one reading of the data and false for another', 'a comparison that reverses when a base rate is used', 'an argument to be completed or criticised'],
    DATA_INTERPRETATION: ['a quantity not tabulated that must be derived from two rows', 'a change of base between two questions', 'a judgement of whether the data suffice'],
  },
} as const;
export type Band = keyof typeof DEMAND_PROFILE_V2.bands;

/**
 * PAPER FIDELITY PROFILES. One per component. `official` says only WHERE the official facts are (the specification);
 * `provisionalFloor` is StudyUs policy: the least an item must demand to be put on that paper, whatever its band.
 */
export interface PaperFidelityProfile { componentId: string; authority: 'STUDYUS_POLICY'; status: 'PROVISIONAL'; requiresSubjectMatterExpertConfirmation: true; official: string; provisionalFloor: { minimumReasoningSteps: number; minimumTotalMarksConstructed: number | null; marksPerPart: { min: number; max: number } | null; reasoningStepsPerMarkAtLeast: number; syllabusLevelExpectation: string }; notOfficial: string }
const OFFICIAL_IS_IN_THE_SPECIFICATION = 'What the repository records as official for this component -- calculator rule, response formats, mark structure, time budget, command terms -- is read from the specification with its provenance. Nothing official is restated in this profile.';
const NOT_THE_BOARDS = 'A StudyUs working floor, provisional, awaiting subject-matter-expert confirmation. It is not the board\'s standard and must not be presented as one.';
const paper = (componentId: string, minimumReasoningSteps: number, minimumTotalMarksConstructed: number | null, marksPerPart: { min: number; max: number } | null, syllabusLevelExpectation: string): PaperFidelityProfile => ({ componentId, authority: 'STUDYUS_POLICY', status: 'PROVISIONAL', requiresSubjectMatterExpertConfirmation: true, official: OFFICIAL_IS_IN_THE_SPECIFICATION, provisionalFloor: { minimumReasoningSteps, minimumTotalMarksConstructed, marksPerPart, reasoningStepsPerMarkAtLeast: 0.5, syllabusLevelExpectation }, notOfficial: NOT_THE_BOARDS });
export const PAPER_FIDELITY_PROFILES: readonly PaperFidelityProfile[] = [
  paper('IB.MATH_AA_HL.P1', 3, 5, { min: 1, max: 8 }, 'PROVISIONAL: an item for a higher-level paper without a calculator is not a single-step computation at any band; exact values and algebraic working are expected. To be confirmed by an IB mathematics specialist.'),
  paper('IB.MATH_AA_HL.P2', 3, 5, { min: 1, max: 8 }, 'PROVISIONAL: an item for a higher-level paper with a graphic display calculator asks for setting up and interpreting, not only for evaluating. To be confirmed by an IB mathematics specialist.'),
  paper('CAMBRIDGE.9709.P1', 3, 4, { min: 1, max: 7 }, 'PROVISIONAL: an item for an A Level pure mathematics paper needs working of several steps at any band. To be confirmed by a Cambridge mathematics specialist.'),
  paper('PAA.MATEMATICAS', 1, null, null, 'PROVISIONAL: closed items; the floor is the band\'s. To be confirmed.'),
  paper('ICFES.SABER11_MATEMATICAS', 1, null, null, 'PROVISIONAL: closed items; the floor is the band\'s. To be confirmed.'),
  paper('PISA.MATHEMATICS', 1, null, null, 'PROVISIONAL: closed items in an authentic context; the floor is the band\'s. To be confirmed.'),
  paper('SCHOOL_STEM_PERFORMANCE', 1, 3, { min: 1, max: 6 }, 'PROVISIONAL: a StudyUs school profile; the floor is the band\'s.'),
];
export const paperFidelityProfileOf = (targetId: string): PaperFidelityProfile | null => PAPER_FIDELITY_PROFILES.find((p) => p.componentId === targetId) ?? null;

const evidenceClassOf = (actions: readonly string[]): keyof typeof DEMAND_PROFILE_V2.nonRoutineElements => (actions.includes('EVALUATE') || actions.includes('JUSTIFY') ? 'REASONING' : actions.includes('FORMULATE') ? 'MODELLING' : actions.includes('INTERPRET') ? 'DATA_INTERPRETATION' : 'PROCEDURAL');
const responseTypeOf = (format: string): keyof typeof DEMAND_PROFILE_V2.byResponseType => (format === 'SELECTED_RESPONSE' ? 'SELECTED_RESPONSE' : format === 'NUMERIC_ENTRY' ? 'NUMERIC_ENTRY' : 'CONSTRUCTED_RESPONSE');
export interface DemandBlock {
  profile: { id: string; version: string; authority: 'STUDYUS_POLICY'; status: 'PROVISIONAL'; requiresSubjectMatterExpertConfirmation: true };
  specificationId: string; band: Band; responseType: string; evidenceClass: string; targetCognitiveDemand: string;
  minimumReasoningSteps: number; maximumReasoningSteps: number; nonRoutineElementRequired: boolean; nonRoutineElement: readonly string[];
  representationTransitions: { min: number; max: number }; numberTypes: readonly string[]; algebraicComplexity: string; expectedResponseDepth: string; distractorSophistication: string | null;
  paper: { componentId: string; minimumReasoningSteps: number; minimumTotalMarksConstructed: number | null; marksPerPart: { min: number; max: number } | null; syllabusLevelExpectation: string; authority: 'STUDYUS_POLICY'; status: 'PROVISIONAL' } | null;
  commandTermExpectations: unknown; officialFactsOfTheSpecification: Record<string, unknown>; notOfficial: string;
}
/** The demand block of a specification. The specification is read, not changed: its id is the same before and after. */
export function composeDemand(s: AdaptationSpecification): DemandBlock {
  const band = s.variable.difficulty.band as Band;
  const b = DEMAND_PROFILE_V2.bands[band];
  const responseType = responseTypeOf(s.variable.responseFormat.format);
  const cls = evidenceClassOf(s.invariants.evidenceTarget.actions as readonly string[]);
  const target = s.componentProfile?.componentId ?? s.systemProfile.profileId;
  const p = paperFidelityProfileOf(target);
  const closed = responseType !== 'CONSTRUCTED_RESPONSE';
  const bandMin = closed ? DEMAND_PROFILE_V2.closedItemReasoningSteps[band].min : b.reasoningSteps.min;
  const rt = DEMAND_PROFILE_V2.byResponseType[responseType];
  const provenance = s.provenance as unknown as Record<string, Array<{ origin?: string; authority?: string | null }>>;
  const authorityOf = (dim: string): string[] => [...new Set((provenance[dim] ?? []).map((x) => String(x.authority ?? x.origin ?? 'UNRECORDED')))];
  return {
    profile: { id: DEMAND_PROFILE_V2.id, version: DEMAND_PROFILE_V2.version, authority: 'STUDYUS_POLICY', status: 'PROVISIONAL', requiresSubjectMatterExpertConfirmation: true },
    specificationId: s.specificationId, band, responseType, evidenceClass: cls, targetCognitiveDemand: b.targetCognitiveDemand,
    minimumReasoningSteps: Math.max(bandMin, p?.provisionalFloor.minimumReasoningSteps ?? 1), maximumReasoningSteps: Math.max(b.reasoningSteps.max, p?.provisionalFloor.minimumReasoningSteps ?? 1),
    nonRoutineElementRequired: b.nonRoutineElementRequired, nonRoutineElement: b.nonRoutineElementRequired ? DEMAND_PROFILE_V2.nonRoutineElements[cls] : [],
    representationTransitions: b.representationTransitions, numberTypes: b.numberTypes, algebraicComplexity: b.algebraicComplexity,
    expectedResponseDepth: typeof rt.expectedResponseDepth === 'string' ? rt.expectedResponseDepth : rt.expectedResponseDepth[band], distractorSophistication: rt.distractorSophistication ? rt.distractorSophistication[band] : null,
    paper: p ? { componentId: p.componentId, minimumReasoningSteps: p.provisionalFloor.minimumReasoningSteps, minimumTotalMarksConstructed: p.provisionalFloor.minimumTotalMarksConstructed, marksPerPart: p.provisionalFloor.marksPerPart, syllabusLevelExpectation: p.provisionalFloor.syllabusLevelExpectation, authority: 'STUDYUS_POLICY', status: 'PROVISIONAL' } : null,
    commandTermExpectations: (s.variable as { commandTerms?: unknown }).commandTerms ?? null,
    officialFactsOfTheSpecification: { calculator: { value: s.variable.toolPolicy.calculator, recordedAuthority: authorityOf('toolPolicy') }, responseFormat: { value: s.variable.responseFormat.format, recordedAuthority: authorityOf('responseFormat') }, markStructure: { value: s.variable.markStructure, recordedAuthority: authorityOf('markStructure') } },
    notOfficial: DEMAND_PROFILE_V2.notOfficial,
  };
}

export type DemandOutcome = 'MEETS_DEMAND' | 'BELOW_DEMAND' | 'UNVERIFIED';
export type PaperLevelOutcome = 'MEETS_PROVISIONAL_FLOOR' | 'BELOW_PROVISIONAL_FLOOR' | 'UNVERIFIED';
export interface DemandCheck { difficultyAchieved: DemandOutcome; paperLevelFidelity: PaperLevelOutcome; evidencedReasoningSteps: number | null; reasoningPointPresent: boolean | null; totalMarks: number | null; issues: string[]; notCheckable: string[] }
/**
 * What can be checked of a demand block on a candidate. Only a constructed response shows its steps: a step is
 * EVIDENCED when the mark scheme rewards it (a METHOD or REASONING mark point). For a closed item the outcome is
 * UNVERIFIED: its steps and the quality of its distractors are not observable by a rule.
 */
export function demandCheck(c: SpecificationCandidate, demand: DemandBlock): DemandCheck {
  const notCheckable = ['whether a rewarded step is a genuine step', 'number types and algebraic complexity as described', 'whether the named non-routine element is really the one present', 'whether the level is the level of the paper: the floor is StudyUs policy, not the board\'s standard'];
  const k = c.content.constructed;
  if (!k) return { difficultyAchieved: 'UNVERIFIED', paperLevelFidelity: 'UNVERIFIED', evidencedReasoningSteps: null, reasoningPointPresent: null, totalMarks: null, issues: [], notCheckable: ['a closed item shows no working: its reasoning steps and its distractor design are not observable by a rule', ...notCheckable] };
  const points = k.parts.flatMap((p) => p.markScheme);
  const steps = points.filter((m) => m.kind === 'METHOD' || m.kind === 'REASONING').length;
  const reasoning = points.some((m) => m.kind === 'REASONING');
  const issues: string[] = [];
  const bandMin = DEMAND_PROFILE_V2.bands[demand.band].reasoningSteps.min;
  if (steps < bandMin) issues.push(`REASONING_STEPS_BELOW_THE_BAND:${steps}/${bandMin}`);
  if (demand.nonRoutineElementRequired && !reasoning) issues.push('NON_ROUTINE_ELEMENT_NOT_EVIDENCED_BY_A_REASONING_POINT');
  const paperIssues: string[] = [];
  if (demand.paper) {
    if (steps < demand.paper.minimumReasoningSteps) paperIssues.push(`REASONING_STEPS_BELOW_THE_PAPER_FLOOR:${steps}/${demand.paper.minimumReasoningSteps}`);
    if (demand.paper.minimumTotalMarksConstructed !== null && k.totalMarks < demand.paper.minimumTotalMarksConstructed) paperIssues.push(`TOTAL_MARKS_BELOW_THE_PAPER_FLOOR:${k.totalMarks}/${demand.paper.minimumTotalMarksConstructed}`);
    if (demand.paper.marksPerPart) for (const p of k.parts) if (p.marks > demand.paper.marksPerPart.max) paperIssues.push(`PART_MARKS_ABOVE_THE_RANGE:${p.label}:${p.marks}`);
  }
  return { difficultyAchieved: issues.length > 0 ? 'BELOW_DEMAND' : 'MEETS_DEMAND', paperLevelFidelity: !demand.paper ? 'UNVERIFIED' : paperIssues.length > 0 ? 'BELOW_PROVISIONAL_FLOOR' : 'MEETS_PROVISIONAL_FLOOR', evidencedReasoningSteps: steps, reasoningPointPresent: reasoning, totalMarks: k.totalMarks, issues: [...issues, ...paperIssues], notCheckable };
}
