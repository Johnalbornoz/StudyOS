/**
 * QF V5.1 / STEP 4B -- the first real content slice, as CANDIDATES FOR HUMAN CERTIFICATION (data + pure functions).
 *
 * NOTHING HERE IS CERTIFIED. Every object below is a proposal prepared for the reviewer: the two construct cores
 * are IN_REVIEW, the adapters are the PROVISIONAL ones the registry holds, the renderers are PROVISIONAL, the
 * blueprint classes and the item difficulties are PROPOSED. No certification record exists in this file or
 * anywhere else, so `preparePilotInstances()` reports every instance NOT certified, with the reasons.
 *
 * Slice: Mathematics, PAA Matemáticas + IB Mathematics AA HL Paper 1.
 *   core A  tf.math.quadratic.solve-rational-roots   (math.alg.quadratics)        PAA + IB  -> cross-model reuse
 *           METHOD-NEUTRAL: solve the equation; factorising is a supported strategy, never a required method
 *   core B  tf.math.proportion.missing-value         (math.num.ratio-proportion)  PAA
 *
 * The draft tf.math.quadratic.solve-by-factorising is NOT in this slice: an answer-only response cannot show that
 * factorising was the method, so that construct is not certifiable for PAA numeric entry. The draft stays in the
 * task-family registry, untouched, for a manifestation whose working is observed.
 */
import { sha256OfCanonicalJson } from '@/lib/assessment-adaptation/canonical-hash';
import { MATHEMATICS_ADAPTATION_POLICY } from '@/lib/assessment-adaptation/discipline-policy';
import { MATH_POC_APPLICABILITY } from '@/lib/assessment-adaptation/math-poc-applicability';
import { bandOf, type DifficultyBand } from '@/lib/exam-core/question-bank/quality';
import { mathPocFamilyOf } from '@/lib/exam-core/question-bank/task-families/math-poc-families';
import { mathPocFamilyEa1aOf } from '@/lib/exam-core/question-bank/task-families/math-poc-families-ea1a';
import type { TaskDifficultyBand } from '@/lib/exam-core/question-bank/task-families/task-family';
import { composeAssessmentSpecification, type BlueprintBucketRef } from '../assessment-specification';
import { classifyBlueprintSection, type BlueprintClass, type BlueprintSectionFacts } from '../blueprint-classification';
import { certificationStateOf, instanceCertificationOf, type CertifiableObject, type InstanceCertification, type ReviewerQualification, type ReviewerScope } from '../certification';
import { constructCoreOf, type ConstructCoreRecord, type ShortcutConstraint } from '../construct-core';
import { deriveCoreApplicability, type CoreApplicabilityRecord } from '../core-applicability';
import { STUDYUS_ASSESSMENT_REGISTRY } from '../registered-systems';
import { createAssessmentInstanceRenderer, unrenderableRepresentations, type RenderedInstance, type RenderingStrategy } from '../renderer';
import { certifiedInstanceLineageOf, certifiedLineageIntact, envelopeHashOf, instanceContentHashOf, instanceEnvelopeIssues, RendererEnvelopeSchema, type BandConformance, type CertifiedInstanceLineage, type RendererEnvelope } from '../renderer-envelope';
import { PROPORTION_MISSING_VALUE_CONSTRUCT, PROPORTION_MISSING_VALUE_RENDERER_VERSION, PROPORTION_MISSING_VALUE_STRATEGY, proportionBandIssues, type ProportionParameters } from '../strategy-proportion-missing-value';
import { QUADRATIC_SOLVE_CONSTRUCT, QUADRATIC_SOLVE_RENDERER_VERSION, QUADRATIC_SOLVE_STRATEGY, QUADRATIC_SUPPORTED_REASONING_STRATEGIES, quadraticSolveBandIssues } from '../strategy-quadratic-solve';

export const PILOT_ID = 'step4b-pilot-1' as const;
/**
 * The version under which each core is submitted for review. A change to a core's contract is a new version, a
 * new content hash, and a new decision: nothing reviewed under an earlier version carries over.
 *   quadratic  rc.1  a new identity (method-neutral), first submitted here
 *   proportion rc.2  rc.1 worded its hardest steps setting as "two proportions applied in turn", which no renderer
 *                    implements; rc.2 states the mechanism the renderer guarantees. rc.1 is withdrawn.
 */
export const PILOT_QUADRATIC_CORE_VERSION = '1.0.0-rc.1' as const;
export const PILOT_PROPORTION_CORE_VERSION = '1.0.0-rc.2' as const;
export const WITHDRAWN_CORE_VERSIONS: readonly { constructFamilyId: string; version: string; reason: string }[] = [
  { constructFamilyId: 'tf.math.proportion.missing-value', version: '1.0.0-rc.1', reason: 'Its CHALLENGE steps setting ("two proportions applied in turn") is not what any renderer implements.' },
  { constructFamilyId: 'tf.math.quadratic.solve-by-factorising', version: '1.0.0-rc.1', reason: 'Rejected for PAA numeric entry: an answer-only response does not show that factorising was the method.' },
];
export const PILOT_PAA = 'PAA.MATEMATICAS' as const;
export const PILOT_IB = 'IB.MATH_AA_HL.P1' as const;
export const PILOT_BANDS: readonly TaskDifficultyBand[] = ['FOUNDATIONAL', 'STANDARD', 'CHALLENGE'];

