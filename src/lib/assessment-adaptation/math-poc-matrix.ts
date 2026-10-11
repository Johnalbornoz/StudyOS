/**
 * EA-1 -- the mathematics proof of concept: every family adapted into every profile (pure, deterministic, no IO).
 *
 * The question it answers: CAN THE SAME MATHEMATICAL EVIDENCE TARGET BE PRESERVED WHILE PRODUCING MATERIALLY
 * DIFFERENT SPECIFICATIONS FOR DIFFERENT ASSESSMENT SYSTEMS? For each of the ten draft families and each target
 * the engine is asked once, with one neutral request (dev-test practice, standard band, nothing else fixed), and
 * answers with a specification or a named refusal. For every family that reaches two or more targets the output
 * then sets side by side what stayed identical (the invariants, by hash) and what differs.
 *
 * WHAT IT DOES NOT SHOW. No question was generated: a specification is an input to generation, and whether a
 * model -- or a person -- writes a good PAA item and a good IB item from two specifications of one family is not
 * tested here. The profiles are illustrative and the families are unreviewed drafts; the matrix measures the
 * architecture, not the quality of either.
 *
 * TARGETS (D2). Each family is adapted into the six COMPONENT profiles (where component-specific behaviour is
 * settled) and into the five SYSTEM profiles alone (generic practice; refused with COMPONENT_REQUIRED wherever the
 * family needs something component-specific).
 *
 * `MINIMUM_PAIRWISE_DIFFERENCE` is the number of compared dimensions (of twelve) in which any two specifications of
 * one family for two DIFFERENT systems must differ. It is 3, the smallest value the matrix actually shows, and it
 * is honest rather than flattering: two systems that both ask closed, calculator-free, key-scored questions (PAA
 * and Icfes here) differ only in their context requirements, their competency model and their published pace, and
 * the two constructed-response systems (IB and Cambridge) can be as close. Two components of ONE system share its
 * common rules and differ less (IB Paper 1 and Paper 2: tool policy and numeric profile); that floor is stated
 * apart. The test asserts those floors, not higher ones.
 */
import { MATH_POC_FAMILIES, MATH_POC_PROFILE_IDS, type MathPocProfileId } from '@/lib/exam-core/question-bank/task-families/math-poc-families';
import { MATH_PROBLEM_SPECIALIZATION, type MathTaskFamily } from '@/lib/exam-core/question-bank/task-families/math-problem';
import { adapt, invariantsOfFamily } from './adapt';
import { ADAPTATION_ENGINE, invariantHashOf, type AdaptationRequest, type AdaptationSpecification } from './adaptation-specification';
import { EA1_APPLICABILITY_THRESHOLD, resolveApplicability, type AssessmentApplicabilityRecord } from './assessment-applicability';
import { authorityBreakdown, resolveProfile, type AssessmentComponentProfile, type AssessmentSystemProfile } from './assessment-system-profile';
import { canonicalJson } from './canonical-hash';
import { MATHEMATICS_ADAPTATION_POLICY, type VariableDimension } from './discipline-policy';
import { MATH_POC_APPLICABILITY } from './math-poc-applicability';
import { EA1_COMPONENT_PROFILES, EA1_SYSTEM_PROFILES } from './system-profiles';

export const MATH_POC_MATRIX_VERSION = 2 as const;
export const MATH_POC_MATRIX_ARTIFACT = 'docs/exams/assessment-adaptation/EA1_math_adaptation_matrix.json' as const;
/**
 * The one request every attempt is made with. Purpose, band, language and use class are fixed; the engine decides
 * the rest. The use class is DEV_TEST_CONTENT because it has to be: every family is a DRAFT, and a draft family may
 * produce nothing else. The matrix also records what the same attempts answer when EVIDENCE_BEARING content is asked.
 */
export const MATH_POC_REQUEST = { purpose: 'PRACTICE', difficultyBand: 'STANDARD', contentUseClass: 'DEV_TEST_CONTENT' } as const;
/** The language of the repository's reference configuration of each system. A property of the request, not of a profile, and not counted as a difference. */
export const MATH_POC_LANGUAGE: Record<MathPocProfileId, string> = { PAA: 'es', IB: 'en', CAMBRIDGE: 'en', PISA: 'es', ICFES: 'es' };
/** The dimensions two specifications of one family are compared on. `difficulty` and `language` come from the request and `difficultyLevers` follows from context and stimulus, so none of the three is counted. */
export const COMPARED_DIMENSIONS = ['context', 'responseFormat', 'reasoningDepth', 'commandTerm', 'stimulus', 'competencies', 'timeBudget', 'markStructure', 'rubricStyle', 'toolPolicy', 'numericProfile', 'distractors'] as const satisfies readonly VariableDimension[];
export type ComparedDimension = (typeof COMPARED_DIMENSIONS)[number];
/** Two specifications of one family for two DIFFERENT systems differ in at least this many compared dimensions. The measured minimum. */
export const MINIMUM_PAIRWISE_DIFFERENCE = 3 as const;
/** Two components of ONE system differ in at least this many: they share the system's common rules, so the floor is lower and is stated apart. */
export const MINIMUM_SAME_SYSTEM_DIFFERENCE = 2 as const;

