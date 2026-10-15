/**
 * QF V5.2 -- the library catalogue: every construct core that has a machine-checkable renderer envelope, with the
 * envelope, the bounded construct behind it and where it may be placed (data + pure functions).
 *
 * Two entries are the Step 4B pilot objects, imported unchanged (their content hashes are the ones the pilot
 * reviewer approved). Four are new in V5.2 and have been reviewed by nobody: they exist to close the PAA
 * Matemáticas pilot blueprint (algebra, geometry, data, probability). Nothing here is CERTIFIED by this file: an
 * entry is a candidate, and `v52/object-governance.ts` decides what each object is.
 *
 * One core serves several systems through applicability and adapters. No entry is a copy of another for a second
 * system: the quadratic core is ONE core, placed under PAA and under IB.
 */
import { ASSESSMENT_APPLICABILITY_CONTRACT_VERSION, type AssessmentApplicabilityRecord } from '@/lib/assessment-adaptation/assessment-applicability';
import { MATHEMATICS_ADAPTATION_POLICY } from '@/lib/assessment-adaptation/discipline-policy';
import { MATH_POC_APPLICABILITY } from '@/lib/assessment-adaptation/math-poc-applicability';
import { IB_AA_HL_APPLICABILITY, IB_AA_HL_APPLICABILITY_2026_10_14, IB_AA_HL_APPLICABILITY_2026_10_15_ALL } from '@/lib/curriculum/ib/ib-aa-hl-concept-correspondence';
import { mathPocFamilyOf } from '@/lib/exam-core/question-bank/task-families/math-poc-families';
import { composeAssessmentSpecification, type BlueprintBucketRef } from '../assessment-specification';
import { classifyBlueprintSection, type BlueprintClass, type BlueprintSectionFacts } from '../blueprint-classification';
import { constructCoreOf, type ConstructCoreRecord, type ShortcutConstraint } from '../construct-core';
import { deriveCoreApplicability, type CoreApplicabilityRecord } from '../core-applicability';
import { PILOT_BLUEPRINT_IB, PILOT_BLUEPRINT_PAA, PILOT_CORE_PROPORTION, PILOT_CORE_QUADRATIC, PILOT_CORE_REASONING, PILOT_ENVELOPE_PROPORTION, PILOT_ENVELOPE_QUADRATIC, PILOT_IB, PILOT_PAA } from '../pilot/step4b-pilot-slice';
import { STUDYUS_ASSESSMENT_REGISTRY } from '../registered-systems';
import type { DifficultyMechanism } from '../instance-validators';
import { createAssessmentInstanceRenderer, type RenderedInstance, type RenderingStrategy } from '../renderer';
import { certifiedInstanceLineageOf, instanceEnvelopeIssues, RendererEnvelopeSchema, type CertifiedInstanceLineage, type EnvelopeIssue, type RendererEnvelope } from '../renderer-envelope';
import { PROPORTION_MISSING_VALUE_STRATEGY } from '../strategy-proportion-missing-value';
import { QUADRATIC_SOLVE_STRATEGY } from '../strategy-quadratic-solve';
import { DATA_SET_MEAN, LINE_SLOPE, PROPORTION_MISSING_VALUE, QUADRATIC_SOLVE, RIGHT_TRIANGLE, SINGLE_DRAW } from './constructs';
import { LINEAR_EQUATION, LINEAR_SYSTEM, PERCENT, RECTANGLE } from './constructs-arithmetic-algebra-geometry';
import { parametricStrategy, type ParametricConstruct, type PlanningBand } from './parametric';
import { CIE_9709_P1_ENTRIES } from './cie-9709-p1.adoption';
import { CIE_9709_P1_SECTIONS, withCie9709P1Applicability } from '@/lib/curriculum/cambridge/cie-9709-p1-correspondence';
import { CF_IB_AAHL_01_ADOPTED } from './cf-ib-aahl-01.adoption';
import { IB_AAHL_EXT_ENTRIES } from './ib-aahl-ext.adoption';
import { IB_AAHL_P3_ENTRIES } from './ib-aahl-p3.adoption';
import { applicabilityThresholdFor } from '../applicability-threshold';
import { PISA_MATH_APPLICABILITY, PISA_MATH_ENTRIES } from './pisa-math.adoption';
import { AICE_9709_P1_ENTRIES } from './aice-9709-p1.adoption';
import { AICE_9709_P2P4P5_ENTRIES } from './aice-9709-p2p4p5.adoption';
import { AICE_9709_P2P4P5_APPLICABILITY, AICE_9709_P2P4P5_DECISION, AICE_9709_P2P4P5_EQUIVALENCES, CIE_9709_PAPER_ADAPTER, type Cie9709Paper } from '@/lib/curriculum/cambridge/aice-9709-p2p4p5-equivalence';
import { SABER_MATH_ENTRIES, SABER_MATH_IN_CONTEXT_ENTRIES } from './saber11-math.adoption';
import { SABER_APPLICABILITY, SABER_APPLICABILITY_2026_10_15, SABER_GOVERNANCE_DECISION, saberCorrespondenceOf } from '@/lib/curriculum/icfes/saber11-content-correspondence';
import { AICE_9709_P1_EQUIVALENCE_DECISION, AICE_9709_P1_EQUIVALENCES } from '@/lib/curriculum/cambridge/aice-9709-p1-equivalence';
import { CF_QUADRATIC_MINIMUM_FIRST_DELIVERY } from './cf-ib-aahl-01';

export const LIBRARY_VERSION = 'qf52-library-1' as const;
const NEW_CORE_VERSION = '1.0.0-rc.1' as const;
const AUTHORED_AT = '2026-10-13T00:00:00Z';
const SUPPORTED = { status: 'SUPPORTED' as const };
const ABSTRACT = { kind: 'ABSTRACT' as const, note: 'The quantities are given directly, with no situation.' };

function coreOf(family: unknown, shortcuts: readonly ShortcutConstraint[]): ConstructCoreRecord {
  const built = constructCoreOf({ family: { ...(family as object), version: NEW_CORE_VERSION, lifecycle: 'IN_REVIEW', reviewStatus: 'IN_REVIEW' }, shortcutConstraints: shortcuts });
  if (!built.ok) throw new Error(`QF52_LIBRARY_INVALID: ${built.issue} ${built.details.join('; ')}`);
  return built.core;
}
const newFamily = (f: { familyId: string; concept: { stableId: string; canonicalName: string }; targetSkills: string[]; evidenceTarget: unknown; supportedContexts: unknown[]; difficultyLevers: unknown[]; commonMisconceptions: string[]; note: string; specialization: unknown }): unknown => ({
  v: 1, familyId: f.familyId, version: NEW_CORE_VERSION, familyType: 'MATH_PROBLEM', canonicalSubject: 'Matemáticas', primaryConcepts: [{ stableId: f.concept.stableId, canonicalSubject: 'Matemáticas', canonicalName: f.concept.canonicalName }],
  targetSkills: f.targetSkills, targetCompetencies: ['dev.comp.math-reasoning'], evidenceTarget: f.evidenceTarget, supportedContexts: f.supportedContexts, difficultyLevers: f.difficultyLevers, commonMisconceptions: f.commonMisconceptions,
  responseConstraints: { allowedFormats: ['NUMERIC_ENTRY', 'SHORT_RESPONSE'], stimulusNeed: 'NONE', stimulusKinds: [], note: f.note },
  // declared for the one system whose official structure names the concept; nothing is claimed for the others
  profileSupport: { PAA: SUPPORTED },
  provenance: { authoredBy: 'STUDYUS', authoringKind: 'STUDYUS_GENERATED', authoredAt: AUTHORED_AT, referenceSourceKeys: ['studyus.q1.paa-certified-catalogue'], containsCopiedProtectedExpression: false, note: 'QF V5.2: written in-session by the model to close a PAA blueprint coverage gap; reviewed by nobody.' },
  lifecycle: 'IN_REVIEW', reviewStatus: 'IN_REVIEW', specialization: f.specialization,
});