/** The pilot certification authority and the scopes proposed for it. A proposal: no grant exists in any database. */
export const PILOT_REVIEWER_ID = 'INTERNAL_PILOT_REVIEWER' as const;
/** Mathematics and Matemáticas are two canonical subjects. The third scope exists so that the proportion core can be reviewed; it merges nothing. */
export const PILOT_REVIEWER_SCOPES: readonly ReviewerScope[] = [{ canonicalSubject: 'Mathematics', systemId: 'PAA' }, { canonicalSubject: 'Mathematics', systemId: 'IB' }, { canonicalSubject: 'Matemáticas', systemId: 'PAA' }];

// ------------------------------------------------------------------------------------------------- cores
const QUADRATIC_ID = 'tf.math.quadratic.solve-rational-roots';
const QUADRATIC_SOURCE_DRAFT_ID = 'tf.math.quadratic.solve-by-factorising';
const PROPORTION_ID = 'tf.math.proportion.missing-value';
const REVISED_AT = '2026-10-12T00:00:00Z';

export const QUADRATIC_SHORTCUTS: readonly ShortcutConstraint[] = [
  { id: 'substitute-the-options', bypass: 'With options to choose from, each option can be substituted into the equation and checked, so the equation is verified and never solved.', excludedFormats: ['SELECTED_RESPONSE', 'MULTI_SELECT'], instanceRule: 'A numeric response asks for one stated root (the greater), so the response has one value and no candidate value is offered.' },
  { id: 'equation-solver', bypass: 'A calculator with an equation solver returns both roots without the learner solving anything.', excludedFormats: [], instanceRule: 'Instances of the certified envelope are rendered only under its adapters, and each of them allows no calculator.' },
];
export const PROPORTION_SHORTCUTS: readonly ShortcutConstraint[] = [
  { id: 'stated-unit-rate', bypass: 'If the situation states the value for one unit, the answer is a single multiplication and no proportion is set up.', excludedFormats: [], instanceRule: 'The first quantity of the given pair is never 1, and no unit rate is stated in the situation.' },
  { id: 'additive-coincidence', bypass: 'When adding the difference between the known values happens to give the proportional answer, a learner reasoning additively is marked correct.', excludedFormats: [], instanceRule: 'The keyed answer differs from the answer of every modelled misconception of the core.' },
];

type Draft = Record<string, unknown> & { specialization: Record<string, unknown>; evidenceTarget: Record<string, unknown>; responseConstraints: Record<string, unknown>; provenance: Record<string, unknown>; difficultyLevers: { lever: string }[] };
function candidateCore(family: unknown, version: string, shortcuts: readonly ShortcutConstraint[]): ConstructCoreRecord {
  const built = constructCoreOf({ family: { ...(family as object), version, lifecycle: 'IN_REVIEW', reviewStatus: 'IN_REVIEW' }, shortcutConstraints: shortcuts });
  if (!built.ok) throw new Error(`STEP4B_PILOT_INVALID: ${built.issue} ${built.details.join('; ')}`);
  return built.core;
}
const draftOf = (family: unknown, id: string): Draft => { if (!family) throw new Error(`STEP4B_PILOT_INVALID: the draft ${id} is missing`); return family as Draft; };

/**
 * CORE A -- a NEW identity, written from the factorising draft while everything is still a draft. What it keeps
 * is the mathematics (the equation built from its roots, the ranges, the relationships, the levers). What it
 * changes is what the construct claims: that the learner SOLVES the equation, by any valid method.
 */
function methodNeutralQuadraticFamily(): unknown {
  const d = draftOf(mathPocFamilyEa1aOf(QUADRATIC_SOURCE_DRAFT_ID), QUADRATIC_SOURCE_DRAFT_ID);
  const sp = d.specialization as { numericalDifficultyLevers: Record<string, string>[] };
  return {
    ...d, familyId: QUADRATIC_ID,
    evidenceTarget: { ...d.evidenceTarget, observablePerformance: 'Obtains both roots of the equation by any valid method and gives the root, or the roots, asked for.' },
    commonMisconceptions: ['Gives each root with its sign reversed.', 'Divides both sides by the unknown and loses a root.', 'Works on the equation before one side is zero.'],
    responseConstraints: { ...d.responseConstraints, note: 'Selected response is excluded: with options, substitution replaces solving. A numeric response asks for ONE stated root (the greater), so the response has one value.' },
    specialization: {
      ...d.specialization,
      mathematicalStructure: { construct: QUADRATIC_SOLVE_CONSTRUCT, description: 'a x^2 + b x + c = 0 with two different rational roots, each an integer or a half, to be solved by any valid method.' },
      constraints: ['b and c are integers.', 'The equation is built from its roots, never the roots from arbitrary coefficients.', 'The two roots are different and neither is zero.'],
      validSolutionRules: ['Both roots are rational: an integer or a half.', 'When one root is asked, the stem says which one, so the response has one value.', 'No method is required: factorising, the quadratic formula, completing the square and inspection all reach the keyed roots.'],
      misconceptionModels: [
        { id: 'sign-of-roots', description: 'Reverses the sign of each root (reads factor constants as roots, or drops the minus sign of the formula).', producesError: 'x = -r1 and x = -r2' },
        { id: 'lost-root', description: 'Divides by the unknown, or stops at the first root found.', producesError: 'Only one root.' },
        { id: 'non-zero-side', description: 'Works on the equation while its right-hand side is not zero.', producesError: 'Roots of another equation.' },
      ],
      numericalDifficultyLevers: sp.numericalDifficultyLevers.map((l) => (l.lever === 'leading-coefficient' ? { ...l, FOUNDATIONAL: 'a = 1, two positive integer roots.', STANDARD: 'a = 1 with integer roots of opposite signs.', CHALLENGE: 'a = 2 with one root a half and the other a negative integer.' } : l)),
    },
    provenance: { ...d.provenance, authoredAt: REVISED_AT, note: `Step 4B: a method-neutral construct written from the draft ${QUADRATIC_SOURCE_DRAFT_ID}; drafted in-session by the model; unreviewed.` },
  };
}
/**
 * CORE B -- the draft with its steps lever corrected to what the renderer guarantees: a unit conversion before one
 * proportion. No second proportion is declared and none is rendered.
 */
