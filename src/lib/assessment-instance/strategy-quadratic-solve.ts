/**
 * QF V5.1 -- PARAMETRIC_DETERMINISTIC strategy of the construct QUADRATIC_EQUATION_RATIONAL_ROOTS
 * (family tf.math.quadratic.solve-rational-roots). Pure, deterministic, no IO.
 *
 * THE CONSTRUCT IS METHOD-NEUTRAL: the learner solves a quadratic equation whose roots lie in a stated envelope.
 * How -- factorising, the quadratic formula, completing the square, inspection -- is the learner's choice. An
 * answer-only response is therefore valid evidence of this construct, which it is not of a construct that names
 * a method. Factorising is a SUPPORTED reasoning strategy, never a REQUIRED observable method.
 *
 * The mathematics is the one the factorising strategy already draws and presents: a (x - r1)(x - r2) = 0 built
 * from its roots, band by band. This strategy reuses that draw and that wording unchanged and differs in one
 * thing only: where working is marked, the method mark is earned by ANY valid method.
 */
import type { RenderingStrategy, RubricPoint, StrategyContext, StrategyResult } from './renderer';
import { quadraticBandIssues, quadraticInstanceCapacity, renderQuadraticFactorising } from './strategy-quadratic-factorising';

export const QUADRATIC_SOLVE_CONSTRUCT = 'QUADRATIC_EQUATION_RATIONAL_ROOTS' as const;
export const QUADRATIC_SOLVE_RENDERER_VERSION = 'parametric.quadratic-solve@1.0.0' as const;
/** The strategies a learner may use. None is required; none is observed in an answer-only response. */
export const QUADRATIC_SUPPORTED_REASONING_STRATEGIES = ['FACTORISING', 'QUADRATIC_FORMULA', 'COMPLETING_THE_SQUARE', 'INSPECTION'] as const;

const FACTORISES = /^Factorises: (.*) = 0\.$/;
/** The method mark of the factorising scheme, opened to every valid method. Marks and codes are unchanged. */
export const methodNeutralRubric = (rubric: readonly RubricPoint[]): RubricPoint[] =>
  rubric.map((p) => { const m = FACTORISES.exec(p.criterion); return m ? { ...p, criterion: `Applies a valid method to the equation in standard form (for example factorising: ${m[1]} = 0; the quadratic formula; completing the square).` } : p; });

export function renderQuadraticSolve(ctx: StrategyContext): StrategyResult {
  const r = renderQuadraticFactorising(ctx);
  if (!r.ok) return r;
  // a scheme that still pays a mark only for factorising would make the method required again: refuse it
  const rubric = methodNeutralRubric(r.output.rubric);
  if (rubric.some((p) => FACTORISES.test(p.criterion))) return { ok: false, code: 'RUBRIC_REQUIRES_A_METHOD', detail: 'factorising' };
  return { ok: true, output: { ...r.output, rubric } };
}

/** PROVISIONAL: no human has certified this renderer. It renders dev-test instances; Student delivery refuses it. */
export const QUADRATIC_SOLVE_STRATEGY: RenderingStrategy = {
  construct: QUADRATIC_SOLVE_CONSTRUCT, kind: 'PARAMETRIC_DETERMINISTIC', rendererVersion: QUADRATIC_SOLVE_RENDERER_VERSION, status: 'PROVISIONAL', render: renderQuadraticSolve,
};
/** The lever settings and the capacity are those of the shared draw. */
export const quadraticSolveBandIssues = quadraticBandIssues;
export const quadraticSolveInstanceCapacity = quadraticInstanceCapacity;