// ------------------------------------------------------------------------------------------------- new cores
const CORE_LINE = coreOf(mathPocFamilyOf('tf.math.linear.line-through-two-points'), [
  { id: 'substitute-the-options', bypass: 'With options to choose from, a slope can be checked against the two points instead of being computed.', excludedFormats: [], instanceRule: 'The envelope of this version renders a produced value only; no candidate value is offered.' },
  { id: 'slope-of-one', bypass: 'A slope of 1 is its own reciprocal: a learner who inverts the slope is still marked right.', excludedFormats: [], instanceRule: 'The run and the rise of an instance are never equal.' },
]);
const CORE_DRAW = coreOf(mathPocFamilyOf('tf.math.probability.single-event-equally-likely'), [
  { id: 'answer-coincides-with-a-misconception', bypass: 'When the probability equals the odds, one over the number of categories, or its own complement, a learner using that wrong model is marked right.', excludedFormats: [], instanceRule: 'The keyed probability is never 1/3, never 1/2, and never equal to the odds or to the complement.' },
  { id: 'equal-categories', bypass: 'With two categories of the same size the event can be answered without telling them apart.', excludedFormats: [], instanceRule: 'The three category counts of an instance are all different.' },
]);
const CORE_TRIANGLE = coreOf(newFamily({
  familyId: 'tf.math.geometry.right-triangle-missing-side', concept: { stableId: 'math.geo.pythagorean-theorem', canonicalName: 'Teorema de Pitágoras' }, targetSkills: ['Razonamiento geométrico'],
  evidenceTarget: { actions: ['COMPUTE'], object: 'A right triangle of which two side lengths are known, stated in words.', observablePerformance: 'Identifies which side is the hypotenuse and uses the relation between the squares of the sides to find the third length.' },
  supportedContexts: [ABSTRACT, { kind: 'PERSONAL', note: 'An everyday right angle that names its three lengths (a ladder against a wall).' }],
  difficultyLevers: [{ lever: 'asked-side', kind: 'STEPS', description: 'Whether the unknown is the hypotenuse (a sum of squares) or a leg (a difference of squares).' }, { lever: 'side-size', kind: 'NUMERIC', description: 'How large the three lengths are.' }, { lever: 'situation', kind: 'CONTEXT_LOAD', description: 'Whether the triangle is named or must be recognised in a situation.' }],
  commonMisconceptions: ['Adds or subtracts the lengths instead of their squares.', 'Adds the squares when a leg is asked for.', 'Gives the sum of the squares without taking the square root.'],
  note: 'The triangle is described in words; no figure is needed to read which side is which.',
  specialization: {
    mathematicalStructure: { construct: 'RIGHT_TRIANGLE_MISSING_SIDE', description: 'A right triangle with integer legs p and q and integer hypotenuse h, p^2 + q^2 = h^2; two of the three lengths are given.' },
    variables: [{ symbol: 'legA', meaning: 'Shorter leg', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'legB', meaning: 'Longer leg', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'hyp', meaning: 'Hypotenuse', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'side', meaning: 'The side that is asked for', role: 'UNKNOWN', domain: 'INTEGER' }],
    parameterRanges: [{ symbol: 'legA', min: 3, max: 80, step: 1, note: null }, { symbol: 'legB', min: 4, max: 96, step: 1, note: 'Longer than legA.' }, { symbol: 'hyp', min: 5, max: 100, step: 1, note: null }],
    relationships: ['legA^2 + legB^2 = hyp^2'],
    constraints: ['The three lengths are integers.', 'The triangle is built from a Pythagorean triple, never from arbitrary lengths.'],
    validSolutionRules: ['The asked length is a positive integer.', 'Exactly one length satisfies the relation with the two given.'],
    misconceptionModels: [{ id: 'adds-the-sides', description: 'Adds the two given lengths.', producesError: 'legA + legB' }, { id: 'subtracts-the-sides', description: 'Subtracts the given leg from the hypotenuse.', producesError: 'hyp - leg' }, { id: 'forgets-the-root', description: 'Stops at the sum of the squares.', producesError: 'legA^2 + legB^2' }],
    numericalDifficultyLevers: [{ lever: 'asked-side', kind: 'STEPS', FOUNDATIONAL: 'The hypotenuse, from the two legs.', STANDARD: 'A leg, from the hypotenuse and the other leg.', CHALLENGE: 'A leg, in a situation that does not name the triangle.' }, { lever: 'side-size', kind: 'NUMERIC', FOUNDATIONAL: 'Hypotenuse at most 30.', STANDARD: 'Hypotenuse at most 41.', CHALLENGE: 'Hypotenuse from 25 to 100.' }],
    calculatorDependency: 'NONE',
  },
}), [{ id: 'figure-reading', bypass: 'A drawn triangle with its lengths marked could be measured or read instead of computed.', excludedFormats: [], instanceRule: 'No figure is attached: every length is stated in words.' }]);
const CORE_MEAN = coreOf(newFamily({
  familyId: 'tf.math.statistics.mean-of-a-data-set', concept: { stableId: 'math.stat.central-tendency', canonicalName: 'Medidas de tendencia central' }, targetSkills: ['Razonamiento cuantitativo'],
  evidenceTarget: { actions: ['COMPUTE'], object: 'A small set of whole-number data, or its size and its arithmetic mean.', observablePerformance: 'Uses the relation between the sum of the data, their number and their mean to find the mean, a missing datum or an added datum.' },
  supportedContexts: [ABSTRACT],
  difficultyLevers: [{ lever: 'asked-quantity', kind: 'STEPS', description: 'Whether the mean is asked from the data, or a datum is asked from the mean.' }, { lever: 'data-visibility', kind: 'ABSTRACTION', description: 'Whether the data are listed or only their number and mean are given.' }],
  commonMisconceptions: ['Gives the median for the mean.', 'Gives the sum of the data without dividing.', 'Gives the mean when a datum is asked for.'],
  note: 'The data are listed in the sentence; no table and no chart is needed.',
  specialization: {
    mathematicalStructure: { construct: 'ARITHMETIC_MEAN_OF_A_DATA_SET', description: 'n whole-number data with whole-number arithmetic mean m: their sum is n times m.' },
    variables: [{ symbol: 'n', meaning: 'Number of data', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'mean', meaning: 'Arithmetic mean of the data', role: 'DERIVED', domain: 'INTEGER' }, { symbol: 'value', meaning: 'The value that is asked for', role: 'UNKNOWN', domain: 'INTEGER' }],
    parameterRanges: [{ symbol: 'n', min: 4, max: 8, step: 1, note: null }, { symbol: 'mean', min: 6, max: 40, step: 1, note: null }],
    relationships: ['sum of the data = n * mean', 'added value = newMean * (n + 1) - mean * n'],
    constraints: ['Every datum is a positive whole number.', 'The mean of a listed set is a whole number by construction.'],
    validSolutionRules: ['The asked value is a positive whole number.', 'The keyed value is never the median of a listed set nor the mean when a datum is asked for.'],
    misconceptionModels: [{ id: 'median-for-mean', description: 'Gives the middle value.', producesError: 'median of the data' }, { id: 'sum-not-divided', description: 'Gives the sum.', producesError: 'n * mean' }, { id: 'gives-the-mean', description: 'Gives the mean for the missing datum.', producesError: 'mean' }],
    numericalDifficultyLevers: [{ lever: 'asked-quantity', kind: 'STEPS', FOUNDATIONAL: 'The mean of the listed data.', STANDARD: 'The missing datum, from the mean and the other data.', CHALLENGE: 'The datum that was added, from the mean before and after.' }],
    calculatorDependency: 'NONE',
  },
}), [{ id: 'median-coincides-with-the-mean', bypass: 'In a symmetric list the middle value is the mean, so a learner giving the median is marked right.', excludedFormats: [], instanceRule: 'The median of a listed set is never its mean, and a hidden datum is never equal to the mean.' }]);