function revisedProportionFamily(): unknown {
  const d = draftOf(mathPocFamilyOf(PROPORTION_ID), PROPORTION_ID);
  const sp = d.specialization as { numericalDifficultyLevers: Record<string, string>[] };
  const STEPS = { lever: 'unit-conversion', kind: 'STEPS' };
  return {
    ...d,
    // the constraint two systems carry named the lever's old "composed variants": it now names the settings that exist
    profileSupport: Object.fromEntries(Object.entries(d.profileSupport as Record<string, { status: string; constraints?: { kind: string; reason: string }[] }>).map(([system, support]) => [system, support.constraints
      ? { ...support, constraints: support.constraints.map((c) => (c.kind === 'DIFFICULTY_ONLY' ? { ...c, reason: 'At the foundational band the task is one line of working; a response marked on shown method needs the unit-conversion settings of the steps lever.' } : c)) }
      : support])),
    difficultyLevers: (d.difficultyLevers as { lever: string }[]).map((l) => (l.lever === 'composed-proportion' ? { ...STEPS, description: 'Whether the further value is stated in another unit and must be converted before the proportion is used.' } : l)),
    specialization: {
      ...d.specialization,
      numericalDifficultyLevers: sp.numericalDifficultyLevers.map((l) =>
        l.lever === 'composed-proportion' ? { ...STEPS, FOUNDATIONAL: 'One proportion; both values of the first quantity are in the same unit.', STANDARD: 'One proportion after a unit conversion.', CHALLENGE: 'One proportion after a unit conversion.' }
        : l.lever === 'scale-factor' ? { ...l, CHALLENGE: 'c / a is not a simple fraction and x is a decimal with at most two places.' } : l),
    },
    provenance: { ...d.provenance, authoredAt: REVISED_AT, note: 'Step 4B rc.2: the steps lever is a unit conversion before one proportion, which is what the renderer guarantees; drafted in-session by the model; unreviewed.' },
  };
}
export const PILOT_CORE_QUADRATIC: ConstructCoreRecord = candidateCore(methodNeutralQuadraticFamily(), PILOT_QUADRATIC_CORE_VERSION, QUADRATIC_SHORTCUTS);
export const PILOT_CORE_PROPORTION: ConstructCoreRecord = candidateCore(revisedProportionFamily(), PILOT_PROPORTION_CORE_VERSION, PROPORTION_SHORTCUTS);
/** Where each candidate comes from: the draft it was written from and that draft's version. */
export const PILOT_CORE_SOURCES: Readonly<Record<string, { draftId: string; draftVersion: string; change: string }>> = {
  [QUADRATIC_ID]: { draftId: QUADRATIC_SOURCE_DRAFT_ID, draftVersion: mathPocFamilyEa1aOf(QUADRATIC_SOURCE_DRAFT_ID)?.version ?? '', change: 'New identity. Evidence target, construct name, misconception wording, solution rules and lever wording are method-neutral; variables, ranges, relationships and system support are the draft\'s.' },
  [PROPORTION_ID]: { draftId: PROPORTION_ID, draftVersion: mathPocFamilyOf(PROPORTION_ID)?.version ?? '', change: 'Same identity, rc.2. The steps lever "composed-proportion" becomes "unit-conversion"; the CHALLENGE numeric setting states the two-place limit. Everything else is the draft\'s.' },
};
export const PILOT_CORES: readonly ConstructCoreRecord[] = [PILOT_CORE_QUADRATIC, PILOT_CORE_PROPORTION];

/**
 * The reasoning each core is evidence of, written out for the reviewer. PROPOSED wording.
 * `requiredObservableMethod` is null for both: neither construct requires a method to be seen. A strategy listed
 * as supported is one a learner may use; it is not a condition of a correct response.
 */
