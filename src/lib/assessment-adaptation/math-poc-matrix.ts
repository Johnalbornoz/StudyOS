/**
 * EA-1 -- the mathematics proof of concept: every family adapted into every profile (pure, deterministic, no IO).
 *
 * The question it answers: CAN THE SAME MATHEMATICAL EVIDENCE TARGET BE PRESERVED WHILE PRODUCING MATERIALLY
 * DIFFERENT SPECIFICATIONS FOR DIFFERENT ASSESSMENT SYSTEMS? For each of the ten draft families and each of the
 * five illustrative profiles the engine is asked once, with one neutral request (practice, standard band, nothing
 * else fixed), and answers with a specification or a named refusal. For every family that reaches two or more
 * systems the output then sets side by side what stayed identical (the invariants, by hash) and what differs.
 *
 * WHAT IT DOES NOT SHOW. No question was generated: a specification is an input to generation, and whether a
 * model -- or a person -- writes a good PAA item and a good IB item from two specifications of one family is not
 * tested here. The profiles are illustrative and the families are unreviewed drafts; the matrix measures the
 * architecture, not the quality of either.
 *
 * `MINIMUM_PAIRWISE_DIFFERENCE` is the number of compared dimensions (of twelve) in which any two specifications of
 * one family must differ. It is 3, the smallest value the matrix actually shows, and it is honest rather than
 * flattering: two systems that both ask closed, calculator-free, key-scored questions (PAA and Icfes here) differ
 * only in their context requirements, their competency model and their published pace, and the two
 * constructed-response systems (IB and Cambridge) can be as close. The test asserts that floor, not a higher one.
 */
import { MATH_POC_FAMILIES, MATH_POC_PROFILE_IDS, type MathPocProfileId } from '@/lib/exam-core/question-bank/task-families/math-poc-families';
import { MATH_PROBLEM_SPECIALIZATION, type MathTaskFamily } from '@/lib/exam-core/question-bank/task-families/math-problem';
import { adapt, invariantsOfFamily } from './adapt';
import { ADAPTATION_ENGINE, invariantHashOf, type AdaptationRequest, type AdaptationSpecification } from './adaptation-specification';
import { authorityBreakdown, type AssessmentSystemProfile } from './assessment-system-profile';
import { canonicalJson } from './canonical-hash';
import { MATHEMATICS_ADAPTATION_POLICY, type VariableDimension } from './discipline-policy';
import { EA1_SYSTEM_PROFILES } from './system-profiles';

export const MATH_POC_MATRIX_VERSION = 1 as const;
export const MATH_POC_MATRIX_ARTIFACT = 'docs/exams/assessment-adaptation/EA1_math_adaptation_matrix.json' as const;
/** The one request every attempt is made with. Only purpose, band and language are fixed; the engine decides the rest. */
export const MATH_POC_REQUEST = { purpose: 'PRACTICE', difficultyBand: 'STANDARD' } as const;
/** The language of the repository's reference configuration of each system. A property of the request, not of a profile, and not counted as a difference. */
export const MATH_POC_LANGUAGE: Record<MathPocProfileId, string> = { PAA: 'es', IB: 'en', CAMBRIDGE: 'en', PISA: 'es', ICFES: 'es' };
/** The dimensions two specifications of one family are compared on. `difficulty` and `language` come from the request and `difficultyLevers` follows from context and stimulus, so none of the three is counted. */
export const COMPARED_DIMENSIONS = ['context', 'responseFormat', 'reasoningDepth', 'commandTerm', 'stimulus', 'competencies', 'timeBudget', 'markStructure', 'rubricStyle', 'toolPolicy', 'numericProfile', 'distractors'] as const satisfies readonly VariableDimension[];
export type ComparedDimension = (typeof COMPARED_DIMENSIONS)[number];
export const MINIMUM_PAIRWISE_DIFFERENCE = 3 as const;

export interface MatrixCell {
  familyId: string;
  profileId: string;
  declaredSupport: 'SUPPORTED' | 'SUPPORTED_WITH_CONSTRAINTS' | 'UNSUPPORTED' | 'NOT_DECLARED';
  /** Whether the repository records the family's concept for the profile's exam family. Independent of the outcome. */
  canonicalKnowledgeAvailability: string;
  outcome: 'SPECIFICATION' | 'REFUSED';
  specificationId: string | null;
  invariantHash: string | null;
  refusal: { code: string; detail: string } | null;
}

export interface FidelityComparison {
  familyId: string;
  invariant: { primaryConceptStableIds: string[]; canonicalSubject: string; construct: string; evidenceActions: string[]; invariantHash: string; identicalAcrossProfiles: boolean };
  profiles: string[];
  variableByProfile: Record<string, Record<ComparedDimension, unknown>>;
  pairwise: Array<{ a: string; b: string; differing: ComparedDimension[] }>;
  minimumPairwiseDifference: number | null;
}