// ------------------------------------------------------------------------------ further cores (second batch)
const numeric = (variables: unknown[], ranges: unknown[], relationships: string[], constraints: string[], rules: string[], misconceptions: unknown[], levers: unknown[], construct: string, description: string) => ({ mathematicalStructure: { construct, description }, variables, parameterRanges: ranges, relationships, constraints, validSolutionRules: rules, misconceptionModels: misconceptions, numericalDifficultyLevers: levers, calculatorDependency: 'NONE' });
const given = (symbol: string, meaning: string) => ({ symbol, meaning, role: 'GIVEN', domain: 'INTEGER' });
const unknown = (symbol: string, meaning: string, domain = 'INTEGER') => ({ symbol, meaning, role: 'UNKNOWN', domain });
const range = (symbol: string, min: number, max: number) => ({ symbol, min, max, step: 1, note: null });
const CORE_PERCENT = coreOf(newFamily({
  familyId: 'tf.math.percent.part-increase-original', concept: { stableId: 'math.num.percent', canonicalName: 'Porcentajes' }, targetSkills: ['Razonamiento multiplicativo'],
  evidenceTarget: { actions: ['COMPUTE'], object: 'A quantity and a percentage of it, or a quantity after a percentage increase.', observablePerformance: 'Treats a percentage as a number of hundredths of the quantity it is a percentage OF, forwards and backwards.' },
  supportedContexts: [ABSTRACT, { kind: 'PERSONAL', note: 'A price that is increased by a percentage.' }],
  difficultyLevers: [{ lever: 'direction', kind: 'STEPS', description: 'Whether a part is asked, an increased whole, or the whole before the increase.' }],
  commonMisconceptions: ['Gives the increase for the increased price.', 'Takes the percentage off the final price to undo an increase.', 'Adds or subtracts the percentage as if it were an amount.'],
  note: 'A produced whole number; no percentage is given as a candidate.',
  specialization: numeric([given('p', 'The percentage'), given('base', 'The quantity the percentage is of'), unknown('value', 'The asked amount')], [range('p', 5, 75), range('base', 40, 480)], ['part = p * base / 100', 'increased = base * (100 + p) / 100'], ['Every amount shown and asked is a whole number.', 'The base is a multiple of 40.'], ['The asked amount is a positive whole number.', 'The keyed amount is never what a modelled misconception gives.'],
    [{ id: 'gives-only-the-increase', description: 'Stops at the part.', producesError: 'p * base / 100' }, { id: 'takes-the-percent-off-the-final', description: 'Undoes an increase by taking the same percentage off the result.', producesError: 'final * (100 - p) / 100' }, { id: 'adds-the-percent-as-a-number', description: 'Treats the percentage as an amount.', producesError: 'base + p' }],
    [{ lever: 'direction', kind: 'STEPS', FOUNDATIONAL: 'The part: p % of the quantity.', STANDARD: 'The quantity after an increase of p %.', CHALLENGE: 'The quantity before an increase of p %, from the quantity after it.' }], 'PERCENT_OF_A_QUANTITY', 'A quantity, a percentage p of it, and the quantity increased by p per cent.'),
}), [{ id: 'reversal-by-subtraction', bypass: 'When taking the percentage off the final amount happens to give the original, the reversed reasoning is not shown.', excludedFormats: [], instanceRule: 'The keyed amount is never what a modelled misconception gives.' }]);
const CORE_EQUATION = coreOf(newFamily({
  familyId: 'tf.math.linear-equation.solve-one-unknown', concept: { stableId: 'math.alg.linear-equations', canonicalName: 'Ecuaciones lineales' }, targetSkills: ['Razonamiento algebraico'],
  evidenceTarget: { actions: ['SOLVE'], object: 'A linear equation in one unknown with integer coefficients.', observablePerformance: 'Obtains the value of the unknown that makes the two sides equal, by any valid sequence of equivalent equations.' },
  supportedContexts: [ABSTRACT],
  difficultyLevers: [{ lever: 'equation-form', kind: 'STEPS', description: 'Whether the unknown is on one side, on both sides, or inside brackets on both sides.' }, { lever: 'solution-form', kind: 'NUMERIC', description: 'Whether the solution is a whole number or a half.' }],
  commonMisconceptions: ['Moves a term across the equals sign without changing its sign.', 'Stops before dividing by the coefficient of the unknown.', 'Multiplies only the first term of a bracket.'],
  note: 'Selected response is not rendered: with options, each can be substituted instead of solving.',
  specialization: numeric([{ symbol: 'a', meaning: 'Coefficient of the unknown on the left', role: 'PARAMETER', domain: 'INTEGER' }, unknown('x', 'The unknown', 'RATIONAL')], [range('a', 2, 9)], ['a * x + b = c', 'a * x + b = c * x + d', 'a * (x + b) = c * (x + d)'], ['Coefficients and constants are whole numbers.', 'The equation has exactly one solution.'], ['The solution is positive: a whole number, or a half in the hardest band.', 'The keyed value is never what a modelled misconception gives.'],
    [{ id: 'adds-instead-of-subtracting', description: 'Moves a constant without changing its sign.', producesError: '(c + b) / a' }, { id: 'does-not-divide', description: 'Stops before dividing by the coefficient.', producesError: 'c - b' }, { id: 'multiplies-only-the-first-term', description: 'Expands a bracket on its first term only.', producesError: '(d - b) / (a - c)' }],
    [{ lever: 'equation-form', kind: 'STEPS', FOUNDATIONAL: 'The unknown on one side: ax + b = c.', STANDARD: 'The unknown on both sides: ax + b = cx + d.', CHALLENGE: 'Brackets on both sides: a(x + b) = c(x + d).' }, { lever: 'solution-form', kind: 'NUMERIC', FOUNDATIONAL: 'A whole number from 1 to 12.', STANDARD: 'A whole number from 1 to 12.', CHALLENGE: 'A whole number or a half.' }], 'LINEAR_EQUATION_ONE_UNKNOWN', 'A linear equation in x with integer coefficients and exactly one solution.'),
}), [{ id: 'substitute-the-options', bypass: 'With options to choose from, each can be substituted into the equation instead of solving it.', excludedFormats: [], instanceRule: 'The envelope renders a produced value only; no candidate value is offered.' }]);
const CORE_SYSTEM = coreOf(newFamily({
  familyId: 'tf.math.linear-system.solve-two-unknowns', concept: { stableId: 'math.alg.linear-systems', canonicalName: 'Sistemas de ecuaciones' }, targetSkills: ['Razonamiento algebraico'],
  evidenceTarget: { actions: ['SOLVE'], object: 'Two linear equations in two unknowns with integer coefficients and one solution.', observablePerformance: 'Combines the two equations to eliminate one unknown and obtains the value of the unknown that is asked for.' },
  supportedContexts: [ABSTRACT],
  difficultyLevers: [{ lever: 'elimination', kind: 'STEPS', description: 'Whether adding the equations eliminates an unknown at once, after one multiplication, or after multiplying both.' }],
  commonMisconceptions: ['Gives the value of the other unknown.', 'Adds the equations and reports the sum of the right-hand sides.'],
  note: 'One unknown is asked for, so the response has one value.',
  specialization: numeric([{ symbol: 'x', meaning: 'The unknown that is asked for', role: 'UNKNOWN', domain: 'INTEGER' }, { symbol: 'y', meaning: 'The other unknown', role: 'UNKNOWN', domain: 'INTEGER' }], [range('x', 1, 15), range('y', 1, 15)], ['a1 * x + b1 * y = c1', 'a2 * x + b2 * y = c2'], ['The system has exactly one solution.', 'x and y are different positive whole numbers.'], ['The asked unknown is a positive whole number.', 'The keyed value is never the other unknown.'],
    [{ id: 'gives-the-other-unknown', description: 'Reports y for x.', producesError: 'the value of y' }, { id: 'adds-the-equations-and-stops', description: 'Reports the sum of the right-hand sides.', producesError: 'c1 + c2' }],
    [{ lever: 'elimination', kind: 'STEPS', FOUNDATIONAL: 'A sum and a difference: adding eliminates y at once.', STANDARD: 'Adding eliminates y; the coefficient of x is then greater than 2.', CHALLENGE: 'Both equations must be multiplied before an unknown is eliminated.' }], 'LINEAR_SYSTEM_TWO_UNKNOWNS', 'Two linear equations in x and y with integer coefficients and exactly one positive integer solution.'),
}), [{ id: 'substitute-the-options', bypass: 'With options to choose from, each can be tried in both equations instead of solving the system.', excludedFormats: [], instanceRule: 'The envelope renders a produced value only; no candidate value is offered.' }]);
const CORE_RECTANGLE = coreOf(newFamily({
  familyId: 'tf.math.geometry.rectangle-area-perimeter', concept: { stableId: 'math.geo.plane-figures-area-perimeter', canonicalName: 'Área y perímetro' }, targetSkills: ['Razonamiento geométrico'],
  evidenceTarget: { actions: ['COMPUTE'], object: 'A rectangle of which two of its width, length, perimeter and area are stated in words.', observablePerformance: 'Tells area from perimeter and uses the one that is given to recover the missing side before computing the other.' },
  supportedContexts: [ABSTRACT],
  difficultyLevers: [{ lever: 'given-measures', kind: 'STEPS', description: 'Whether both sides are given, or a side must first be recovered from the perimeter or from the area.' }],
  commonMisconceptions: ['Gives the perimeter for the area, or the area for the perimeter.', 'Uses the whole perimeter as if it were the other side.', 'Stops at the missing side.'],
  note: 'The rectangle is described in words; no figure is needed.',
  specialization: numeric([given('w', 'Width'), given('h', 'Length'), unknown('value', 'The asked measure')], [range('w', 2, 12), range('h', 3, 20)], ['area = w * h', 'perimeter = 2 * (w + h)'], ['The width is shorter than the length.', 'Every measure is a whole number.'], ['The asked measure is a positive whole number.', 'The keyed measure is never what a modelled misconception gives.'],
    [{ id: 'perimeter-for-area', description: 'Confuses the two measures.', producesError: '2 * (w + h)' }, { id: 'does-not-halve-the-perimeter', description: 'Takes the perimeter minus the width as the other side.', producesError: 'w * (perimeter - w)' }, { id: 'gives-the-other-side', description: 'Stops at the missing side.', producesError: 'the length h' }],
    [{ lever: 'given-measures', kind: 'STEPS', FOUNDATIONAL: 'Both sides are given; the area is asked.', STANDARD: 'The perimeter and the width are given; the area is asked.', CHALLENGE: 'The area and the width are given; the perimeter is asked.' }], 'RECTANGLE_AREA_AND_PERIMETER', 'A rectangle with integer width w and length h, its area w h and its perimeter 2 (w + h).'),
}), [{ id: 'area-equals-perimeter', bypass: 'In a rectangle whose area and perimeter are the same number, confusing the two is not detected.', excludedFormats: [], instanceRule: 'The keyed measure is never what a modelled misconception gives.' }]);

// ------------------------------------------------------------------------------------------------- envelopes
const envelope = (e: RendererEnvelope): RendererEnvelope => { const p = RendererEnvelopeSchema.safeParse(e); if (!p.success) throw new Error(`QF52_LIBRARY_INVALID: ${p.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`); return p.data; };
const paaEnvelope = (c: ParametricConstruct, core: ConstructCoreRecord, ranges: RendererEnvelope['parameterRanges'], settings: Record<PlanningBand, string[]>, exclusions: string[]): RendererEnvelope => envelope({
  v: 1, rendererVersion: c.rendererVersion, strategy: 'PARAMETRIC_DETERMINISTIC', construct: c.construct, constructFamilyId: core.constructFamilyId, constructFamilyVersion: core.familyVersion, adapterIds: [PILOT_PAA], languages: ['es'],
  responseFormats: ['NUMERIC_ENTRY'], commandTerms: [], parameterRanges: ranges,
  // the same mapping the pilot reviewer set for the two Step 4B envelopes; for these four it is a machine proposal
  bands: [{ planningBand: 'FOUNDATIONAL', itemDifficulty: 2, leverSettings: settings.FOUNDATIONAL }, { planningBand: 'STANDARD', itemDifficulty: 3, leverSettings: settings.STANDARD }, { planningBand: 'CHALLENGE', itemDifficulty: 4, leverSettings: settings.CHALLENGE }],
  stimulusKinds: [], exclusions,
});
const ENVELOPE_LINE = paaEnvelope(LINE_SLOPE as unknown as ParametricConstruct, CORE_LINE, [{ symbol: 'x1', min: -10, max: 10, step: 1 }, { symbol: 'y1', min: -20, max: 20, step: 1 }, { symbol: 'x2', min: -10, max: 10, step: 1 }, { symbol: 'y2', min: -20, max: 20, step: 1 }], {
  FOUNDATIONAL: ['All four coordinates positive.', 'Whole-number slope from 2 to 5.'], STANDARD: ['Exactly one negative coordinate.', 'Half-integer slope.'], CHALLENGE: ['A negative coordinate in each point.', 'Slope a fraction with denominator 3 to 6.'],
}, ['The slope only: the intercept, a coordinate and the equation of the line are not asked by this version.', 'Positive slopes only; a slope of 1 is never rendered.', 'No coordinate is 0; run and rise are at most 12.']);
const ENVELOPE_DRAW = paaEnvelope(SINGLE_DRAW as unknown as ParametricConstruct, CORE_DRAW, [{ symbol: 'n', min: 6, max: 45, step: 1 }, { symbol: 'k', min: 2, max: 43, step: 1 }], {
  FOUNDATIONAL: ['The event is one category.', 'The ratio is already in lowest terms.'], STANDARD: ['The event is two categories together.', 'The ratio simplifies.'], CHALLENGE: ['The event is a complement described in words.', 'The ratio simplifies.'],
}, ['One situation: marbles of three colours in a bag, each count from 2 to 15 and all three different.', 'The keyed probability is never 1/3, 1/2, the odds or the complement.']);
const ENVELOPE_TRIANGLE = paaEnvelope(RIGHT_TRIANGLE as unknown as ParametricConstruct, CORE_TRIANGLE, [{ symbol: 'legA', min: 3, max: 80, step: 1 }, { symbol: 'legB', min: 4, max: 96, step: 1 }, { symbol: 'hyp', min: 5, max: 100, step: 1 }], {
  FOUNDATIONAL: ['The hypotenuse is asked, from the two legs.', 'Hypotenuse at most 30.'], STANDARD: ['A leg is asked, from the hypotenuse and the other leg.', 'Hypotenuse at most 41.'], CHALLENGE: ['A leg is asked in a situation (a ladder against a wall).', 'Hypotenuse from 25 to 100.'],
}, ['Integer side lengths from ten primitive Pythagorean triples and their multiples up to a hypotenuse of 100.', 'No figure: the triangle is described in words.']);
const ENVELOPE_MEAN = paaEnvelope(DATA_SET_MEAN as unknown as ParametricConstruct, CORE_MEAN, [{ symbol: 'n', min: 4, max: 8, step: 1 }, { symbol: 'mean', min: 6, max: 40, step: 1 }], {
  FOUNDATIONAL: ['The mean of 4 to 6 listed whole numbers is asked.'], STANDARD: ['One datum is missing; the mean and the other data are given.'], CHALLENGE: ['Only the number of data and the mean are given; the datum added to reach a new mean is asked.'],
}, ['Mean only: the median, the mode and the range are not asked by this version.', 'Lists come from ten fixed deviation patterns around a whole-number mean.']);