export interface CoreReasoning { minimumSuccessfulPath: readonly string[]; supportedStrategies: readonly string[]; requiredObservableMethod: string | null; necessity: string }
export const PILOT_CORE_REASONING: Readonly<Record<string, CoreReasoning>> = {
  [QUADRATIC_ID]: {
    minimumSuccessfulPath: ['Bring the equation to the form ax² + bx + c = 0 when it is not given in it.', 'Find both roots by a valid method.', 'Where one root is asked for, compare the two roots and give the one asked for.'],
    supportedStrategies: QUADRATIC_SUPPORTED_REASONING_STRATEGIES,
    requiredObservableMethod: null,
    necessity: 'The keyed value is a root of the equation and the stem offers no candidate value, so a correct response is reached only by solving the equation. Which method was used is not claimed.',
  },
  [PROPORTION_ID]: {
    minimumSuccessfulPath: ['Identify the two quantities and the pair of corresponding values that is given.', 'Where the further value is stated in another unit, convert it to the unit of the given pair.', 'Reach x = b · c / a by a multiplicative method.'],
    supportedStrategies: ['PROPORTION_A_OVER_B_EQUALS_C_OVER_X', 'SCALE_FACTOR_C_OVER_A', 'VALUE_PER_UNIT_B_OVER_A'],
    requiredObservableMethod: null,
    necessity: 'The keyed value is b · c / a and differs from the answer of every modelled misconception (additive, inverted, wrong pair), so a correct response is reached only by reasoning multiplicatively.',
  },
};

// --------------------------------------------------------------------------------------------- envelopes
const envelope = (e: RendererEnvelope): RendererEnvelope => { const p = RendererEnvelopeSchema.safeParse(e); if (!p.success) throw new Error(`STEP4B_PILOT_INVALID: ${p.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`); return p.data; };

/** PROPOSED. The item difficulty of each band is the reviewer's to set; these are the values put to the reviewer. */
export const PILOT_ENVELOPE_QUADRATIC: RendererEnvelope = envelope({
  v: 1, rendererVersion: QUADRATIC_SOLVE_RENDERER_VERSION, strategy: 'PARAMETRIC_DETERMINISTIC', construct: QUADRATIC_SOLVE_CONSTRUCT,
  constructFamilyId: QUADRATIC_ID, constructFamilyVersion: PILOT_QUADRATIC_CORE_VERSION, adapterIds: [PILOT_PAA, PILOT_IB], languages: ['es', 'en'], responseFormats: ['NUMERIC_ENTRY', 'SHORT_RESPONSE'],
  // one of the command terms the IB adapter governs; PAA uses none
  commandTerms: ['solve'],
  parameterRanges: [{ symbol: 'a', min: 1, max: 2, step: 1 }, { symbol: 'r1', min: -9, max: 9, step: 0.5 }, { symbol: 'r2', min: -9, max: 9, step: 0.5 }],
  bands: [
    { planningBand: 'FOUNDATIONAL', itemDifficulty: 2, leverSettings: ['Leading coefficient 1.', 'Two different positive integer roots, each from 1 to 9.', 'Given in standard form: x² + bx + c = 0.'] },
    { planningBand: 'STANDARD', itemDifficulty: 3, leverSettings: ['Leading coefficient 1.', 'Integer roots of opposite signs, each from 1 to 9 in size.', 'Terms on both sides: the learner rearranges to standard form first.'] },
    { planningBand: 'CHALLENGE', itemDifficulty: 4, leverSettings: ['Leading coefficient 2.', 'One positive half-integer root (1.5 to 8.5) and one negative integer root (−1 to −9).', 'Given as a product equal to a number: the learner expands and rearranges first.'] },
  ],
  stimulusKinds: [],
  exclusions: ['No selected response: the core excludes it.', 'No method is required or observed in an answer-only response; where working is marked, any valid method earns the method mark.', 'No repeated root, no difference of squares (b = 0), no root equal to 0.', 'Leading coefficients 3 to 6 of the core are not rendered by this version.'],
});
export const PILOT_ENVELOPE_PROPORTION: RendererEnvelope = envelope({
  v: 1, rendererVersion: PROPORTION_MISSING_VALUE_RENDERER_VERSION, strategy: 'PARAMETRIC_DETERMINISTIC', construct: PROPORTION_MISSING_VALUE_CONSTRUCT,
  constructFamilyId: PROPORTION_ID, constructFamilyVersion: PILOT_PROPORTION_CORE_VERSION, adapterIds: [PILOT_PAA], languages: ['es'], responseFormats: ['NUMERIC_ENTRY'], commandTerms: [],
  parameterRanges: [{ symbol: 'a', min: 2, max: 60, step: 1 }, { symbol: 'b', min: 2, max: 240, step: 1 }, { symbol: 'c', min: 3, max: 180, step: 1 }],
  bands: [
    { planningBand: 'FOUNDATIONAL', itemDifficulty: 2, leverSettings: ['The second value is a whole-number multiple (2 to 6 times) of the first.', 'One proportion, both values in the same unit.', 'First given value at most 12, second at most 60; the answer is a whole number.'] },
    { planningBand: 'STANDARD', itemDifficulty: 3, leverSettings: ['The factor between the two values is a simple fraction: denominator 2 to 5, numerator at most 9 (3/2, 7/3, 9/4 ...).', 'The second value is stated in a larger unit (hours for minutes, weeks for days): the learner converts first.', 'Second given value at most 120; the answer is a whole number.'] },
    { planningBand: 'CHALLENGE', itemDifficulty: 4, leverSettings: ['The factor between the two values is not a simple fraction (denominator 6 or more) and is at most 6.', 'The second value is stated in a larger unit: the learner converts first.', 'Second given value at most 120; the answer is a decimal with one or two places.'] },
  ],
  stimulusKinds: [],
  exclusions: ['No selected response in this version: a produced value only.', 'One proportion per instance: no second proportion is declared by the core or rendered.', 'Four situations only: cost of identical notebooks, a tap in minutes, a tap in hours, irrigation in weeks.'],
});
export const PILOT_ENVELOPES: readonly RendererEnvelope[] = [PILOT_ENVELOPE_QUADRATIC, PILOT_ENVELOPE_PROPORTION];
const CONFORMANCE: Readonly<Record<string, BandConformance>> = {
  [QUADRATIC_SOLVE_CONSTRUCT]: quadraticSolveBandIssues,
  [PROPORTION_MISSING_VALUE_CONSTRUCT]: (band, p) => proportionBandIssues(band as TaskDifficultyBand, p as unknown as ProportionParameters),
};
export const PILOT_STRATEGIES: readonly RenderingStrategy[] = [QUADRATIC_SOLVE_STRATEGY, PROPORTION_MISSING_VALUE_STRATEGY];

