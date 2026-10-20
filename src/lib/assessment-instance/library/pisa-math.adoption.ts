/**
 * PISA 2022 Mathematics -- the eight StudyUs-original constructs (pisa-math.constructs.ts) as governed library entries,
 * one per objective (content area x process) of v2.pisa.math, adapter PISA.MATHEMATICS, Spanish, NUMERIC_ENTRY (a
 * format the PISA component records), an authentic context in the prompt (the PISA profile requires one).
 *
 * Concepts: every one is an EXISTING StudyUs canonical concept governed by its certified PAA record, and named by the
 * reviewed PISA objective -> concept link (pisa-learning-links.ts). No concept is created; nothing claims to be an
 * official PISA item. Written by the model, reviewed by nobody.
 */
import type { ParametricConstruct } from './parametric';
import type { LibraryEntry } from './catalogue';
import { adoptParametricConstruct, type AdoptionOptions, type AdoptionSpec } from './cf-ib-aahl-01.adoption';
import { PISA_BEST_BUY_UNIT_RATE, PISA_EQUAL_TARIFFS, PISA_MISSING_VALUE_FROM_MEAN, PISA_PATH_AROUND_A_LAWN, PISA_SHADOW_HEIGHT, PISA_SUCCESSIVE_PERCENTAGES, PISA_TICKETS_SYSTEM, PISA_TWO_WAY_TABLE_PROBABILITY } from './pisa-math.constructs';
import { ASSESSMENT_APPLICABILITY_CONTRACT_VERSION, type AssessmentApplicabilityRecord } from '@/lib/assessment-adaptation/assessment-applicability';

const A = 'PISA.MATHEMATICS';
const OPTIONS: AdoptionOptions = { system: 'PISA', provenanceNote: 'Track B: StudyUs-original deterministic construct for PISA 2022 Mathematics practice, written in-session by the model; reviewed by nobody. No PISA unit, item or wording is copied.', referenceSourceKeys: ['oecd-pisa-2022-framework', 'oecd-pisa-2022-math-site'], origin: 'TRACK_B_DETERMINISTIC', language: 'es', responseFormat: 'NUMERIC_ENTRY', marksByBand: null };
const ANSWER = (what: string) => ({ id: 'answer-equals-a-misconception', bypass: `A learner who ${what} would be marked right if the key equalled that value.`, instanceRule: 'Parameter sets whose key a modelled misconception also gives are dropped.' });
const c = (x: unknown) => x as ParametricConstruct<never>;
const M = (stableId: string, canonicalName: string) => ({ stableId, canonicalName, canonicalSubject: 'Matemáticas' });