const ENVELOPE_PERCENT = paaEnvelope(PERCENT as unknown as ParametricConstruct, CORE_PERCENT, [{ symbol: 'p', min: 5, max: 75, step: 5 }, { symbol: 'base', min: 40, max: 480, step: 40 }], {
  FOUNDATIONAL: ['A part is asked: 20, 25, 50 or 75 per cent of a multiple of 40.'], STANDARD: ['The price after an increase of 5 to 40 per cent is asked.'], CHALLENGE: ['The price before the increase is asked, from the price after it.'],
}, ['Increases only: a decrease is not rendered by this version.', 'Whole-number amounts only.']);
const ENVELOPE_EQUATION = paaEnvelope(LINEAR_EQUATION as unknown as ParametricConstruct, CORE_EQUATION, [{ symbol: 'a', min: 2, max: 9, step: 1 }], {
  FOUNDATIONAL: ['The unknown on one side: ax + b = c.', 'Whole-number solution from 1 to 12.'], STANDARD: ['The unknown on both sides: ax + b = cx + d.', 'Whole-number solution from 1 to 12.'], CHALLENGE: ['Brackets on both sides: a(x + b) = c(x + d).', 'The solution is a whole number or a half.'],
}, ['Positive solutions only.', 'No fractions as coefficients.']);
const ENVELOPE_SYSTEM = paaEnvelope(LINEAR_SYSTEM as unknown as ParametricConstruct, CORE_SYSTEM, [{ symbol: 'x', min: 1, max: 15, step: 1 }, { symbol: 'y', min: 1, max: 15, step: 1 }], {
  FOUNDATIONAL: ['A sum and a difference of the two unknowns.'], STANDARD: ['Adding the equations eliminates y; the coefficient of x in the first is 2 to 5.'], CHALLENGE: ['Coefficients 2 to 5 in both equations: both must be multiplied before eliminating.'],
}, ['x is always the unknown asked for.', 'Both unknowns are different positive whole numbers.']);
const ENVELOPE_RECTANGLE = paaEnvelope(RECTANGLE as unknown as ParametricConstruct, CORE_RECTANGLE, [{ symbol: 'w', min: 2, max: 12, step: 1 }, { symbol: 'h', min: 3, max: 20, step: 1 }], {
  FOUNDATIONAL: ['Both sides are given; the area is asked.'], STANDARD: ['The perimeter and the width are given; the area is asked.'], CHALLENGE: ['The area and the width are given; the perimeter is asked.'],
}, ['Rectangles only; no figure.', 'A rectangle whose keyed measure equals a modelled wrong answer is not rendered.']);

// ------------------------------------------------------------------------------------------- reasoning, per core
export interface LibraryReasoning { minimumSuccessfulPath: readonly string[]; supportedStrategies: readonly string[]; requiredObservableMethod: string | null }
const REASONING: Readonly<Record<string, LibraryReasoning>> = {
  ...Object.fromEntries(Object.entries(PILOT_CORE_REASONING).map(([id, r]) => [id, { minimumSuccessfulPath: r.minimumSuccessfulPath, supportedStrategies: r.supportedStrategies, requiredObservableMethod: r.requiredObservableMethod }])),
  [CORE_LINE.constructFamilyId]: { minimumSuccessfulPath: ['Find the rise and the run between the two points, subtracting in the same order.', 'Divide the rise by the run and give the slope in lowest terms.'], supportedStrategies: ['SLOPE_FORMULA', 'COUNTING_RISE_AND_RUN'], requiredObservableMethod: null },
  [CORE_DRAW.constructFamilyId]: { minimumSuccessfulPath: ['Count the possible outcomes: the total of the categories.', 'Count the favourable outcomes of the event as it is worded.', 'Give favourable over possible.'], supportedStrategies: ['DIRECT_COUNT', 'COMPLEMENT'], requiredObservableMethod: null },
  [CORE_TRIANGLE.constructFamilyId]: { minimumSuccessfulPath: ['Decide which of the lengths is the hypotenuse.', 'Use the relation between the squares: add them for the hypotenuse, subtract for a leg.', 'Take the square root.'], supportedStrategies: ['PYTHAGOREAN_RELATION', 'RECOGNISED_TRIPLE'], requiredObservableMethod: null },
  [CORE_PERCENT.constructFamilyId]: { minimumSuccessfulPath: ['Identify the quantity the percentage is OF.', 'Express the percentage as hundredths of that quantity, forwards or backwards as the question asks.'], supportedStrategies: ['FRACTION_OF_THE_QUANTITY', 'MULTIPLIER', 'UNIT_PERCENT'], requiredObservableMethod: null },
  [CORE_EQUATION.constructFamilyId]: { minimumSuccessfulPath: ['Remove any brackets.', 'Collect the terms with the unknown on one side and the constants on the other.', 'Divide by the coefficient of the unknown.'], supportedStrategies: ['INVERSE_OPERATIONS', 'BALANCING', 'INSPECTION'], requiredObservableMethod: null },
  [CORE_SYSTEM.constructFamilyId]: { minimumSuccessfulPath: ['Combine the two equations so that one unknown is eliminated.', 'Solve the resulting equation for the unknown that is asked for.'], supportedStrategies: ['ELIMINATION', 'SUBSTITUTION'], requiredObservableMethod: null },
  [CORE_RECTANGLE.constructFamilyId]: { minimumSuccessfulPath: ['Decide which measure is given and which is asked.', 'Recover the missing side when it is not given.', 'Compute the asked measure from the two sides.'], supportedStrategies: ['AREA_AND_PERIMETER_RELATIONS'], requiredObservableMethod: null },
  [CORE_MEAN.constructFamilyId]: { minimumSuccessfulPath: ['Relate the sum of the data to their number and their mean.', 'Find the quantity asked: the mean from the sum, or a datum from the two sums.'], supportedStrategies: ['SUM_AND_DIVIDE', 'DEVIATIONS_FROM_THE_MEAN'], requiredObservableMethod: null },
};