// -------------------------------------------------------------------------------------------- blueprints
export interface BlueprintClassificationProposal {
  blueprintId: string;
  adapterId: string;
  configKey: string;
  sectionKey: string;
  /** The section's own recorded facts. `declaredFixture` is about the STRUCTURE, never about the content status of its items. */
  facts: BlueprintSectionFacts;
  proposedClass: BlueprintClass;
  status: 'PROPOSED';
  /** Bucket -> the canonical concept it is proposed to assess, with the record that links them. */
  buckets: readonly { bucket: BlueprintBucketRef; conceptLink: string }[];
}
const proposal = (p: Omit<BlueprintClassificationProposal, 'proposedClass' | 'status' | 'buckets'> & { buckets: readonly { objectiveCode: string; concept: string; conceptLink: string }[] }): BlueprintClassificationProposal => {
  const proposedClass = classifyBlueprintSection(p.facts);
  return {
    ...p, proposedClass, status: 'PROPOSED',
    buckets: p.buckets.map((b) => ({ conceptLink: b.conceptLink, bucket: { bucketId: `${p.configKey}/${p.sectionKey}/${b.objectiveCode}#0`, configKey: p.configKey, sectionKey: p.sectionKey, adapterId: p.adapterId, objectiveCode: b.objectiveCode, primaryConceptStableIds: [b.concept], responseFormat: null, blueprintClass: proposedClass } })),
  };
};
/**
 * PAA Matemáticas: 12 governed positions of an official 55; the five domains are named from the official guide but
 * no weight per domain is recorded, so the structure follows no documented distribution -> the facts support REDUCED.
 */
export const PILOT_BLUEPRINT_PAA: BlueprintClassificationProposal = proposal({
  blueprintId: 'v2.paa/matematicas', adapterId: PILOT_PAA, configKey: 'v2.paa', sectionKey: 'matematicas',
  facts: { itemBankable: true, declaredFixture: false, fullFormDocumented: false, distributionPartlyDocumented: false, officialItemCount: 55, governedSlots: 12 },
  buckets: [
    { objectiveCode: 'paa.mat.algebra', concept: 'math.alg.quadratics', conceptLink: 'paa.topic.040 "Ecuaciones cuadráticas" (OFFICIAL, cb-paa-guia-2021 p.35) under paa.dom.matematicas.algebra' },
    { objectiveCode: 'paa.mat.aritmetica', concept: 'math.num.ratio-proportion', conceptLink: 'paa.topic.028 "Razón y proporción" (OFFICIAL, cb-paa-guia-2021 p.35) under paa.dom.matematicas.aritmetica' },
  ],
});
/**
 * IB Mathematics AA HL Paper 1: a marks-based paper (110 marks, no fixed item count); 5 governed positions with no
 * marks budget, covering 3 of the 5 syllabus topics -> not the full form and not its distribution: REDUCED.
 */
export const PILOT_BLUEPRINT_IB: BlueprintClassificationProposal = proposal({
  blueprintId: 'v2.ib.math-aa-hl/p1', adapterId: PILOT_IB, configKey: 'v2.ib.math-aa-hl', sectionKey: 'p1',
  facts: { itemBankable: true, declaredFixture: false, fullFormDocumented: false, distributionPartlyDocumented: false, officialItemCount: null, governedSlots: 5 },
  buckets: [{ objectiveCode: 'aahl.p1.functions', concept: 'math.alg.quadratics', conceptLink: 'objective aahl.p1.functions -> math.alg.quadratics (objective-learning-links, DECLARED_REVIEWED: not yet certified)' }],
});
export const PILOT_BLUEPRINTS: readonly BlueprintClassificationProposal[] = [PILOT_BLUEPRINT_PAA, PILOT_BLUEPRINT_IB];