export interface MathAdaptationMatrix {
  kind: 'EA1_MATH_ADAPTATION_MATRIX';
  v: typeof MATH_POC_MATRIX_VERSION;
  about: string;
  engine: { id: string; version: string };
  disciplinePolicy: { policyId: string; version: string; status: string };
  request: typeof MATH_POC_REQUEST & { languageByProfile: Record<string, string> };
  profiles: Array<{ profileId: string; version: string; status: string; examFamilyCode: string | null; officialRules: string[]; studyusPolicyRules: string[] }>;
  families: Array<{ familyId: string; version: string; lifecycle: string; reviewStatus: string; primaryConceptStableId: string; canonicalSubject: string; canonicalName: string; evidenceActions: string[]; construct: string; calculatorDependency: string; invariantHash: string }>;
  cells: MatrixCell[];
  summary: {
    attempts: number; specifications: number; refusals: number;
    declaredSupport: Record<string, number>;
    refusalCodes: Record<string, number>;
    specificationsByProfile: Record<string, number>;
    /** Of the specifications produced, how many have the concept recorded for the profile's exam family, and how firmly. */
    knowledgeAvailabilityOfSpecifications: Record<string, number>;
    /** How many specifications would remain if production's knowledge requirement were applied. */
    specificationsIfKnowledgeRequired: { CATALOGUE_LINK_OR_CERTIFIED: number; CERTIFIED: number };
    familiesReachingSeveralProfiles: number;
    minimumPairwiseDifference: number | null;
    pairwiseDifferenceDistribution: Record<string, number>;
    invariantHashIdenticalWithinEveryFamily: boolean;
  };
  fidelity: FidelityComparison[];
}

const sortedCounts = (values: readonly string[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const v of [...values].sort()) out[v] = (out[v] ?? 0) + 1;
  return out;
};

export interface MathPocInput { families?: readonly MathTaskFamily[]; profiles?: readonly AssessmentSystemProfile[] }

/** Every specification the proof of concept produces, keyed `<familyId>|<profileId>`. */
export function buildMathPocSpecifications(input: MathPocInput = {}): { specifications: Map<string, AdaptationSpecification>; cells: MatrixCell[] } {
  const families = input.families ?? MATH_POC_FAMILIES;
  const profiles = input.profiles ?? EA1_SYSTEM_PROFILES;
  const specifications = new Map<string, AdaptationSpecification>();
  const cells: MatrixCell[] = [];
  for (const family of families) {
    for (const profile of profiles) {
      const request: AdaptationRequest = { ...MATH_POC_REQUEST, language: MATH_POC_LANGUAGE[profile.profileId as MathPocProfileId] ?? 'en' };
      const result = adapt({ family, profile, disciplinePolicy: MATHEMATICS_ADAPTATION_POLICY, request });
      const base = { familyId: family.familyId, profileId: profile.profileId, declaredSupport: family.profileSupport[profile.profileId]?.status ?? ('NOT_DECLARED' as const), canonicalKnowledgeAvailability: family.canonicalKnowledgeAvailability[profile.profileId]?.status ?? 'NOT_CERTIFIED_FOR_THIS_EXAM_FAMILY' };
      if (result.ok) {
        specifications.set(`${family.familyId}|${profile.profileId}`, result.specification);
        cells.push({ ...base, outcome: 'SPECIFICATION', specificationId: result.specification.specificationId, invariantHash: result.specification.invariantHash, refusal: null });
      } else cells.push({ ...base, outcome: 'REFUSED', specificationId: null, invariantHash: null, refusal: result.refusal });
    }
  }
  return { specifications, cells };
}

/** The dimensions in which two specifications differ, by value (canonical JSON), among the compared ones. */
export function differingDimensions(a: AdaptationSpecification, b: AdaptationSpecification): ComparedDimension[] {
  return COMPARED_DIMENSIONS.filter((d) => canonicalJson(a.variable[d]) !== canonicalJson(b.variable[d]));
}