// ---------------------------------------------------------------------------------------- applicability register
const PAA_HIERARCHY = 'src/lib/curriculum/paa/paa-hierarchy.ts (PAA_TOPICS)';
const paaConcept = (stableId: string, topic: string, page = 36): AssessmentApplicabilityRecord => ({
  v: ASSESSMENT_APPLICABILITY_CONTRACT_VERSION, concept: { stableId, canonicalSubject: 'Matemáticas' }, scope: { systemProfileId: 'PAA', subject: 'Matemáticas', componentId: PILOT_PAA }, basis: 'OFFICIAL_EXAM_STRUCTURE',
  evidence: [{ kind: 'OFFICIAL_STRUCTURE_NODE_WITH_CERTIFIED_CONCEPT', reference: `paa.topic.${topic}`, recordedIn: PAA_HIERARCHY, sourceReference: `cb-paa-guia-2021 p.${page}`, reviewState: 'CERTIFIED' }],
});
/** The EA-1 register plus the PAA concepts the new cores assess, each from an official topic of the certified hierarchy. */
export const LIBRARY_APPLICABILITY: readonly AssessmentApplicabilityRecord[] = [...MATH_POC_APPLICABILITY, paaConcept('math.geo.pythagorean-theorem', '058'), paaConcept('math.stat.central-tendency', '063'), paaConcept('math.num.percent', '029', 35), paaConcept('math.alg.linear-equations', '036', 35), paaConcept('math.alg.linear-systems', '051', 35), paaConcept('math.geo.plane-figures-area-perimeter', '059')];
/** The V5.2 register plus the IB register of the pilot-governed StudyUs identities (publication and its extensions only). */
// + PISA (2026-10-15): the reviewed PISA objective -> concept links of the concepts the PISA constructs assess
// + Saber 11 (2026-10-15): the GOVERNED_PILOT content-category correspondences (UNREVIEWED; read under the Saber PILOT threshold only)
// + AICE 9709 P2/P4/P5 (2026-10-15): the reviewed AICE objective links, scoped to CAMBRIDGE.9709.P2/P4/P5
export const PUBLICATION_APPLICABILITY: readonly AssessmentApplicabilityRecord[] = withCie9709P1Applicability([...LIBRARY_APPLICABILITY, ...IB_AA_HL_APPLICABILITY, ...PISA_MATH_APPLICABILITY, ...SABER_APPLICABILITY, ...AICE_9709_P2P4P5_APPLICABILITY]);
/** The publication register AS IT WAS when TB-IB-AAHL-EXT-A1 was published on DEV (2026-10-15, before PISA and AICE). */
export const PUBLICATION_APPLICABILITY_2026_10_15_IB: readonly AssessmentApplicabilityRecord[] = withCie9709P1Applicability([...LIBRARY_APPLICABILITY, ...IB_AA_HL_APPLICABILITY_2026_10_15_ALL]);
/** The publication register AS IT WAS when PISA, AICE and Saber A1/A2 were published on DEV (2026-10-15, before IB Paper 3). */
export const PUBLICATION_APPLICABILITY_2026_10_15_ALL: readonly AssessmentApplicabilityRecord[] = withCie9709P1Applicability([...LIBRARY_APPLICABILITY, ...IB_AA_HL_APPLICABILITY_2026_10_15_ALL, ...PISA_MATH_APPLICABILITY, ...SABER_APPLICABILITY_2026_10_15]);
/** The publication register AS IT WAS when TB-IB-AAHL-P3-A1 was published on DEV (2026-10-15, before the Saber boundary decision and AICE P2/P4/P5). */
export const PUBLICATION_APPLICABILITY_2026_10_15_P3: readonly AssessmentApplicabilityRecord[] = withCie9709P1Applicability([...LIBRARY_APPLICABILITY, ...IB_AA_HL_APPLICABILITY, ...PISA_MATH_APPLICABILITY, ...SABER_APPLICABILITY_2026_10_15]);
/** The publication register AS IT WAS on 2026-10-14: the input of the batches published that day (CF-IB-AAHL-01-A2, CIE-9709-P1-A1). */
export const PUBLICATION_APPLICABILITY_2026_10_14: readonly AssessmentApplicabilityRecord[] = withCie9709P1Applicability([...LIBRARY_APPLICABILITY, ...IB_AA_HL_APPLICABILITY_2026_10_14]);

// --------------------------------------------------------------------------------------------------- blueprints
export interface LibraryBlueprint { blueprintId: string; classificationVersion: string; adapterId: string; configKey: string; sectionKey: string; facts: BlueprintSectionFacts; blueprintClass: BlueprintClass; buckets: { bucket: BlueprintBucketRef; governedPositions: number; conceptLinks: string[] }[] }
const bucket = (configKey: string, sectionKey: string, adapterId: string, blueprintClass: BlueprintClass, objectiveCode: string, concepts: string[]): BlueprintBucketRef => ({ bucketId: `${configKey}/${sectionKey}/${objectiveCode}#0`, configKey, sectionKey, adapterId, objectiveCode, primaryConceptStableIds: concepts, responseFormat: null, blueprintClass });
const PAA_CLASS = classifyBlueprintSection(PILOT_BLUEPRINT_PAA.facts);
/**
 * PAA Matemáticas with every one of its five governed objectives linked to the certified concepts the library can
 * place there. Same facts and same class as the classification the pilot reviewer approved; the further bucket
 * links make it a NEW classification version, decided on its own.
 */
export const LIBRARY_BLUEPRINT_PAA: LibraryBlueprint = {
  blueprintId: PILOT_BLUEPRINT_PAA.blueprintId, classificationVersion: 'qf52-2', adapterId: PILOT_PAA, configKey: 'v2.paa', sectionKey: 'matematicas', facts: PILOT_BLUEPRINT_PAA.facts, blueprintClass: PAA_CLASS,
  buckets: [
    { governedPositions: 3, conceptLinks: ['paa.topic.028', 'paa.topic.029'], bucket: bucket('v2.paa', 'matematicas', PILOT_PAA, PAA_CLASS, 'paa.mat.aritmetica', ['math.num.ratio-proportion', 'math.num.percent']) },
    { governedPositions: 3, conceptLinks: ['paa.topic.040', 'paa.topic.044', 'paa.topic.036', 'paa.topic.051'], bucket: bucket('v2.paa', 'matematicas', PILOT_PAA, PAA_CLASS, 'paa.mat.algebra', ['math.alg.quadratics', 'math.fun.linear-functions-lines', 'math.alg.linear-equations', 'math.alg.linear-systems']) },
    { governedPositions: 3, conceptLinks: ['paa.topic.058', 'paa.topic.059'], bucket: bucket('v2.paa', 'matematicas', PILOT_PAA, PAA_CLASS, 'paa.mat.geometria', ['math.geo.pythagorean-theorem', 'math.geo.plane-figures-area-perimeter']) },
    { governedPositions: 2, conceptLinks: ['paa.topic.063'], bucket: bucket('v2.paa', 'matematicas', PILOT_PAA, PAA_CLASS, 'paa.mat.datos', ['math.stat.central-tendency']) },
    { governedPositions: 1, conceptLinks: ['paa.topic.067'], bucket: bucket('v2.paa', 'matematicas', PILOT_PAA, PAA_CLASS, 'paa.mat.probabilidad', ['math.prob.probability']) },
  ],
};
export const LIBRARY_BLUEPRINT_IB: LibraryBlueprint = {
  blueprintId: PILOT_BLUEPRINT_IB.blueprintId, classificationVersion: 'step4b-pilot-1', adapterId: PILOT_IB, configKey: 'v2.ib.math-aa-hl', sectionKey: 'p1', facts: PILOT_BLUEPRINT_IB.facts, blueprintClass: PILOT_BLUEPRINT_IB.proposedClass,
  buckets: PILOT_BLUEPRINT_IB.buckets.map((b) => ({ governedPositions: 1, conceptLinks: [b.conceptLink], bucket: b.bucket })),
};
export const LIBRARY_BLUEPRINTS: readonly LibraryBlueprint[] = [LIBRARY_BLUEPRINT_PAA, LIBRARY_BLUEPRINT_IB];

// ------------------------------------------------------------- IB pilot classifications (after the V5.2 run)
/**
 * The IB classifications that the pilot-governed StudyUs concept identities unblock (2026-10-14). The V5.2 classification
 * `v2.ib.math-aa-hl/p1@step4b-pilot-1` (functions, HUMAN_CERTIFIED D02) is NOT changed: P1 algebra and calculus are a
 * classification of their own; P2 statistics is the first P2 classification. Same governed facts as the D02 one; the
 * P2 paper has 4 governed positions. Their certification is decided by the object governance, never assumed here.
 */
const ibBucket = (paper: 'p1' | 'p2', objectiveCode: string, concepts: string[]): BlueprintBucketRef => bucket('v2.ib.math-aa-hl', paper, paper === 'p1' ? PILOT_IB : 'IB.MATH_AA_HL.P2', LIBRARY_BLUEPRINT_IB.blueprintClass, objectiveCode, concepts);
const IB_P2_FACTS: BlueprintSectionFacts = { ...LIBRARY_BLUEPRINT_IB.facts, governedSlots: 4 };
export const LIBRARY_BLUEPRINT_IB_P1_ALGEBRA_CALCULUS: LibraryBlueprint = {
  blueprintId: LIBRARY_BLUEPRINT_IB.blueprintId, classificationVersion: 'cf-ib-aahl-01-p1', adapterId: PILOT_IB, configKey: 'v2.ib.math-aa-hl', sectionKey: 'p1', facts: LIBRARY_BLUEPRINT_IB.facts, blueprintClass: LIBRARY_BLUEPRINT_IB.blueprintClass,
  buckets: [
    { governedPositions: 1, conceptLinks: ['objective aahl.p1.algebra -> Logarithms, Sequences and series (objective-learning-links, DECLARED_REVIEWED; identities GOVERNED_PILOT)'], bucket: ibBucket('p1', 'aahl.p1.algebra', ['math.alg.sequences-series', 'math.alg.logarithms']) },
    { governedPositions: 2, conceptLinks: ['objective aahl.p1.calculus -> Differentiation, Integration (objective-learning-links, DECLARED_REVIEWED; identities GOVERNED_PILOT)'], bucket: ibBucket('p1', 'aahl.p1.calculus', ['math.calc.differentiation', 'math.calc.integration']) },
  ],
};
export const LIBRARY_BLUEPRINT_IB_P2_STATISTICS: LibraryBlueprint = {
  blueprintId: 'v2.ib.math-aa-hl/p2', classificationVersion: 'cf-ib-aahl-01-p2', adapterId: 'IB.MATH_AA_HL.P2', configKey: 'v2.ib.math-aa-hl', sectionKey: 'p2', facts: IB_P2_FACTS, blueprintClass: classifyBlueprintSection(IB_P2_FACTS),
  buckets: [{ governedPositions: 2, conceptLinks: ['objective aahl.p2.statistics -> Binomial distribution, Normal distribution (objective-learning-links, DECLARED_REVIEWED; identities GOVERNED_PILOT)'], bucket: bucket('v2.ib.math-aa-hl', 'p2', 'IB.MATH_AA_HL.P2', classifyBlueprintSection(IB_P2_FACTS), 'aahl.p2.statistics', ['math.prob.binomial-distribution', 'math.prob.normal-distribution']) }],
};
/**
 * IB 6/9 -> 9/9 (2026-10-15): the three governed objectives the CF constructs leave uncovered, each a classification of
 * its own (the existing ones are not changed): P1 extended ('show that'), P2 trigonometry and P2 extended ('find').
 * The concept links are the objective -> concept links the repository already holds (DECLARED_REVIEWED); the concepts
 * are governed identities (Differentiation GOVERNED_PILOT; Trigonometry and triangles, Exponential models GOVERNED by
 * their certified PAA record). Certification is decided by the object governance, never assumed here.
 */
