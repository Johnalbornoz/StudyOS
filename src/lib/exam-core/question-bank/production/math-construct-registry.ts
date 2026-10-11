/**
 * QB-R2D -- the VOCABULARY of the mathematics constructs a specification-driven item declares itself in (pure, no IO).
 *
 * A generated item states which construct it is an instance of, the values of the construct's parameters, and --
 * for every answer it keys -- WHICH derived quantity or verdict of the construct that answer is. This file is the
 * closed vocabulary of those names, by construct id (the id a task family's `mathematicalStructure.construct` holds).
 *
 * It is DECLARATIVE ONLY: names and meanings. It computes nothing. The independent validators hold their own
 * recomputation of every quantity; the generator only shows this vocabulary to the provider. Keeping the two apart
 * is what lets a validator disagree with an item.
 *
 * A construct that is not listed here cannot be generated from a specification: the harness refuses it by name.
 */
export interface ConstructVocabulary {
  construct: string;
  /** The parameter symbols an item must declare, exactly these (the family's GIVEN / PARAMETER symbols). */
  parameters: readonly string[];
  /** Parameters an item may add when the asked quantity needs one. */
  optionalParameters: readonly string[];
  /** Named numbers the construct determines from the parameters. */
  quantities: ReadonlyArray<{ code: string; meaning: string }>;
  /** Named categorical results the construct determines, with their possible values. */
  verdicts: ReadonlyArray<{ code: string; meaning: string; values: readonly string[] }>;
  /** Where the parameter values must be readable in the item. */
  parametersStatedIn: 'STEM' | 'STIMULUS' | 'STEM_AS_COEFFICIENTS' | 'STIMULUS_SHAPE';
}

const q = (code: string, meaning: string) => ({ code, meaning });

export const MATH_CONSTRUCT_VOCABULARY: readonly ConstructVocabulary[] = [
  {
    construct: 'DIRECT_PROPORTION_MISSING_VALUE', parameters: ['a', 'b', 'c'], optionalParameters: [], parametersStatedIn: 'STEM',
    quantities: [q('MISSING_VALUE', 'x = b * c / a: the value of the second quantity that corresponds to c')], verdicts: [],
  },
  {
    construct: 'UNIT_RATE_COMPARISON_OF_TWO_OPTIONS', parameters: ['p1', 'q1', 'p2', 'q2'], optionalParameters: [], parametersStatedIn: 'STEM',
    quantities: [q('UNIT_RATE_1', 'r1 = q1 / p1'), q('UNIT_RATE_2', 'r2 = q2 / p2'), q('UNIT_RATE_DIFFERENCE', '|r1 - r2|')],
    verdicts: [
      { code: 'OPTION_WITH_HIGHER_UNIT_RATE', meaning: 'the option whose return per unit of amount is larger', values: ['OPTION_1', 'OPTION_2'] },
      { code: 'OPTION_WITH_LOWER_UNIT_RATE', meaning: 'the option whose return per unit of amount is smaller', values: ['OPTION_1', 'OPTION_2'] },
    ],
  },
  {
    construct: 'LINE_THROUGH_TWO_POINTS', parameters: ['x1', 'y1', 'x2', 'y2'], optionalParameters: [], parametersStatedIn: 'STEM',
    quantities: [q('SLOPE', 'm = (y2 - y1) / (x2 - x1)'), q('Y_INTERCEPT', 'b = y1 - m * x1'), q('X_INTERCEPT', '-b / m, when m is not zero')], verdicts: [],
  },
  {
    construct: 'LINEAR_MODEL_FIXED_START_CONSTANT_RATE', parameters: ['b', 'm', 'x'], optionalParameters: ['y'], parametersStatedIn: 'STEM',
    quantities: [q('VALUE_AT_X', 'y = m * x + b at the declared x'), q('RATE', 'm'), q('START_VALUE', 'b'), q('X_AT_Y', '(y - b) / m at the declared optional parameter y')], verdicts: [],
  },
  {
    construct: 'QUADRATIC_EQUATION_RATIONAL_ROOTS_BY_FACTORISING', parameters: ['a', 'r1', 'r2'], optionalParameters: [], parametersStatedIn: 'STEM_AS_COEFFICIENTS',
    quantities: [q('GREATER_ROOT', 'max(r1, r2)'), q('LESSER_ROOT', 'min(r1, r2)'), q('SUM_OF_ROOTS', 'r1 + r2'), q('PRODUCT_OF_ROOTS', 'r1 * r2'), q('COEFFICIENT_B', '-a * (r1 + r2)'), q('COEFFICIENT_C', 'a * r1 * r2')], verdicts: [],
  },
  {
    construct: 'QUADRATIC_MODEL_VERTEX_OPTIMUM', parameters: ['p', 'q', 'r', 's'], optionalParameters: [], parametersStatedIn: 'STEM',
    quantities: [q('MEASURE_AT_OPTIMUM', 'xv = (q * r - p * s) / (2 * q * s)'), q('OPTIMAL_VALUE', 'Qv = (p + q * xv) * (r - s * xv)'), q('FIRST_FACTOR_AT_OPTIMUM', 'p + q * xv'), q('SECOND_FACTOR_AT_OPTIMUM', 'r - s * xv')], verdicts: [],
  },
  {
    construct: 'CLASSICAL_PROBABILITY_SINGLE_DRAW', parameters: ['n', 'k'], optionalParameters: [], parametersStatedIn: 'STEM',
    quantities: [q('PROBABILITY', 'P = k / n'), q('COMPLEMENT_PROBABILITY', '1 - k / n')], verdicts: [],
  },
  {
    construct: 'COMPARISON_OF_TWO_CLASSICAL_PROBABILITIES', parameters: ['n1', 'k1', 'n2', 'k2'], optionalParameters: [], parametersStatedIn: 'STEM',
    quantities: [q('PROBABILITY_1', 'P1 = k1 / n1'), q('PROBABILITY_2', 'P2 = k2 / n2'), q('PROBABILITY_DIFFERENCE', '|P1 - P2|')],
    verdicts: [{ code: 'OPTION_WITH_HIGHER_PROBABILITY', meaning: 'the option whose probability is larger', values: ['OPTION_1', 'OPTION_2'] }],
  },
  {
    construct: 'RELATIVE_CHANGE_OR_SHARE_FROM_TABULATED_VALUES', parameters: ['vi', 'vj'], optionalParameters: [], parametersStatedIn: 'STIMULUS',
    quantities: [q('RELATIVE_CHANGE_PERCENT', '100 * (vj - vi) / vi'), q('ABSOLUTE_CHANGE', 'vj - vi'), q('SHARE_PERCENT', '100 * vi / (sum of the series or column that holds vi)')], verdicts: [],
  },
  {
    construct: 'CLAIM_EVALUATION_AGAINST_A_DATA_DISPLAY', parameters: ['categories'], optionalParameters: [], parametersStatedIn: 'STIMULUS_SHAPE',
    quantities: [],
    verdicts: [{ code: 'CLAIM_VERDICT', meaning: 'the truth value of the statement given the display alone', values: ['SUPPORTED', 'CONTRADICTED', 'NOT_DECIDABLE'] }],
  },
];

export const constructVocabularyOf = (construct: string): ConstructVocabulary | null => MATH_CONSTRUCT_VOCABULARY.find((v) => v.construct === construct) ?? null;