export function buildMathAdaptationMatrix(input: MathPocInput = {}): MathAdaptationMatrix {
  const families = input.families ?? MATH_POC_FAMILIES;
  const profiles = input.profiles ?? EA1_SYSTEM_PROFILES;
  const { specifications, cells } = buildMathPocSpecifications({ families, profiles });
  const fidelity: FidelityComparison[] = families.map((family) => {
    const own = profiles.map((p) => ({ profileId: p.profileId, spec: specifications.get(`${family.familyId}|${p.profileId}`) })).filter((x): x is { profileId: string; spec: AdaptationSpecification } => x.spec !== undefined);
    const invariants = JSON.parse(JSON.stringify(invariantsOfFamily(family, MATH_PROBLEM_SPECIALIZATION as never)));
    const hash = invariantHashOf(invariants);
    const pairwise = own.flatMap((x, i) => own.slice(i + 1).map((y) => ({ a: x.profileId, b: y.profileId, differing: differingDimensions(x.spec, y.spec) })));
    return {
      familyId: family.familyId,
      invariant: { primaryConceptStableIds: invariants.primaryConceptStableIds, canonicalSubject: invariants.canonicalSubject, construct: family.specialization.mathematicalStructure.construct, evidenceActions: [...family.evidenceTarget.actions], invariantHash: hash, identicalAcrossProfiles: own.every((x) => x.spec.invariantHash === hash) },
      profiles: own.map((x) => x.profileId),
      variableByProfile: Object.fromEntries(own.map((x) => [x.profileId, Object.fromEntries(COMPARED_DIMENSIONS.map((d) => [d, x.spec.variable[d]])) as Record<ComparedDimension, unknown>])),
      pairwise,
      minimumPairwiseDifference: pairwise.length === 0 ? null : Math.min(...pairwise.map((p) => p.differing.length)),
    };
  });
  const produced = cells.filter((c) => c.outcome === 'SPECIFICATION');
  const allPairs = fidelity.flatMap((f) => f.pairwise);
  return {
    kind: 'EA1_MATH_ADAPTATION_MATRIX',
    v: MATH_POC_MATRIX_VERSION,
    about: 'EA-1 mathematics proof of concept. Ten DRAFT, UNREVIEWED task families adapted into five PROVISIONAL, ILLUSTRATIVE assessment-system profiles under a PROVISIONAL discipline policy. Specifications only: no question was generated. Nothing here is reviewed, certified or approved.',
    engine: { ...ADAPTATION_ENGINE },
    disciplinePolicy: { policyId: MATHEMATICS_ADAPTATION_POLICY.policyId, version: MATHEMATICS_ADAPTATION_POLICY.version, status: MATHEMATICS_ADAPTATION_POLICY.status },
    request: { ...MATH_POC_REQUEST, languageByProfile: Object.fromEntries(profiles.map((p) => [p.profileId, MATH_POC_LANGUAGE[p.profileId as MathPocProfileId] ?? 'en'])) },
    profiles: profiles.map((p) => ({ profileId: p.profileId, version: p.version, status: p.status, examFamilyCode: p.examFamilyCode, officialRules: authorityBreakdown(p).official, studyusPolicyRules: authorityBreakdown(p).studyusPolicy })),
    families: families.map((f, i) => ({ familyId: f.familyId, version: f.version, lifecycle: f.lifecycle, reviewStatus: f.reviewStatus, primaryConceptStableId: f.primaryConcepts[0].stableId, canonicalSubject: f.canonicalSubject, canonicalName: f.primaryConcepts[0].canonicalName, evidenceActions: [...f.evidenceTarget.actions], construct: f.specialization.mathematicalStructure.construct, calculatorDependency: f.specialization.calculatorDependency, invariantHash: fidelity[i].invariant.invariantHash })),
    cells,
    summary: {
      attempts: cells.length, specifications: produced.length, refusals: cells.length - produced.length,
      declaredSupport: sortedCounts(cells.map((c) => c.declaredSupport)),
      refusalCodes: sortedCounts(cells.flatMap((c) => (c.refusal ? [c.refusal.code] : []))),
      specificationsByProfile: Object.fromEntries(profiles.map((p) => [p.profileId, produced.filter((c) => c.profileId === p.profileId).length])),
      knowledgeAvailabilityOfSpecifications: sortedCounts(produced.map((c) => c.canonicalKnowledgeAvailability)),
      specificationsIfKnowledgeRequired: { CATALOGUE_LINK_OR_CERTIFIED: produced.filter((c) => c.canonicalKnowledgeAvailability !== 'NOT_CERTIFIED_FOR_THIS_EXAM_FAMILY').length, CERTIFIED: produced.filter((c) => c.canonicalKnowledgeAvailability === 'CERTIFIED_FOR_THIS_EXAM_FAMILY').length },
      familiesReachingSeveralProfiles: fidelity.filter((f) => f.profiles.length >= 2).length,
      minimumPairwiseDifference: allPairs.length === 0 ? null : Math.min(...allPairs.map((p) => p.differing.length)),
      pairwiseDifferenceDistribution: sortedCounts(allPairs.map((p) => `differ-in-${String(p.differing.length).padStart(2, '0')}`)),
      invariantHashIdenticalWithinEveryFamily: fidelity.every((f) => f.invariant.identicalAcrossProfiles),
    },
    fidelity,
  };
}

/** The artifact's text: two-space JSON with a final newline, as the pilot artifacts are written. */
export const serializeMathAdaptationMatrix = (m: MathAdaptationMatrix): string => `${JSON.stringify(m, null, 2)}\n`;
export { MATH_POC_PROFILE_IDS };