// --------------------------------------------------------------------------------------------- instances
/** Rights of a deterministic render: StudyUs's own core and renderer, no third-party text. Recorded per instance. */
export const PILOT_INSTANCE_RIGHTS = { status: 'STUDYUS_OWNED', basis: 'Rendered deterministically from a StudyUs-authored construct core by a StudyUs-authored renderer; contains no third-party expression.' } as const;

export interface PilotTarget { adapterId: string; language: string; responseFormat: string }
export const PILOT_TARGET_PAA: PilotTarget = { adapterId: PILOT_PAA, language: 'es', responseFormat: 'NUMERIC_ENTRY' };
export const PILOT_TARGET_IB: PilotTarget = { adapterId: PILOT_IB, language: 'en', responseFormat: 'SHORT_RESPONSE' };

export interface PilotInstance {
  instanceId: string;
  role: 'STUDENT_SUPPLY_CANDIDATE' | 'CROSS_MODEL_PROOF';
  coreId: string;
  coreVersion: string;
  conceptId: string;
  systemId: string;
  adapterId: string;
  adapterVersion: string;
  rendererVersion: string;
  blueprintBucketId: string;
  blueprintClass: BlueprintClass;
  seed: string;
  planningBand: TaskDifficultyBand;
  itemDifficulty: number;
  difficultyBand: DifficultyBand;
  prompt: string;
  answers: string[];
  marks: number;
  rendered: RenderedInstance;
  certifiedLineage: CertifiedInstanceLineage;
  envelopeIssues: { code: string; detail: string }[];
  certification: InstanceCertification;
  studentEligible: boolean;
}
export type PilotRender = { ok: true; instance: PilotInstance } | { ok: false; code: string; detail: string };

const renderer = createAssessmentInstanceRenderer(PILOT_STRATEGIES);
const envelopeOf = (core: ConstructCoreRecord): RendererEnvelope => { const e = PILOT_ENVELOPES.find((x) => x.constructFamilyId === core.constructFamilyId); if (!e) throw new Error(`STEP4B_PILOT_INVALID: no envelope for ${core.constructFamilyId}`); return e; };
const bucketOf = (core: ConstructCoreRecord, adapterId: string): { bucket: BlueprintBucketRef; blueprint: BlueprintClassificationProposal } | null => {
  for (const blueprint of PILOT_BLUEPRINTS) { const hit = blueprint.adapterId === adapterId ? blueprint.buckets.find((b) => b.bucket.primaryConceptStableIds.includes(core.primaryConceptStableId)) : undefined; if (hit) return { bucket: hit.bucket, blueprint }; }
  return null;
};
export const pilotApplicability = (core: ConstructCoreRecord, adapterId: string): CoreApplicabilityRecord => deriveCoreApplicability(core, { systemProfileId: adapterId.split('.')[0], componentId: adapterId }, MATH_POC_APPLICABILITY);

/**
 * The scope a certification of each object must carry. A core, its renderer envelope and its applicability are
 * of the core's canonical subject; an adapter and a blueprint classification are of a component, so any subject
 * the reviewer holds for that system covers them. "Matemáticas" and "Mathematics" are two canonical subjects:
 * neither is inferred from the other, so the proportion core (Matemáticas) is NOT inside a Mathematics scope.
 */
export interface PilotDecisionObject extends CertifiableObject { section: string; withinProposedScopes: boolean }
const withinProposed = (scope: ReviewerScope): boolean => PILOT_REVIEWER_SCOPES.some((s) => s.canonicalSubject === scope.canonicalSubject && s.systemId === scope.systemId);
const systemsOf = (adapterIds: readonly string[]): string[] => [...new Set(adapterIds.map((a) => a.split('.')[0]))];
const componentScope = (systemId: string): ReviewerScope => PILOT_REVIEWER_SCOPES.find((s) => s.systemId === systemId) ?? { canonicalSubject: 'Mathematics', systemId };

/** Every object the reviewer decides on, as it is now, with the hash of exactly what the packet shows. */
export function pilotDecisionObjects(): PilotDecisionObject[] {
  const out: PilotDecisionObject[] = [];
  const add = (section: string, o: CertifiableObject) => out.push({ ...o, section, withinProposedScopes: withinProposed(o.scope) });
  for (const b of PILOT_BLUEPRINTS) add(`Blueprint ${b.adapterId}`, { objectType: 'BLUEPRINT_CLASSIFICATION', objectId: b.blueprintId, objectVersion: PILOT_ID, contentHash: pilotBlueprintHash(b), scope: componentScope(b.adapterId.split('.')[0]) });
  for (const core of PILOT_CORES) for (const systemId of systemsOf(envelopeOf(core).adapterIds)) {
    add(`Core ${core.constructFamilyId}`, { objectType: 'CONSTRUCT_CORE', objectId: core.constructFamilyId, objectVersion: core.familyVersion, contentHash: core.contentHash, scope: { canonicalSubject: core.canonicalSubject, systemId } });
  }
  for (const core of PILOT_CORES) for (const adapterId of envelopeOf(core).adapterIds) {
    const a = pilotApplicability(core, adapterId);
    if (a.status === 'CONDITIONAL') add(`Core ${core.constructFamilyId}`, { objectType: 'CORE_APPLICABILITY', objectId: `${core.constructFamilyId} x ${adapterId}`, objectVersion: core.familyVersion, contentHash: pilotApplicabilityHash(a), scope: { canonicalSubject: core.canonicalSubject, systemId: adapterId.split('.')[0] } });
  }
  for (const adapterId of [PILOT_PAA, PILOT_IB]) { const a = STUDYUS_ASSESSMENT_REGISTRY.adapter(adapterId); if (a) add(`Adapter ${adapterId}`, { objectType: 'ASSESSMENT_ADAPTER', objectId: adapterId, objectVersion: a.version, contentHash: pilotAdapterHash(adapterId), scope: componentScope(a.systemId) }); }
  for (const e of PILOT_ENVELOPES) { const core = PILOT_CORES.find((c) => c.constructFamilyId === e.constructFamilyId); for (const systemId of systemsOf(e.adapterIds)) add(`Renderer ${e.rendererVersion}`, { objectType: 'RENDERER_ENVELOPE', objectId: e.rendererVersion, objectVersion: e.constructFamilyVersion, contentHash: envelopeHashOf(e), scope: { canonicalSubject: core?.canonicalSubject ?? '', systemId } }); }
  return out;
}

