/**
 * EA-1 -- the MATH_PROBLEM specialisation of a task family (pure contract, no IO).
 *
 * What makes two mathematics questions "the same task": the mathematical STRUCTURE (the construct and the
 * relationships between its variables), not the story, the numbers or the response form. This schema states the
 * structure once, with the ranges an instance may draw its numbers from, the rules a valid instance must meet
 * and the errors the task is built to catch.
 *
 * INVARIANT vs VARIABLE. For every instance of a family the PRIMARY concept, the mathematical construct with its
 * relationships, and the evidence target are the same. The context, the numbers (inside the parameter ranges),
 * the language, the stimulus, the command term, the response format, the distractors, the required
 * justification, the difficulty and the calculator policy may differ. `adaptationFacts` hands the adaptation
 * engine the invariant construct; the engine hashes it and carries it verbatim.
 *
 * A relationship is written in the family's own symbols (`y = m * x + b`). It is a statement of structure for an
 * author and a reviewer; it is not evaluated here.
 */
import { z } from 'zod';
import { DIFFICULTY_LEVER_KINDS, TOOL_DEPENDENCIES, type TaskFamily, type TaskFamilySpecialization } from './task-family';

export const MATH_PROBLEM_FAMILY_TYPE = 'MATH_PROBLEM' as const;
export const MATH_PROBLEM_SPECIALIZATION_VERSION = '1' as const;

const ID = z.string().trim().min(1).max(200);
const SHORT = z.string().trim().min(3).max(300);
const STATEMENT = z.string().trim().min(10).max(700);
const SYMBOL = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,19}$/, 'SYMBOL_FORMAT');

export const MATH_VARIABLE_ROLES = ['GIVEN', 'UNKNOWN', 'PARAMETER', 'DERIVED'] as const;
export const MATH_NUMBER_DOMAINS = ['INTEGER', 'RATIONAL', 'REAL', 'CATEGORY'] as const;

export const MathProblemSpecializationSchema = z
  .strictObject({
    /** The construct every instance shares, by a stable name and in words. */
    mathematicalStructure: z.strictObject({ construct: z.string().regex(/^[A-Z][A-Z0-9_]{2,79}$/, 'CONSTRUCT_FORMAT'), description: STATEMENT }),
    variables: z.array(z.strictObject({ symbol: SYMBOL, meaning: SHORT, role: z.enum(MATH_VARIABLE_ROLES), domain: z.enum(MATH_NUMBER_DOMAINS) })).min(1),
    /** What an instance may draw a variable from. `step` null = any value of the variable's domain in the range. */
    parameterRanges: z.array(z.strictObject({ symbol: SYMBOL, min: z.number().finite(), max: z.number().finite(), step: z.number().positive().nullable(), note: SHORT.nullable() })),
    /** The relationships between the variables, in the family's symbols. */
    relationships: z.array(z.string().trim().min(3).max(200)).min(1),
    /** Conditions an instance's values must satisfy together. */
    constraints: z.array(SHORT),
    /** What makes an instance well posed: one answer, of the stated form. */
    validSolutionRules: z.array(SHORT).min(1),
    /** Errors the task is built to catch. A selected-response instance draws its distractors from these. */
    misconceptionModels: z.array(z.strictObject({ id: ID, description: SHORT, producesError: SHORT })).min(1),
    /** How the numbers or the structure make an instance harder, per band. An editorial estimate. */
    numericalDifficultyLevers: z.array(z.strictObject({ lever: ID, kind: z.enum(DIFFICULTY_LEVER_KINDS), FOUNDATIONAL: SHORT, STANDARD: SHORT, CHALLENGE: SHORT })).min(1),
    calculatorDependency: z.enum(TOOL_DEPENDENCIES),
  })
  .superRefine((s, ctx) => {
    const symbols = new Set(s.variables.map((v) => v.symbol));
    if (symbols.size !== s.variables.length) ctx.addIssue({ code: 'custom', path: ['variables'], message: 'SYMBOL_LISTED_TWICE' });
    if (!s.variables.some((v) => v.role === 'UNKNOWN')) ctx.addIssue({ code: 'custom', path: ['variables'], message: 'NO_UNKNOWN' });
    s.parameterRanges.forEach((r, i) => {
      if (!symbols.has(r.symbol)) ctx.addIssue({ code: 'custom', path: ['parameterRanges', i, 'symbol'], message: 'RANGE_OF_AN_UNDECLARED_VARIABLE' });
      if (r.min > r.max) ctx.addIssue({ code: 'custom', path: ['parameterRanges', i], message: 'RANGE_IS_EMPTY' });
    });
    if (new Set(s.misconceptionModels.map((m) => m.id)).size !== s.misconceptionModels.length) ctx.addIssue({ code: 'custom', path: ['misconceptionModels'], message: 'MISCONCEPTION_LISTED_TWICE' });
  });
export type MathProblemSpecialization = z.infer<typeof MathProblemSpecializationSchema>;
export type MathTaskFamily = TaskFamily<MathProblemSpecialization> & { familyType: typeof MATH_PROBLEM_FAMILY_TYPE };

export const MATH_PROBLEM_SPECIALIZATION: TaskFamilySpecialization<MathProblemSpecialization> = {
  familyType: MATH_PROBLEM_FAMILY_TYPE,
  discipline: 'MATHEMATICS',
  version: MATH_PROBLEM_SPECIALIZATION_VERSION,
  schema: MathProblemSpecializationSchema,
  adaptationFacts: (s) => ({
    // the construct, its variables' roles and its relationships: the structure. Ranges, levers and rules are not part of it.
    invariantConstruct: { construct: s.mathematicalStructure.construct, variables: s.variables.map((v) => ({ symbol: v.symbol, role: v.role, domain: v.domain })), relationships: [...s.relationships] },
    toolDependency: s.calculatorDependency,
    parameterization: { parameterRanges: s.parameterRanges.map((r) => ({ ...r })), constraints: [...s.constraints], validSolutionRules: [...s.validSolutionRules] },
    misconceptionModelIds: s.misconceptionModels.map((m) => m.id),
  }),
};

/** Does an instance's set of values lie inside the family's parameter ranges? Values of undeclared symbols are refused. */
export function parameterizationViolations(specialization: MathProblemSpecialization, values: Readonly<Record<string, number>>): string[] {
  const out: string[] = [];
  for (const [symbol, value] of Object.entries(values)) {
    const range = specialization.parameterRanges.find((r) => r.symbol === symbol);
    if (!range) { out.push(`NO_RANGE_FOR:${symbol}`); continue; }
    if (value < range.min || value > range.max) out.push(`OUT_OF_RANGE:${symbol}`);
    // a stepped range admits only min + k * step (compared with a tolerance: steps may be decimal)
    else if (range.step !== null && Math.abs((value - range.min) / range.step - Math.round((value - range.min) / range.step)) > 1e-9) out.push(`OFF_STEP:${symbol}`);
  }
  return out;
}