export const PISA_MATH_ADOPTION_SPECS: readonly AdoptionSpec[] = [
  {
    construct: c(PISA_BEST_BUY_UNIT_RATE), familyId: 'tf.pisa.quantity.best-buy-unit-rate', adapterId: A, objectiveCode: 'pisa.cantidad.formular', contexts: [{ kind: 'PERSONAL', note: 'Choosing the better buy between two packs in a supermarket.' }],
    concept: M('math.num.ratio-proportion', 'Proporcionalidad'), skill: 'Razonamiento proporcional', action: 'COMPUTE', alsoActions: ['FORMULATE'],
    object: 'Two packs of the same product with different sizes and prices.', observable: 'Formulates the comparison as a price per unit and gives the unit price of the cheaper pack.',
    structure: 'Unit price = pack price / pack size; the cheaper pack minimises it.',
    variables: [{ symbol: 'a', meaning: 'Size of pack A', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'pa', meaning: 'Price of pack A (cents)', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'b', meaning: 'Size of pack B', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'pb', meaning: 'Price of pack B (cents)', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'u', meaning: 'The lower unit price (cents)', role: 'UNKNOWN', domain: 'INTEGER' }],
    relationships: ['u = min(pa / a, pb / b)'], constraints: ['Both unit prices are whole cents and differ.'],
    misconceptions: [{ id: 'chooses-the-other-pack', description: 'Chooses the more expensive pack per unit (the bigger one, or the cheaper total).', producesError: 'the other unit price' }, { id: 'gives-the-pack-price', description: 'Gives the price of the pack instead of the unit price.', producesError: 'pack price' }, { id: 'gives-the-difference-of-unit-prices', description: 'Gives the difference of the unit prices.', producesError: '|ua - ub|' }],
    levers: { FOUNDATIONAL: ['The bigger pack is clearly cheaper per unit.'], STANDARD: ['The smaller pack is clearly cheaper per unit (the bigger pack is a trap).'], CHALLENGE: ['The unit prices differ by at most 4 cents.'] },
    exclusions: ['Two packs only; no offers of the kind "3 for 2".'], challenge: 'MISCONCEPTION_RESISTANCE',
    path: ['Compute each price per unit (or compare a common quantity).', 'Choose the lower and give it in cents.'], strategies: ['UNIT_RATE', 'COMMON_QUANTITY'], shortcut: ANSWER('chooses the bigger pack'),
  },
  {
    construct: c(PISA_SUCCESSIVE_PERCENTAGES), familyId: 'tf.pisa.quantity.successive-percentages', adapterId: A, objectiveCode: 'pisa.cantidad.emplear', contexts: [{ kind: 'PERSONAL', note: 'A discount and a charge on a purchase, or a seasonal rise and a student discount.' }],
    concept: M('math.num.percent', 'Porcentajes'), skill: 'Razonamiento proporcional', action: 'COMPUTE', alsoActions: ['INTERPRET'],
    object: 'A price changed by two successive percentages, the second on the changed price.', observable: 'Applies the two percentages in order as multipliers and gives the final price.',
    structure: 'Final = P × (1 ∓ d/100) × (1 ± s/100); the second percentage is of the changed price.',
    variables: [{ symbol: 'p', meaning: 'Initial price (euros)', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'd', meaning: 'Discount (%)', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 's', meaning: 'Surcharge or rise (%)', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'order', meaning: 'Which change comes first', role: 'PARAMETER', domain: 'CATEGORY' }, { symbol: 'f', meaning: 'The final price', role: 'UNKNOWN', domain: 'RATIONAL' }],
    relationships: ['f = p (100 - d)(100 + s) / 10000'], constraints: ['The final price is a whole number of euros.'],
    misconceptions: [{ id: 'adds-the-percentages', description: 'Combines the percentages by adding them on the original price.', producesError: 'p (100 - d + s) / 100' }, { id: 'applies-only-the-first', description: 'Applies only the first change.', producesError: 'p (100 ∓ first) / 100' }, { id: 'treats-percentages-as-euros', description: 'Subtracts and adds the percentages as euros.', producesError: 'p - d + s' }],
    levers: { FOUNDATIONAL: ['Discount then charge, both multiples of ten.'], STANDARD: ['Discount then charge, not both multiples of ten.'], CHALLENGE: ['Rise then discount (the order is reversed).'] },
    exclusions: ['Two successive percentage changes only.'], challenge: 'MISCONCEPTION_RESISTANCE',
    path: ['Apply the first change.', 'Apply the second change to the new price.'], strategies: ['MULTIPLIERS', 'STEP_BY_STEP'], shortcut: ANSWER('adds the percentages'),
  },
  {
    construct: c(PISA_MISSING_VALUE_FROM_MEAN), familyId: 'tf.pisa.uncertainty.missing-value-from-mean', adapterId: A, objectiveCode: 'pisa.incertidumbre.interpretar', contexts: [{ kind: 'SOCIETAL', note: 'Weekly amounts collected at a neighbourhood recycling point.' }],
    concept: M('math.stat.central-tendency', 'Medidas de tendencia central'), skill: 'Razonamiento estadístico y probabilístico', action: 'COMPUTE', alsoActions: ['INTERPRET'],
    object: 'Five weekly data with one missing and the mean of the five.', observable: 'Interprets the mean as a total and recovers the missing value.',
    structure: 'missing = 5 × mean − (sum of the four known values).',
    variables: [{ symbol: 'w1', meaning: 'Known value 1', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'w2', meaning: 'Known value 2', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'w3', meaning: 'Known value 3', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'w4', meaning: 'Known value 4', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'mean', meaning: 'Mean of the five', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'missing', meaning: 'Which week is missing', role: 'PARAMETER', domain: 'INTEGER' }, { symbol: 'x', meaning: 'The missing value', role: 'UNKNOWN', domain: 'INTEGER' }],
    relationships: ['w1 + w2 + w3 + w4 + x = 5 mean'], constraints: ['The missing value is a positive whole number.'],
    misconceptions: [{ id: 'gives-the-mean', description: 'Gives the mean as the missing value.', producesError: 'mean' }, { id: 'averages-the-four-known', description: 'Averages the four known values.', producesError: '(w1 + w2 + w3 + w4) / 4' }, { id: 'divides-by-four', description: 'Uses 4 instead of 5 for the number of data.', producesError: '4 mean - sum' }],
    levers: { FOUNDATIONAL: ['The last week is missing; the mean is a multiple of 5.'], STANDARD: ['The last week is missing; the mean is not a multiple of 5.'], CHALLENGE: ['A middle week is missing and the missing value is an extreme of the data.'] },
    exclusions: ['The mean only; median and mode are not asked by this construct.'], challenge: 'MULTI_STAGE_DEPENDENCY',
    path: ['Multiply the mean by the number of data.', 'Subtract the known values.'], strategies: ['TOTAL_FROM_MEAN', 'DEVIATIONS_FROM_THE_MEAN'], shortcut: ANSWER('gives the mean'),
  },
  {
    construct: c(PISA_TWO_WAY_TABLE_PROBABILITY), familyId: 'tf.pisa.uncertainty.two-way-table-probability', adapterId: A, objectiveCode: 'pisa.incertidumbre.razonar', contexts: [{ kind: 'SOCIETAL', note: 'A school survey of how students travel to school.' }],
    concept: M('math.prob.probability', 'Probabilidad'), skill: 'Razonamiento estadístico y probabilístico', action: 'COMPUTE', alsoActions: ['EVALUATE'],
    object: 'A two-way table of counts (transport x grade) and an event worded on it.', observable: 'Identifies the possible and the favourable cases of the event as worded and gives the probability as an irreducible fraction.',
    structure: 'P = favourable / possible, the possible cases being the whole survey or the row / column the condition names.',
    variables: [{ symbol: 'busA', meaning: 'Bus, ninth grade', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'busB', meaning: 'Bus, tenth grade', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'bikeA', meaning: 'Bicycle, ninth grade', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'bikeB', meaning: 'Bicycle, tenth grade', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'ask', meaning: 'Which event', role: 'PARAMETER', domain: 'CATEGORY' }, { symbol: 'P', meaning: 'The probability', role: 'UNKNOWN', domain: 'RATIONAL' }],
    relationships: ['P = bikeA / possible'], constraints: ['The probability is strictly between 0 and 1.'],
    misconceptions: [{ id: 'uses-the-whole-survey', description: 'Divides by the whole survey when a condition is given.', producesError: 'bikeA / all' }, { id: 'conditions-on-the-wrong-variable', description: 'Conditions on the row instead of the column (or vice versa).', producesError: 'bikeA / other margin' }, { id: 'divides-by-the-complement', description: 'Divides the favourable by the unfavourable cases.', producesError: 'bikeA / (all - bikeA)' }],
    levers: { FOUNDATIONAL: ['A joint event over the whole survey.'], STANDARD: ['Conditioned on the transport.'], CHALLENGE: ['Conditioned on the grade.'] },
    exclusions: ['One event read from one two-way table.'], challenge: 'MISCONCEPTION_RESISTANCE',
    path: ['Find the possible cases the event is drawn from.', 'Find the favourable cases.', 'Give the irreducible fraction.'], strategies: ['DIRECT_COUNT', 'RESTRICTED_SAMPLE_SPACE'], shortcut: ANSWER('divides by the whole survey'),
  },
  {
    construct: c(PISA_EQUAL_TARIFFS), familyId: 'tf.pisa.change.equal-tariffs', adapterId: A, objectiveCode: 'pisa.cambio.formular', contexts: [{ kind: 'PERSONAL', note: 'Comparing the prices of two taxi companies.' }],
    concept: M('math.alg.linear-equations', 'Ecuaciones lineales'), skill: 'Razonamiento algebraico', action: 'SOLVE', alsoActions: ['FORMULATE'],
    object: 'Two linear tariffs (fixed fee plus a price per kilometre).', observable: 'Formulates the equality of the two tariffs as a linear equation and solves it for the distance.',
    structure: 'f1 + r1 k = f2 + r2 k ⇒ k = (f2 − f1) / (r1 − r2).',
    variables: [{ symbol: 'f1', meaning: 'Fixed fee 1 (cents)', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'r1', meaning: 'Rate 1 (cents/km)', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'f2', meaning: 'Fixed fee 2 (cents)', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'r2', meaning: 'Rate 2 (cents/km)', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'k', meaning: 'The distance (km)', role: 'UNKNOWN', domain: 'INTEGER' }],
    relationships: ['f1 + r1 k = f2 + r2 k'], constraints: ['The distance is a whole number of kilometres from 2 to 40.'],
    misconceptions: [{ id: 'divides-the-fixed-fees', description: 'Divides the fixed fees.', producesError: 'f2 / f1' }, { id: 'adds-the-rates', description: 'Adds the rates instead of subtracting them.', producesError: '(f2 - f1) / (r1 + r2)' }, { id: 'gives-the-common-price-in-euros', description: 'Gives the common price instead of the distance.', producesError: 'f1 + r1 k' }],
    levers: { FOUNDATIONAL: ['Both fixed fees are whole euros; the rates differ by at least 0,50 €.'], STANDARD: ['Both fixed fees are whole euros; the rates differ by less than 0,50 €.'], CHALLENGE: ['Neither fixed fee is a whole number of euros.'] },
    exclusions: ['Two linear tariffs; no stepwise tariffs.'], challenge: 'NON_OBVIOUS_STRATEGY',
    path: ['Write the price of each company for k km.', 'Set the prices equal.', 'Solve for k.'], strategies: ['LINEAR_EQUATION', 'TABLE_OF_VALUES', 'GRAPHS'], shortcut: ANSWER('adds the rates'),
  },
  {
    construct: c(PISA_TICKETS_SYSTEM), familyId: 'tf.pisa.change.tickets-system', adapterId: A, objectiveCode: 'pisa.cambio.razonar', contexts: [{ kind: 'SOCIETAL', note: 'Ticket sales for a school play.' }],
    concept: M('math.alg.linear-systems', 'Sistemas de ecuaciones'), skill: 'Razonamiento algebraico', action: 'SOLVE', alsoActions: ['EVALUATE'],
    object: 'Two totals (tickets and takings) and two ticket prices.', observable: 'Reasons with the two totals (a system of two linear equations) and gives the number of adult tickets.',
    structure: 'a + c = n, pa a + pc c = t ⇒ a = (t − pc n) / (pa − pc).',
    variables: [{ symbol: 'adults', meaning: 'Adult tickets', role: 'UNKNOWN', domain: 'INTEGER' }, { symbol: 'children', meaning: 'Child tickets', role: 'PARAMETER', domain: 'INTEGER' }, { symbol: 'pa', meaning: 'Adult price', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'pc', meaning: 'Child price', role: 'GIVEN', domain: 'INTEGER' }],
    relationships: ['a + c = n', 'pa a + pc c = t'], constraints: ['Both numbers of tickets are positive and different.'],
    misconceptions: [{ id: 'gives-the-children', description: 'Gives the number of child tickets.', producesError: 'children' }, { id: 'divides-takings-by-adult-price', description: 'Divides the takings by the adult price.', producesError: 't / pa' }, { id: 'splits-the-total-in-half', description: 'Splits the tickets in half.', producesError: 'n / 2' }],
    levers: { FOUNDATIONAL: ['The adult ticket costs twice the child ticket; up to 60 tickets.'], STANDARD: ['Other prices, up to 60 tickets.'], CHALLENGE: ['More than 60 tickets.'] },
    exclusions: ['Two kinds of ticket only.'], challenge: 'MULTI_STAGE_DEPENDENCY',
    path: ['Write the two equations.', 'Eliminate the child tickets.', 'Solve for the adult tickets.'], strategies: ['ELIMINATION', 'SUBSTITUTION', 'ALL_CHILDREN_ASSUMPTION'], shortcut: ANSWER('gives the child tickets'),
  },
  {
    construct: c(PISA_PATH_AROUND_A_LAWN), familyId: 'tf.pisa.space.path-around-a-lawn', adapterId: A, objectiveCode: 'pisa.espacio.emplear', contexts: [{ kind: 'OCCUPATIONAL', note: 'Planning a path of constant width around a lawn.' }],
    concept: M('math.geo.plane-figures-area-perimeter', 'Área y perímetro'), skill: 'Razonamiento geométrico', action: 'COMPUTE', alsoActions: ['INTERPRET'],
    object: 'A rectangle with a frame of constant width around it.', observable: 'Employs the area of rectangles (outer minus inner, or strips) to give the area of the frame.',
    structure: 'Path area = (L + 2w)(W + 2w) − L W.',
    variables: [{ symbol: 'L', meaning: 'Lawn length (m)', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'W', meaning: 'Lawn width (m)', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'w', meaning: 'Path width (m)', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'A', meaning: 'Path area (m²)', role: 'UNKNOWN', domain: 'INTEGER' }],
    relationships: ['A = (L + 2w)(W + 2w) - L W'], constraints: ['The lawn is longer than it is wide.'],
    misconceptions: [{ id: 'forgets-the-corners', description: 'Adds four strips and forgets the corners.', producesError: '2Lw + 2Ww' }, { id: 'gives-the-outer-area', description: 'Gives the area of the outer rectangle.', producesError: '(L + 2w)(W + 2w)' }, { id: 'adds-the-width-once', description: 'Adds the path width once to each side length.', producesError: '(L + w)(W + w) - LW' }],
    levers: { FOUNDATIONAL: ['Path 1 m wide.'], STANDARD: ['Path 2 m wide.'], CHALLENGE: ['Path 3 m wide.'] },
    exclusions: ['Rectangular frames only.'], challenge: 'MISCONCEPTION_RESISTANCE',
    path: ['Find the outer dimensions.', 'Subtract the lawn from the outer rectangle.'], strategies: ['OUTER_MINUS_INNER', 'STRIPS_AND_CORNERS'], shortcut: ANSWER('forgets the corners'),
  },
  {
    construct: c(PISA_SHADOW_HEIGHT), familyId: 'tf.pisa.space.shadow-height', adapterId: A, objectiveCode: 'pisa.espacio.interpretar', contexts: [{ kind: 'SCIENTIFIC', note: 'Measuring a height from shadows at the same time of day.' }],
    concept: M('math.geo.similarity-congruence', 'Semejanza de triángulos'), skill: 'Razonamiento geométrico', action: 'COMPUTE', alsoActions: ['INTERPRET'],
    object: 'A vertical stick and a tree with their shadows at the same time.', observable: 'Interprets the situation as similar right triangles and gives the height of the tree.',
    structure: 'tree / tree shadow = stick / stick shadow (units converted).',
    variables: [{ symbol: 'h', meaning: 'Stick height (cm)', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 's', meaning: 'Stick shadow (cm)', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'S', meaning: 'Tree shadow (m)', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'H', meaning: 'Tree height (m)', role: 'UNKNOWN', domain: 'INTEGER' }],
    relationships: ['H / S = h / s'], constraints: ['The height is a whole number of metres.'],
    misconceptions: [{ id: 'inverts-the-ratio', description: 'Uses shadow over height.', producesError: 's S / h' }, { id: 'adds-the-difference', description: 'Adds the difference between stick and shadow.', producesError: 'S + (h - s)' }, { id: 'gives-the-shadow', description: 'Gives the shadow of the tree.', producesError: 'the tree shadow S' }],
    levers: { FOUNDATIONAL: ['The stick is twice (or half) its shadow.'], STANDARD: ['Another ratio; the stick is shorter than its shadow.'], CHALLENGE: ['The stick is longer than its shadow, not twice it.'] },
    exclusions: ['Similar right triangles from shadows only.'], challenge: 'TRANSFER',
    path: ['Recognise two similar triangles.', 'Write the proportion.', 'Solve for the height.'], strategies: ['PROPORTION', 'SCALE_FACTOR'], shortcut: ANSWER('inverts the ratio'),
  },
];