export type MatrixLevel = 'COMPONENT' | 'SYSTEM';
export interface MatrixCell {
  level: MatrixLevel;
  familyId: string;
  /** The component id at component level, the system profile id at system level. */
  targetId: string;
  systemProfileId: string;
  componentId: string | null;
  /** The family's declared behaviour fit for the SYSTEM. */
  declaredSupport: 'SUPPORTED' | 'SUPPORTED_WITH_CONSTRAINTS' | 'UNSUPPORTED' | 'NOT_DECLARED';
  /** Assessment applicability of the family's concept for the target. Independent of the outcome. */
  applicability: { status: string; basis: string };
  outcome: 'SPECIFICATION' | 'REFUSED';
  specificationId: string | null;
  invariantHash: string | null;
  refusal: { code: string; detail: string } | null;
}

export interface FidelityComparison {
  familyId: string;
  invariant: { primaryConceptStableIds: string[]; canonicalSubject: string; construct: string; evidenceActions: string[]; invariantHash: string; identicalAcrossTargets: boolean };
  targets: string[];
  variableByTarget: Record<string, Record<ComparedDimension, unknown>>;
  pairwise: Array<{ a: string; b: string; sameSystem: boolean; differing: ComparedDimension[] }>;
  minimumCrossSystemDifference: number | null;
}

interface LevelSummary { attempts: number; specifications: number; refusals: number; declaredSupport: Record<string, number>; refusalCodes: Record<string, number>; specificationsByTarget: Record<string, number> }
export interface MathAdaptationMatrix {
  kind: 'EA1_MATH_ADAPTATION_MATRIX';
  v: typeof MATH_POC_MATRIX_VERSION;
  about: string;
  engine: { id: string; version: string };
  disciplinePolicy: { policyId: string; version: string; status: string };
  applicabilityThreshold: { policyId: string; version: string };
  request: typeof MATH_POC_REQUEST & { languageBySystem: Record<string, string> };
  systemProfiles: Array<{ profileId: string; version: string; status: string; basis: string; examFamilyCode: string | null; componentDependentDimensions: string[]; officialRules: string[] }>;
  componentProfiles: Array<{ componentId: string; systemProfileId: string; version: string; status: string; localSubject: string | null; overrides: string[]; officialRulesInForce: string[]; studyusPolicyRulesInForce: string[] }>;
  families: Array<{ familyId: string; version: string; lifecycle: string; reviewStatus: string; primaryConceptStableId: string; canonicalSubject: string; canonicalName: string; evidenceActions: string[]; construct: string; calculatorDependency: string; invariantHash: string }>;
  cells: MatrixCell[];
  summary: {
    componentLevel: LevelSummary;
    systemLevel: LevelSummary;
    /** Of the component-level specifications: on what the concept's applicability for the target rests. */
    applicabilityOfComponentSpecifications: { byBasis: Record<string, number>; byStatus: Record<string, number> };
    /** The same component-level attempts when EVIDENCE_BEARING content is asked. Every family is a draft, so every one is refused. */
    evidenceBearingAttempts: { attempts: number; specifications: number; refusalCodes: Record<string, number> };
    familiesReachingSeveralSystems: number;
    minimumCrossSystemDifference: number | null;
    minimumSameSystemDifference: number | null;
    crossSystemDifferenceDistribution: Record<string, number>;
    invariantHashIdenticalWithinEveryFamily: boolean;
  };
  fidelity: FidelityComparison[];
}

const sortedCounts = (values: readonly string[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const v of [...values].sort()) out[v] = (out[v] ?? 0) + 1;
  return out;
};

export interface MathPocInput { families?: readonly MathTaskFamily[]; systems?: readonly AssessmentSystemProfile[]; components?: readonly AssessmentComponentProfile[]; applicability?: readonly AssessmentApplicabilityRecord[] }
interface Target { level: MatrixLevel; system: AssessmentSystemProfile; component: AssessmentComponentProfile | null; targetId: string }

function targetsOf(input: MathPocInput): Target[] {
  const systems = input.systems ?? EA1_SYSTEM_PROFILES;
  const components = input.components ?? EA1_COMPONENT_PROFILES;
  // components in the order of their systems, then every system on its own
  return [
    ...systems.flatMap((system) => components.filter((c) => c.systemProfileId === system.profileId).map((component) => ({ level: 'COMPONENT' as const, system, component, targetId: component.componentId }))),
    ...systems.map((system) => ({ level: 'SYSTEM' as const, system, component: null, targetId: system.profileId })),
  ];
}