export const LIBRARY_BLUEPRINT_IB_P1_EXTENDED: LibraryBlueprint = {
  blueprintId: LIBRARY_BLUEPRINT_IB.blueprintId, classificationVersion: 'tb-ib-aahl-ext-p1', adapterId: PILOT_IB, configKey: 'v2.ib.math-aa-hl', sectionKey: 'p1', facts: LIBRARY_BLUEPRINT_IB.facts, blueprintClass: LIBRARY_BLUEPRINT_IB.blueprintClass,
  buckets: [{ governedPositions: 1, conceptLinks: ['objective aahl.p1.extended -> Differentiation (objective-learning-links, DECLARED_REVIEWED; identity GOVERNED_PILOT)'], bucket: ibBucket('p1', 'aahl.p1.extended', ['math.calc.differentiation']) }],
};
export const LIBRARY_BLUEPRINT_IB_P2_TRIG_EXTENDED: LibraryBlueprint = {
  blueprintId: 'v2.ib.math-aa-hl/p2', classificationVersion: 'tb-ib-aahl-ext-p2', adapterId: 'IB.MATH_AA_HL.P2', configKey: 'v2.ib.math-aa-hl', sectionKey: 'p2', facts: IB_P2_FACTS, blueprintClass: classifyBlueprintSection(IB_P2_FACTS),
  buckets: [
    { governedPositions: 1, conceptLinks: ['objective aahl.p2.trigonometry -> Trigonometry and triangles (objective-learning-links, DECLARED_REVIEWED; identity GOVERNED by the certified PAA record)'], bucket: bucket('v2.ib.math-aa-hl', 'p2', 'IB.MATH_AA_HL.P2', classifyBlueprintSection(IB_P2_FACTS), 'aahl.p2.trigonometry', ['math.trig.ratios']) },
    { governedPositions: 1, conceptLinks: ['objective aahl.p2.extended -> Exponential models (objective-learning-links, DECLARED_REVIEWED; identity GOVERNED by the certified PAA record)'], bucket: bucket('v2.ib.math-aa-hl', 'p2', 'IB.MATH_AA_HL.P2', classifyBlueprintSection(IB_P2_FACTS), 'aahl.p2.extended', ['math.fun.exponential']) },
  ],
};
/**
 * IB Paper 3 (2026-10-15): the one governed objective aahl.p3.investigation, one position, placing Sequences and series
 * (objective-learning-links, DECLARED_REVIEWED; identity GOVERNED_PILOT). Paper 3 is its own component (IB.MATH_AA_HL.P3).
 */
const IB_P3_FACTS: BlueprintSectionFacts = { ...LIBRARY_BLUEPRINT_IB.facts, governedSlots: 1 };
export const LIBRARY_BLUEPRINT_IB_P3_INVESTIGATION: LibraryBlueprint = {
  blueprintId: 'v2.ib.math-aa-hl/p3', classificationVersion: 'tb-ib-aahl-p3', adapterId: 'IB.MATH_AA_HL.P3', configKey: 'v2.ib.math-aa-hl', sectionKey: 'p3', facts: IB_P3_FACTS, blueprintClass: classifyBlueprintSection(IB_P3_FACTS),
  buckets: [{ governedPositions: 1, conceptLinks: ['objective aahl.p3.investigation -> Sequences and series (objective-learning-links, DECLARED_REVIEWED; identity GOVERNED_PILOT)'], bucket: bucket('v2.ib.math-aa-hl', 'p3', 'IB.MATH_AA_HL.P3', classifyBlueprintSection(IB_P3_FACTS), 'aahl.p3.investigation', ['math.alg.sequences-series']) }],
};
/**
 * PISA 2022 Mathematics (2026-10-15): one bucket per governed objective (content area x process), one position each,
 * placing the concept the reviewed PISA link names (all PAA-certified identities). Reduced practice form (8 items).
 */
const PISA_FACTS: BlueprintSectionFacts = { itemBankable: true, declaredFixture: false, fullFormDocumented: false, distributionPartlyDocumented: true, officialItemCount: null, governedSlots: 8 };
const PISA_CLASS = classifyBlueprintSection(PISA_FACTS);
const PISA_BUCKETS: [string, string, string][] = [
  ['pisa.cantidad.formular', 'math.num.ratio-proportion', 'Proporcionalidad'], ['pisa.cantidad.emplear', 'math.num.percent', 'Porcentajes'],
  ['pisa.incertidumbre.interpretar', 'math.stat.central-tendency', 'Medidas de tendencia central'], ['pisa.incertidumbre.razonar', 'math.prob.probability', 'Probabilidad'],
  ['pisa.cambio.formular', 'math.alg.linear-equations', 'Ecuaciones lineales'], ['pisa.cambio.razonar', 'math.alg.linear-systems', 'Sistemas de ecuaciones'],
  ['pisa.espacio.emplear', 'math.geo.plane-figures-area-perimeter', 'Área y perímetro'], ['pisa.espacio.interpretar', 'math.geo.similarity-congruence', 'Semejanza de triángulos'],
];
/**
 * AICE 9709 AS Paper 1 (2026-10-15): the four AICE P1 objectives, each one official 9709 P1 section, filled from the
 * governed CAMBRIDGE.9709.P1 pair under the PILOT equivalence (aice-9709-p1-equivalence.ts). One position each.
 */
const AICE_P1_FACTS: BlueprintSectionFacts = { itemBankable: true, declaredFixture: false, fullFormDocumented: false, distributionPartlyDocumented: false, officialItemCount: null, governedSlots: 4 };
const AICE_P1_CLASS = classifyBlueprintSection(AICE_P1_FACTS);
export const LIBRARY_BLUEPRINT_AICE_9709_P1: LibraryBlueprint = {
  blueprintId: 'v2.aice.9709-as/p1', classificationVersion: 'aice-9709-p1-eq-pilot-1', adapterId: 'CAMBRIDGE.9709.P1', configKey: 'v2.aice.9709-as', sectionKey: 'p1', facts: AICE_P1_FACTS, blueprintClass: AICE_P1_CLASS,
  buckets: AICE_9709_P1_EQUIVALENCES.map((eq) => ({ governedPositions: 1, conceptLinks: [`AICE ${eq.aiceObjectiveCode} = syllabus 9709 ${eq.syllabusSection} (${eq.cambridgeObjectiveCode}) -> ${eq.conceptStableId} (PILOT equivalence ${AICE_9709_P1_EQUIVALENCE_DECISION.decisionId}, not human reviewed)`], bucket: bucket('v2.aice.9709-as', 'p1', 'CAMBRIDGE.9709.P1', AICE_P1_CLASS, eq.aiceObjectiveCode, [eq.conceptStableId]) })),
};
/**
 * Saber 11.° Matemáticas (2026-10-15): one bucket per official COMPETENCY (the objectives of v2.saber11.math), with the
 * V2.1 position totals 17 / 22 / 11 (OFFICIAL_DERIVED); each bucket places the concepts its constructs assess, every
 * one inside an official content category by a GOVERNED_PILOT correspondence (SABER-CONTENT-CORRESPONDENCE-2026-10-15).
 */
const SABER_FACTS: BlueprintSectionFacts = { itemBankable: true, declaredFixture: false, fullFormDocumented: true, distributionPartlyDocumented: true, officialItemCount: 50, governedSlots: 50 };
const SABER_CLASS = classifyBlueprintSection(SABER_FACTS);
const SABER_BUCKETS: [string, number, string[]][] = [
  ['saber.interpretacion', 17, ['math.stat.data-representation', 'math.fun.linear-functions-lines', 'math.geo.plane-figures-area-perimeter']],
  ['saber.formulacion', 22, ['math.stat.central-tendency', 'math.alg.linear-equations', 'math.geo.pythagorean-theorem']],
  ['saber.argumentacion', 11, ['math.stat.central-tendency', 'math.alg.linear-systems', 'math.geo.plane-figures-area-perimeter']],
];
export const LIBRARY_BLUEPRINT_SABER_MATH: LibraryBlueprint = {
  blueprintId: 'v2.saber11.math/math', classificationVersion: 'tb-saber-math-pilot-1', adapterId: 'ICFES.SABER11_MATEMATICAS', configKey: 'v2.saber11.math', sectionKey: 'math', facts: SABER_FACTS, blueprintClass: SABER_CLASS,
  buckets: SABER_BUCKETS.map(([objectiveCode, positions, concepts]) => ({ governedPositions: positions, conceptLinks: concepts.map((k) => `competency ${objectiveCode}; content category ${saberCorrespondenceOf(k)?.officialContentCategory} -> ${k} (GOVERNED_PILOT ${SABER_GOVERNANCE_DECISION.decisionId}, review PENDING)`), bucket: bucket('v2.saber11.math', 'math', 'ICFES.SABER11_MATEMATICAS', SABER_CLASS, objectiveCode, concepts) })),
};
export const LIBRARY_BLUEPRINT_PISA_MATH: LibraryBlueprint = {
  blueprintId: 'v2.pisa.math/math', classificationVersion: 'tb-pisa-math-pilot-1', adapterId: 'PISA.MATHEMATICS', configKey: 'v2.pisa.math', sectionKey: 'math', facts: PISA_FACTS, blueprintClass: PISA_CLASS,
  buckets: PISA_BUCKETS.map(([objectiveCode, stableId, name]) => ({ governedPositions: 1, conceptLinks: [`objective ${objectiveCode} -> ${name} (pisa-learning-links, DECLARED_REVIEWED; identity GOVERNED by the certified PAA record)`], bucket: bucket('v2.pisa.math', 'math', 'PISA.MATHEMATICS', PISA_CLASS, objectiveCode, [stableId]) })),
};
// ------------------------------------------------------------- Cambridge 9709 Paper 1 pilot classification
/**
 * v2.cambridge.9709-as / p1: one bucket per OFFICIAL syllabus section (1.1 ... 1.8), one governed position each,
 * placing the section's StudyUs concepts (cie-9709-p1-correspondence.ts). Reduced: 8 of the paper's 10 to 12
 * structured questions. Certification is decided by the object governance, never assumed here.
 */