/**
 * One pilot instance: composed and rendered through the same composer and renderer a Student delivery would use,
 * in DEV_TEST use (nothing is certified), then placed against its envelope and against the certification rules.
 * `records` and `qualifications` are what a database would hold; with none, every instance is not certified.
 */
export function renderPilotInstance(core: ConstructCoreRecord, target: PilotTarget, planningBand: TaskDifficultyBand, seed: string, role: PilotInstance['role'], records: readonly unknown[] = [], qualifications: readonly ReviewerQualification[] = []): PilotRender {
  const registry = STUDYUS_ASSESSMENT_REGISTRY;
  const adapter = registry.adapter(target.adapterId);
  const pair = registry.profilePairOf(target.adapterId);
  const placed = bucketOf(core, target.adapterId);
  if (!adapter || !pair) return { ok: false, code: 'ADAPTER_NOT_REGISTERED', detail: target.adapterId };
  if (!placed) return { ok: false, code: 'NO_GOVERNED_BUCKET_FOR_THE_CONCEPT', detail: `${core.primaryConceptStableId} x ${target.adapterId}` };
  const applicability = pilotApplicability(core, target.adapterId);
  const spec = composeAssessmentSpecification({
    use: 'DEV_TEST', registry, core, adapter, system: pair.system, component: pair.component, coreApplicability: [applicability], applicabilityRegister: MATH_POC_APPLICABILITY, bucket: placed.bucket, disciplinePolicy: MATHEMATICS_ADAPTATION_POLICY,
    request: { purpose: 'PRACTICE', difficultyBand: planningBand, language: target.language, contentUseClass: 'DEV_TEST_CONTENT', responseFormat: target.responseFormat },
  });
  if (!spec.ok) return { ok: false, code: spec.code, detail: spec.detail };
  const r = renderer.render({ use: 'DEV_TEST', registry, core, adapter, applicability: spec.applicability, specification: spec.specification, bucket: spec.bucket, seed });
  if (!r.ok) return { ok: false, code: r.code, detail: r.detail };
  const env = envelopeOf(core);
  const lineage = certifiedInstanceLineageOf(env, r.instance, planningBand);
  if (!lineage.ok) return { ok: false, code: lineage.code, detail: lineage.detail };
  const envelopeIssues = instanceEnvelopeIssues(env, r.instance, { adapterId: target.adapterId, language: target.language, responseFormat: target.responseFormat, planningBand, commandTerm: spec.specification.variable.commandTerm ?? null }, CONFORMANCE[env.construct]);
  // a core, its envelope and its applicability are of the core's subject; an adapter and a blueprint are of the component
  const scope: ReviewerScope = { canonicalSubject: core.canonicalSubject, systemId: adapter.systemId };
  const recordOf = (o: Pick<CertifiableObject, 'objectType' | 'objectId'>) => records.find((x) => { const y = x as { objectType?: string; objectId?: string; scope?: ReviewerScope }; return y.objectType === o.objectType && y.objectId === o.objectId && y.scope?.systemId === adapter.systemId; }) ?? null;
  const state = (object: CertifiableObject) => certificationStateOf(object, recordOf(object), qualifications);
  const componentState = (object: Omit<CertifiableObject, 'scope'>) => { const record = recordOf(object) as { scope?: ReviewerScope } | null; return certificationStateOf({ ...object, scope: record?.scope ?? scope }, record, qualifications); };
  const strategy = PILOT_STRATEGIES.find((s) => s.rendererVersion === env.rendererVersion);
  const certification = instanceCertificationOf({
    core: state({ objectType: 'CONSTRUCT_CORE', objectId: core.constructFamilyId, objectVersion: core.familyVersion, contentHash: core.contentHash, scope }),
    adapter: componentState({ objectType: 'ASSESSMENT_ADAPTER', objectId: adapter.adapterId, objectVersion: adapter.version, contentHash: pilotAdapterHash(target.adapterId) }),
    rendererEnvelope: state({ objectType: 'RENDERER_ENVELOPE', objectId: env.rendererVersion, objectVersion: env.constructFamilyVersion, contentHash: envelopeHashOf(env), scope }),
    blueprintClassification: componentState({ objectType: 'BLUEPRINT_CLASSIFICATION', objectId: placed.blueprint.blueprintId, objectVersion: PILOT_ID, contentHash: pilotBlueprintHash(placed.blueprint) }),
    blueprintClass: placed.blueprint.proposedClass,
    applicability: { status: applicability.status, conditionalApproval: applicability.status === 'CONDITIONAL' ? state({ objectType: 'CORE_APPLICABILITY', objectId: `${core.constructFamilyId} x ${adapter.adapterId}`, objectVersion: core.familyVersion, contentHash: pilotApplicabilityHash(applicability), scope }) : null },
    strategy: r.instance.strategy, templateEnvelope: null, hasStimulus: r.instance.learner.stimulus !== null, envelopeIssues,
    rendererVersionIsTheCertifiedOne: r.instance.lineage.rendererVersion === env.rendererVersion,
    contentIsTheRenderers: instanceContentHashOf(r.instance) === lineage.value.contentHash, manuallyEdited: false,
    rights: { status: PILOT_INSTANCE_RIGHTS.status, inForce: true }, lineageComplete: true, lineageIntact: certifiedLineageIntact(lineage.value), itemDifficulty: lineage.value.itemDifficulty,
    unsupportedRepresentations: strategy ? unrenderableRepresentations(core, strategy) : ['NO_STRATEGY'],
  }, { certified: false, reason: 'NO_CERTIFICATION_RECORD', detail: 'no individual review' });
  const band = bandOf(lineage.value.itemDifficulty);
  if (!band) return { ok: false, code: 'DIFFICULTY_NOT_RECORDED', detail: String(lineage.value.itemDifficulty) };
  return {
    ok: true,
    instance: {
      instanceId: `${PILOT_ID}:${lineage.value.digest.slice(0, 16)}`, role, coreId: core.constructFamilyId, coreVersion: core.familyVersion, conceptId: core.primaryConceptStableId, systemId: adapter.systemId, adapterId: adapter.adapterId,
      adapterVersion: adapter.version, rendererVersion: env.rendererVersion, blueprintBucketId: placed.bucket.bucketId, blueprintClass: placed.blueprint.proposedClass, seed, planningBand, itemDifficulty: lineage.value.itemDifficulty,
      difficultyBand: band, prompt: r.instance.learner.prompt, answers: r.instance.key.answers, marks: r.instance.learner.marks, rendered: r.instance, certifiedLineage: lineage.value, envelopeIssues, certification,
      studentEligible: certification.certified,
    },
  };
}