/** Every attempt of the proof of concept, and the specifications produced, keyed `<familyId>|<targetId>`. */
export function buildMathPocSpecifications(input: MathPocInput = {}, requestOverride: Partial<AdaptationRequest> = {}): { specifications: Map<string, AdaptationSpecification>; cells: MatrixCell[] } {
  const families = input.families ?? MATH_POC_FAMILIES;
  const applicability = input.applicability ?? MATH_POC_APPLICABILITY;
  const specifications = new Map<string, AdaptationSpecification>();
  const cells: MatrixCell[] = [];
  for (const t of targetsOf(input)) {
    for (const family of families) {
      const request: AdaptationRequest = { ...MATH_POC_REQUEST, language: MATH_POC_LANGUAGE[t.system.profileId as MathPocProfileId] ?? 'en', ...requestOverride };
      const result = adapt({ family, profile: t.system, component: t.component ?? undefined, applicability, disciplinePolicy: MATHEMATICS_ADAPTATION_POLICY, request });
      const a = resolveApplicability(applicability, family.primaryConcepts[0], { systemProfileId: t.system.profileId, componentId: t.component?.componentId ?? null }, EA1_APPLICABILITY_THRESHOLD);
      const base = { level: t.level, familyId: family.familyId, targetId: t.targetId, systemProfileId: t.system.profileId, componentId: t.component?.componentId ?? null, declaredSupport: family.profileSupport[t.system.profileId]?.status ?? ('NOT_DECLARED' as const), applicability: { status: a.status, basis: a.basis } };
      if (result.ok) {
        specifications.set(`${family.familyId}|${t.targetId}`, result.specification);
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

const levelSummary = (cells: readonly MatrixCell[], targets: readonly Target[]): LevelSummary => {
  const produced = cells.filter((c) => c.outcome === 'SPECIFICATION');
  return {
    attempts: cells.length, specifications: produced.length, refusals: cells.length - produced.length,
    declaredSupport: sortedCounts(cells.map((c) => c.declaredSupport)),
    refusalCodes: sortedCounts(cells.flatMap((c) => (c.refusal ? [c.refusal.code] : []))),
    specificationsByTarget: Object.fromEntries(targets.map((t) => [t.targetId, produced.filter((c) => c.targetId === t.targetId).length])),
  };
};

export function buildMathAdaptationMatrix(input: MathPocInput = {}): MathAdaptationMatrix {
  const families = input.families ?? MATH_POC_FAMILIES;
  const systems = input.systems ?? EA1_SYSTEM_PROFILES;
  const components = input.components ?? EA1_COMPONENT_PROFILES;
  const targets = targetsOf(input);
  const componentTargets = targets.filter((t) => t.level === 'COMPONENT');
  const { specifications, cells } = buildMathPocSpecifications(input);
  const componentCells = cells.filter((c) => c.level === 'COMPONENT');
  const evidenceBearing = buildMathPocSpecifications(input, { contentUseClass: 'EVIDENCE_BEARING' }).cells.filter((c) => c.level === 'COMPONENT');
  const fidelity: FidelityComparison[] = families.map((family) => {
    const own = componentTargets.map((t) => ({ t, spec: specifications.get(`${family.familyId}|${t.targetId}`) })).filter((x): x is { t: Target; spec: AdaptationSpecification } => x.spec !== undefined);
    const invariants = JSON.parse(JSON.stringify(invariantsOfFamily(family, MATH_PROBLEM_SPECIALIZATION as never)));
    const hash = invariantHashOf(invariants);
    const pairwise = own.flatMap((x, i) => own.slice(i + 1).map((y) => ({ a: x.t.targetId, b: y.t.targetId, sameSystem: x.t.system.profileId === y.t.system.profileId, differing: differingDimensions(x.spec, y.spec) })));
    const cross = pairwise.filter((p) => !p.sameSystem);
    return {
      familyId: family.familyId,
      invariant: { primaryConceptStableIds: invariants.primaryConceptStableIds, canonicalSubject: invariants.canonicalSubject, construct: family.specialization.mathematicalStructure.construct, evidenceActions: [...family.evidenceTarget.actions], invariantHash: hash, identicalAcrossTargets: own.every((x) => x.spec.invariantHash === hash) },
      targets: own.map((x) => x.t.targetId),
      variableByTarget: Object.fromEntries(own.map((x) => [x.t.targetId, Object.fromEntries(COMPARED_DIMENSIONS.map((d) => [d, x.spec.variable[d]])) as Record<ComparedDimension, unknown>])),
      pairwise,
      minimumCrossSystemDifference: cross.length === 0 ? null : Math.min(...cross.map((p) => p.differing.length)),
    };
  });
  const produced = componentCells.filter((c) => c.outcome === 'SPECIFICATION');
  const allPairs = fidelity.flatMap((f) => f.pairwise);
  const cross = allPairs.filter((p) => !p.sameSystem);
  const same = allPairs.filter((p) => p.sameSystem);
  return {
    kind: 'EA1_MATH_ADAPTATION_MATRIX',
    v: MATH_POC_MATRIX_VERSION,
    about: 'EA-1 mathematics proof of concept. Ten DRAFT, UNREVIEWED assessment task families adapted into six component profiles of five PROVISIONAL, ILLUSTRATIVE, MIXED-AUTHORITY assessment-system profiles (and into the five system profiles alone, as generic practice) under a PROVISIONAL discipline policy. DEV_TEST_CONTENT specifications only: a draft family may produce nothing else, and no question was generated. Assessment applicability is read from the repository and never inferred. Nothing here is reviewed, certified or approved.',
    engine: { ...ADAPTATION_ENGINE },
    disciplinePolicy: { policyId: MATHEMATICS_ADAPTATION_POLICY.policyId, version: MATHEMATICS_ADAPTATION_POLICY.version, status: MATHEMATICS_ADAPTATION_POLICY.status },
    applicabilityThreshold: { policyId: EA1_APPLICABILITY_THRESHOLD.policyId, version: EA1_APPLICABILITY_THRESHOLD.version },
    request: { ...MATH_POC_REQUEST, languageBySystem: Object.fromEntries(systems.map((p) => [p.profileId, MATH_POC_LANGUAGE[p.profileId as MathPocProfileId] ?? 'en'])) },
    systemProfiles: systems.map((p) => ({ profileId: p.profileId, version: p.version, status: p.status, basis: p.specification.basis, examFamilyCode: p.examFamilyCode, componentDependentDimensions: [...p.componentDependentDimensions], officialRules: authorityBreakdown(p).official })),
    componentProfiles: components.map((c) => {
      const r = resolveProfile(systems.find((s) => s.profileId === c.systemProfileId), c);
      if (!r.ok) throw new Error(`POC_COMPONENT_DOES_NOT_RESOLVE: ${c.componentId}: ${r.issue}`);
      return { componentId: c.componentId, systemProfileId: c.systemProfileId, version: c.version, status: c.status, localSubject: c.localSubject, overrides: Object.keys(c.overrides), officialRulesInForce: authorityBreakdown(r.resolved).official, studyusPolicyRulesInForce: authorityBreakdown(r.resolved).studyusPolicy };
    }),
    families: families.map((f, i) => ({ familyId: f.familyId, version: f.version, lifecycle: f.lifecycle, reviewStatus: f.reviewStatus, primaryConceptStableId: f.primaryConcepts[0].stableId, canonicalSubject: f.canonicalSubject, canonicalName: f.primaryConcepts[0].canonicalName, evidenceActions: [...f.evidenceTarget.actions], construct: f.specialization.mathematicalStructure.construct, calculatorDependency: f.specialization.calculatorDependency, invariantHash: fidelity[i].invariant.invariantHash })),
    cells,
    summary: {
      componentLevel: levelSummary(componentCells, componentTargets),
      systemLevel: levelSummary(cells.filter((c) => c.level === 'SYSTEM'), targets.filter((t) => t.level === 'SYSTEM')),
      applicabilityOfComponentSpecifications: { byBasis: sortedCounts(produced.map((c) => c.applicability.basis)), byStatus: sortedCounts(produced.map((c) => c.applicability.status)) },
      evidenceBearingAttempts: { attempts: evidenceBearing.length, specifications: evidenceBearing.filter((c) => c.outcome === 'SPECIFICATION').length, refusalCodes: sortedCounts(evidenceBearing.flatMap((c) => (c.refusal ? [c.refusal.code] : []))) },
      familiesReachingSeveralSystems: fidelity.filter((f) => new Set(f.targets.map((t) => t.split('.')[0])).size >= 2).length,
      minimumCrossSystemDifference: cross.length === 0 ? null : Math.min(...cross.map((p) => p.differing.length)),
      minimumSameSystemDifference: same.length === 0 ? null : Math.min(...same.map((p) => p.differing.length)),
      crossSystemDifferenceDistribution: sortedCounts(cross.map((p) => `differ-in-${String(p.differing.length).padStart(2, '0')}`)),
      invariantHashIdenticalWithinEveryFamily: fidelity.every((f) => f.invariant.identicalAcrossTargets),
    },
    fidelity,
  };
}

/** The artifact's text: two-space JSON with a final newline, as the pilot artifacts are written. */
export const serializeMathAdaptationMatrix = (m: MathAdaptationMatrix): string => `${JSON.stringify(m, null, 2)}\n`;
export { MATH_POC_PROFILE_IDS };