const CIE_P1_FACTS: BlueprintSectionFacts = { itemBankable: true, declaredFixture: false, fullFormDocumented: false, distributionPartlyDocumented: false, officialItemCount: null, governedSlots: 8 };
const CIE_P1_CLASS = classifyBlueprintSection(CIE_P1_FACTS);
export const LIBRARY_BLUEPRINT_CIE_9709_P1: LibraryBlueprint = {
  blueprintId: 'v2.cambridge.9709-as/p1', classificationVersion: 'cie-9709-p1-pilot-1', adapterId: 'CAMBRIDGE.9709.P1', configKey: 'v2.cambridge.9709-as', sectionKey: 'p1', facts: CIE_P1_FACTS, blueprintClass: CIE_P1_CLASS,
  buckets: CIE_9709_P1_SECTIONS.map((s) => ({ governedPositions: 1, conceptLinks: [`syllabus 9709 ${s.section} ${s.title} (p. ${s.page}) -> ${s.concepts.map((c) => `${c.stableId} [${c.correspondenceType}]`).join(', ')} (PILOT correspondence, not human reviewed)`], bucket: bucket('v2.cambridge.9709-as', 'p1', 'CAMBRIDGE.9709.P1', CIE_P1_CLASS, s.objectiveCode, s.concepts.map((c) => c.stableId)) })),
};
/**
 * AICE 9709 AS Papers 2, 4 and 5 (2026-10-15): one bucket per AICE objective, each one official topic of its paper,
 * one governed position each, filled from the Cambridge 9709 P2 / P4 / P5 entries (PILOT equivalence). Reduced forms.
 */
const aicePaperBlueprint = (paper: Cie9709Paper): LibraryBlueprint => {
  const eqs = AICE_9709_P2P4P5_EQUIVALENCES.filter((e) => e.paper === paper);
  const facts: BlueprintSectionFacts = { itemBankable: true, declaredFixture: false, fullFormDocumented: false, distributionPartlyDocumented: false, officialItemCount: null, governedSlots: eqs.length };
  const cls = classifyBlueprintSection(facts);
  return {
    blueprintId: `v2.aice.9709-as/${paper}`, classificationVersion: `aice-9709-${paper}-eq-pilot-1`, adapterId: CIE_9709_PAPER_ADAPTER[paper], configKey: 'v2.aice.9709-as', sectionKey: paper, facts, blueprintClass: cls,
    buckets: eqs.map((eq) => ({ governedPositions: 1, conceptLinks: [`AICE ${eq.aiceObjectiveCode} = syllabus 9709 ${paper.toUpperCase()} topic "${eq.officialTopic}" -> ${eq.conceptStableId} (PILOT equivalence ${AICE_9709_P2P4P5_DECISION.decisionId}, not human reviewed)`], bucket: bucket('v2.aice.9709-as', paper, CIE_9709_PAPER_ADAPTER[paper], cls, eq.aiceObjectiveCode, [eq.conceptStableId]) })),
  };
};
export const LIBRARY_BLUEPRINT_AICE_9709_P2 = aicePaperBlueprint('p2');
export const LIBRARY_BLUEPRINT_AICE_9709_P4 = aicePaperBlueprint('p4');
export const LIBRARY_BLUEPRINT_AICE_9709_P5 = aicePaperBlueprint('p5');
export const LIBRARY_BLUEPRINT_EXTENSIONS: readonly LibraryBlueprint[] = [LIBRARY_BLUEPRINT_IB_P1_ALGEBRA_CALCULUS, LIBRARY_BLUEPRINT_IB_P2_STATISTICS, LIBRARY_BLUEPRINT_CIE_9709_P1, LIBRARY_BLUEPRINT_IB_P1_EXTENDED, LIBRARY_BLUEPRINT_IB_P2_TRIG_EXTENDED, LIBRARY_BLUEPRINT_PISA_MATH, LIBRARY_BLUEPRINT_AICE_9709_P1, LIBRARY_BLUEPRINT_SABER_MATH, LIBRARY_BLUEPRINT_IB_P3_INVESTIGATION, LIBRARY_BLUEPRINT_AICE_9709_P2, LIBRARY_BLUEPRINT_AICE_9709_P4, LIBRARY_BLUEPRINT_AICE_9709_P5];
export const PUBLICATION_BLUEPRINTS: readonly LibraryBlueprint[] = [...LIBRARY_BLUEPRINTS, ...LIBRARY_BLUEPRINT_EXTENSIONS];
/** The classifications AS THEY WERE on 2026-10-14: the input of the batches published that day. */
export const PUBLICATION_BLUEPRINTS_2026_10_14: readonly LibraryBlueprint[] = [...LIBRARY_BLUEPRINTS, LIBRARY_BLUEPRINT_IB_P1_ALGEBRA_CALCULUS, LIBRARY_BLUEPRINT_IB_P2_STATISTICS, LIBRARY_BLUEPRINT_CIE_9709_P1];
/** The classifications AS THEY WERE when PISA, AICE and Saber A1/A2 were published (2026-10-15, before IB Paper 3). */
export const PUBLICATION_BLUEPRINTS_2026_10_15_ALL: readonly LibraryBlueprint[] = [...PUBLICATION_BLUEPRINTS_2026_10_14, LIBRARY_BLUEPRINT_IB_P1_EXTENDED, LIBRARY_BLUEPRINT_IB_P2_TRIG_EXTENDED, LIBRARY_BLUEPRINT_PISA_MATH, LIBRARY_BLUEPRINT_AICE_9709_P1, LIBRARY_BLUEPRINT_SABER_MATH];
/** The classifications AS THEY WERE when TB-IB-AAHL-P3-A1 was published (2026-10-15, before AICE P2/P4/P5). */
export const PUBLICATION_BLUEPRINTS_2026_10_15_P3: readonly LibraryBlueprint[] = [...PUBLICATION_BLUEPRINTS_2026_10_15_ALL, LIBRARY_BLUEPRINT_IB_P3_INVESTIGATION];
/** The classifications AS THEY WERE when TB-IB-AAHL-EXT-A1 was published (2026-10-15, before PISA and AICE). */
export const PUBLICATION_BLUEPRINTS_2026_10_15_IB: readonly LibraryBlueprint[] = [...PUBLICATION_BLUEPRINTS_2026_10_14, LIBRARY_BLUEPRINT_IB_P1_EXTENDED, LIBRARY_BLUEPRINT_IB_P2_TRIG_EXTENDED];

// ----------------------------------------------------------------------------------------------------- entries
export interface LibraryTarget { adapterId: string; language: string; responseFormat: string; /** The command term the construct's wording uses, from the adapter's vocabulary. Absent = the policy's choice. */ commandTerm?: string; /** The governed objective the entry is written for: it is placed in that objective's bucket. Absent = the first classification that places the concept (as before). */ objectiveCode?: string }
export interface LibraryEntry {
  core: ConstructCoreRecord;
  envelope: RendererEnvelope;
  construct: ParametricConstruct;
  strategy: RenderingStrategy;
  targets: readonly LibraryTarget[];
  reasoning: LibraryReasoning;
  /** What makes the hardest band hard, by name. A CHALLENGE band with no named mechanism is not certifiable. */
  challengeMechanisms: readonly DifficultyMechanism[];
  /** Where the entry comes from: an object the pilot reviewer approved in Step 4B, new in V5.2 and seen by nobody, or adopted from a Content Factory package. */
  origin: 'STEP4B_PILOT' | 'QF52_NEW' | 'CF_PACKAGE' | 'TRACK_B_DETERMINISTIC';
  /** CF_PACKAGE: the package candidates to render, by planning band (seeds naming each candidate's parameter set). Absent = the batch draws its own seeds. */
  packageSeeds?: Readonly<Partial<Record<PlanningBand, readonly string[]>>>;
}
const PAA_TARGET: LibraryTarget = { adapterId: PILOT_PAA, language: 'es', responseFormat: 'NUMERIC_ENTRY' };
const IB_TARGET: LibraryTarget = { adapterId: PILOT_IB, language: 'en', responseFormat: 'SHORT_RESPONSE' };
const entry = (core: ConstructCoreRecord, env: RendererEnvelope, construct: unknown, strategy: RenderingStrategy, targets: LibraryTarget[], challengeMechanisms: DifficultyMechanism[], origin: LibraryEntry['origin']): LibraryEntry => ({ core, envelope: env, construct: construct as ParametricConstruct, strategy, targets, reasoning: REASONING[core.constructFamilyId], challengeMechanisms, origin });
export const LIBRARY: readonly LibraryEntry[] = [
  entry(PILOT_CORE_QUADRATIC, PILOT_ENVELOPE_QUADRATIC, QUADRATIC_SOLVE, QUADRATIC_SOLVE_STRATEGY, [PAA_TARGET, IB_TARGET], ['MULTI_STAGE_DEPENDENCY'], 'STEP4B_PILOT'),
  entry(PILOT_CORE_PROPORTION, PILOT_ENVELOPE_PROPORTION, PROPORTION_MISSING_VALUE, PROPORTION_MISSING_VALUE_STRATEGY, [PAA_TARGET], ['MULTI_STAGE_DEPENDENCY'], 'STEP4B_PILOT'),
  entry(CORE_LINE, ENVELOPE_LINE, LINE_SLOPE, parametricStrategy(LINE_SLOPE), [PAA_TARGET], ['MISCONCEPTION_RESISTANCE'], 'QF52_NEW'),
  entry(CORE_DRAW, ENVELOPE_DRAW, SINGLE_DRAW, parametricStrategy(SINGLE_DRAW), [PAA_TARGET], ['MULTI_STAGE_DEPENDENCY'], 'QF52_NEW'),
  entry(CORE_TRIANGLE, ENVELOPE_TRIANGLE, RIGHT_TRIANGLE, parametricStrategy(RIGHT_TRIANGLE), [PAA_TARGET], ['TRANSFER'], 'QF52_NEW'),
  entry(CORE_MEAN, ENVELOPE_MEAN, DATA_SET_MEAN, parametricStrategy(DATA_SET_MEAN), [PAA_TARGET], ['NON_OBVIOUS_STRATEGY'], 'QF52_NEW'),
  entry(CORE_PERCENT, ENVELOPE_PERCENT, PERCENT, parametricStrategy(PERCENT), [PAA_TARGET], ['NON_OBVIOUS_STRATEGY'], 'QF52_NEW'),
  entry(CORE_EQUATION, ENVELOPE_EQUATION, LINEAR_EQUATION, parametricStrategy(LINEAR_EQUATION), [PAA_TARGET], ['MULTI_STAGE_DEPENDENCY'], 'QF52_NEW'),
  entry(CORE_SYSTEM, ENVELOPE_SYSTEM, LINEAR_SYSTEM, parametricStrategy(LINEAR_SYSTEM), [PAA_TARGET], ['MULTI_STAGE_DEPENDENCY'], 'QF52_NEW'),
  entry(CORE_RECTANGLE, ENVELOPE_RECTANGLE, RECTANGLE, parametricStrategy(RECTANGLE), [PAA_TARGET], ['MULTI_STAGE_DEPENDENCY'], 'QF52_NEW'),
];
/**
 * Entries adopted AFTER the QF V5.2 run, published by the Exam Bank loader in a batch of their own. `LIBRARY` stays the
 * archived V5.2 library exactly (its run and its artefacts are frozen); publication reads `PUBLICATION_LIBRARY`.
 *   CF-IB-AAHL-01 first delivery: ONE certified item of the quadratic-minimum construct (IB SHORT_RESPONSE, answer marks).
 */