export const PISA_MATH_ENTRIES: readonly LibraryEntry[] = PISA_MATH_ADOPTION_SPECS.map((s) => adoptParametricConstruct(s, OPTIONS));

/**
 * The PISA register for the concepts the constructs assess that the EA-1 register does not already hold (it holds
 * math.num.ratio-proportion and math.prob.probability for PISA). Each record is the reviewed PISA objective -> concept
 * link the repository already holds (pisa-learning-links.ts, DECLARED_REVIEWED): a fact, not a decision.
 */
const PISA_SCOPE = { systemProfileId: 'PISA', subject: 'Matemáticas', componentId: A };
const linked = (stableId: string, objectiveCode: string): AssessmentApplicabilityRecord => ({
  v: ASSESSMENT_APPLICABILITY_CONTRACT_VERSION, concept: { stableId, canonicalSubject: 'Matemáticas' }, scope: PISA_SCOPE, basis: 'REVIEWED_CATALOGUE_LINK',
  evidence: [{ kind: 'OBJECTIVE_CONCEPT_LINK', reference: objectiveCode, recordedIn: 'src/lib/exam-core/catalog/pisa-learning-links.ts', sourceReference: null, reviewState: 'DECLARED_REVIEWED' }],
});
export const PISA_MATH_APPLICABILITY: readonly AssessmentApplicabilityRecord[] = [
  linked('math.num.percent', 'pisa.cantidad.emplear'),
  linked('math.stat.central-tendency', 'pisa.incertidumbre.interpretar'),
  linked('math.alg.linear-equations', 'pisa.cambio.formular'),
  linked('math.alg.linear-systems', 'pisa.cambio.razonar'),
  linked('math.geo.plane-figures-area-perimeter', 'pisa.espacio.emplear'),
  linked('math.geo.similarity-congruence', 'pisa.espacio.interpretar'),
];