/** What a reviewer of an adapter is shown: the resolved rule pair the registry holds. */
export const pilotAdapterHash = (adapterId: string): string => sha256OfCanonicalJson(STUDYUS_ASSESSMENT_REGISTRY.profilePairOf(adapterId));
export const pilotBlueprintHash = (b: BlueprintClassificationProposal): string => sha256OfCanonicalJson({ blueprintId: b.blueprintId, facts: b.facts, proposedClass: b.proposedClass, buckets: b.buckets });
export const pilotApplicabilityHash = (a: CoreApplicabilityRecord): string => sha256OfCanonicalJson(a);

export const PILOT_INSTANCES_PER_CELL = 3 as const;
/**
 * The pilot instance set: for each core and band, the first three seeds that give three different parameter sets
 * under PAA (the Student supply candidates), and, for the core IB also hosts, the same seeds under IB (the
 * cross-model proof: one seed, one piece of mathematics, asked two ways).
 */
export function preparePilotInstances(records: readonly unknown[] = [], qualifications: readonly ReviewerQualification[] = []): { instances: PilotInstance[]; refusals: { cell: string; code: string; detail: string }[] } {
  const instances: PilotInstance[] = [];
  const refusals: { cell: string; code: string; detail: string }[] = [];
  for (const core of PILOT_CORES) for (const planningBand of PILOT_BANDS) {
    const seen = new Set<string>();
    const short = core.constructFamilyId.split('.').slice(2).join('.');
    for (let n = 1; seen.size < PILOT_INSTANCES_PER_CELL && n <= 64; n += 1) {
      const seed = `${PILOT_ID}/${short}/${planningBand.toLowerCase()}/${String(n).padStart(3, '0')}`;
      const paa = renderPilotInstance(core, PILOT_TARGET_PAA, planningBand, seed, 'STUDENT_SUPPLY_CANDIDATE', records, qualifications);
      if (!paa.ok) { refusals.push({ cell: `${core.constructFamilyId}/${planningBand}/${seed}`, code: paa.code, detail: paa.detail }); break; }
      const parameterSetId = paa.instance.certifiedLineage.lineage.parameterSetId;
      if (seen.has(parameterSetId)) continue;
      seen.add(parameterSetId);
      instances.push(paa.instance);
      if (envelopeOf(core).adapterIds.includes(PILOT_IB)) {
        const ib = renderPilotInstance(core, PILOT_TARGET_IB, planningBand, seed, 'CROSS_MODEL_PROOF', records, qualifications);
        if (ib.ok) instances.push(ib.instance); else refusals.push({ cell: `${core.constructFamilyId}/${planningBand}/${seed}/IB`, code: ib.code, detail: ib.detail });
      }
    }
  }
  return { instances, refusals };
}