export interface LibraryExtensionBatch { batchId: string; entries: readonly LibraryEntry[] }
/**
 * Each extension batch is published with inputs and a hash of its own, so adding a batch never changes one already
 * published. CF-IB-AAHL-01: the first-delivery item. CF-IB-AAHL-01-A2: the eight further CF constructs, re-projected
 * into SHORT_RESPONSE (cf-ib-aahl-01.adoption.ts).
 */
export const LIBRARY_EXTENSION_BATCHES: readonly LibraryExtensionBatch[] = [
  { batchId: 'CF-IB-AAHL-01', entries: [CF_QUADRATIC_MINIMUM_FIRST_DELIVERY] },
  { batchId: 'CF-IB-AAHL-01-A2', entries: CF_IB_AAHL_01_ADOPTED },
  // Cambridge 9709 Paper 1: the eight StudyUs-original constructs, one per official section (cie-9709-p1.adoption.ts)
  { batchId: 'CIE-9709-P1-A1', entries: CIE_9709_P1_ENTRIES },
  // IB 6/9 -> 9/9: P1 extended, P2 trigonometry, P2 extended (ib-aahl-ext.adoption.ts)
  { batchId: 'TB-IB-AAHL-EXT-A1', entries: IB_AAHL_EXT_ENTRIES },
  // PISA 2022 Mathematics: one construct per objective (pisa-math.adoption.ts)
  { batchId: 'TB-PISA-MATH-A1', entries: PISA_MATH_ENTRIES },
  // AICE 9709 AS Paper 1: the governed Cambridge 9709 P1 entries in the AICE P1 buckets (PILOT equivalence)
  { batchId: 'AICE-9709-P1-EQ-A1', entries: AICE_9709_P1_ENTRIES },
  // Saber 11 Matemáticas: nine SELECTED_RESPONSE constructs, competency x content category (saber11-math.adoption.ts)
  { batchId: 'TB-SABER-MATH-A1', entries: SABER_MATH_ENTRIES },
  // Saber 11: the same constructs in several situations each (template variety for the 50-position form)
  { batchId: 'TB-SABER-MATH-A2', entries: SABER_MATH_IN_CONTEXT_ENTRIES },
  // IB Paper 3: the investigation construct for aahl.p3.investigation (ib-aahl-p3.adoption.ts)
  { batchId: 'TB-IB-AAHL-P3-A1', entries: IB_AAHL_P3_ENTRIES },
  // AICE 9709 AS Papers 2, 4, 5: the Cambridge 9709 P2/P4/P5 entries in the AICE buckets (PILOT equivalence)
  { batchId: 'AICE-9709-P2P4P5-A1', entries: AICE_9709_P2P4P5_ENTRIES },
];
export const LIBRARY_EXTENSIONS: readonly LibraryEntry[] = LIBRARY_EXTENSION_BATCHES.flatMap((b) => b.entries);
export const PUBLICATION_LIBRARY: readonly LibraryEntry[] = [...LIBRARY, ...LIBRARY_EXTENSIONS];
export const libraryEntryOf = (constructFamilyId: string): LibraryEntry | null => LIBRARY.find((e) => e.core.constructFamilyId === constructFamilyId) ?? null;

// one strategy per construct: an entry placed in a second bucket (AICE 9709 P1) reuses its construct's strategy
const renderer = createAssessmentInstanceRenderer([...new Map(PUBLICATION_LIBRARY.map((e) => [e.strategy.construct, e.strategy] as const)).values()]);
export const libraryApplicability = (core: ConstructCoreRecord, adapterId: string, register: readonly AssessmentApplicabilityRecord[] = PUBLICATION_APPLICABILITY): CoreApplicabilityRecord => deriveCoreApplicability(core, { systemProfileId: adapterId.split('.')[0], componentId: adapterId }, register, applicabilityThresholdFor(adapterId.split('.')[0]));
export const libraryBucketOf = (core: ConstructCoreRecord, adapterId: string, objectiveCode?: string): { bucket: BlueprintBucketRef; blueprint: LibraryBlueprint } | null => {
  // the governed classification of the component that places the concept (an extension never re-places a base concept);
  // an entry written for a named objective is placed only in that objective's bucket
  for (const blueprint of PUBLICATION_BLUEPRINTS) { const hit = blueprint.adapterId === adapterId ? blueprint.buckets.find((b) => b.bucket.primaryConceptStableIds.includes(core.primaryConceptStableId) && (!objectiveCode || b.bucket.objectiveCode === objectiveCode)) : undefined; if (hit) return { bucket: hit.bucket, blueprint }; }
  return null;
};

export interface LibraryRender { rendered: RenderedInstance; certifiedLineage: CertifiedInstanceLineage; envelopeIssues: EnvelopeIssue[]; applicability: CoreApplicabilityRecord; bucket: BlueprintBucketRef; blueprint: LibraryBlueprint; planningBand: PlanningBand; target: LibraryTarget; entry: LibraryEntry; commandTerm: string | null; seed: string }
export type LibraryRenderResult = { ok: true; value: LibraryRender } | { ok: false; code: string; detail: string };
/**
 * One instance of a library entry: composed and rendered through the composer and the renderer a delivery uses,
 * in DEV_TEST use (rendering certifies nothing), then placed against its envelope. No decision is taken here.
 */
export function renderLibraryInstance(e: LibraryEntry, target: LibraryTarget, planningBand: PlanningBand, seed: string, register: readonly AssessmentApplicabilityRecord[] = PUBLICATION_APPLICABILITY): LibraryRenderResult {
  const registry = STUDYUS_ASSESSMENT_REGISTRY;
  const adapter = registry.adapter(target.adapterId);
  const pair = registry.profilePairOf(target.adapterId);
  const placed = libraryBucketOf(e.core, target.adapterId, target.objectiveCode);
  if (!adapter || !pair) return { ok: false, code: 'ADAPTER_NOT_REGISTERED', detail: target.adapterId };
  if (!placed) return { ok: false, code: 'NO_GOVERNED_BUCKET_FOR_THE_CONCEPT', detail: `${e.core.primaryConceptStableId} x ${target.adapterId}` };
  const applicability = libraryApplicability(e.core, target.adapterId, register);
  const spec = composeAssessmentSpecification({
    use: 'DEV_TEST', registry, core: e.core, adapter, system: pair.system, component: pair.component, coreApplicability: [applicability], applicabilityRegister: register, applicabilityPolicy: applicabilityThresholdFor(target.adapterId.split('.')[0]), bucket: placed.bucket, disciplinePolicy: MATHEMATICS_ADAPTATION_POLICY,
    request: { purpose: 'PRACTICE', difficultyBand: planningBand, language: target.language, contentUseClass: 'DEV_TEST_CONTENT', responseFormat: target.responseFormat, ...(target.commandTerm ? { commandTerm: target.commandTerm } : {}) },
  });
  if (!spec.ok) return { ok: false, code: spec.code, detail: spec.detail };
  const r = renderer.render({ use: 'DEV_TEST', registry, core: e.core, adapter, applicability: spec.applicability, specification: spec.specification, bucket: spec.bucket, seed });
  if (!r.ok) return { ok: false, code: r.code, detail: r.detail };
  const lineage = certifiedInstanceLineageOf(e.envelope, r.instance, planningBand);
  if (!lineage.ok) return { ok: false, code: lineage.code, detail: lineage.detail };
  const envelopeIssues = instanceEnvelopeIssues(e.envelope, r.instance, { adapterId: target.adapterId, language: target.language, responseFormat: target.responseFormat, planningBand, commandTerm: spec.specification.variable.commandTerm ?? null }, (band, p) => e.construct.bandIssues(band as PlanningBand, p));
  return { ok: true, value: { rendered: r.instance, certifiedLineage: lineage.value, envelopeIssues, applicability, bucket: placed.bucket, blueprint: placed.blueprint, planningBand, target, entry: e, commandTerm: spec.specification.variable.commandTerm ?? null, seed } };
}
