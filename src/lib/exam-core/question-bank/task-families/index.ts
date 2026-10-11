/**
 * EA-1 -- Assessment Task Families (owner: Question Bank). Contracts, the registry of discipline
 * specialisations, the mathematics proof-of-concept data and the demand analysis. Pure: no database, no
 * environment, no network, no clock. Nothing here imports the Production OS, the adaptation engine, B2 or B3.
 */
import { MATH_PROBLEM_SPECIALIZATION } from './math-problem';
import { createTaskFamilyRegistry } from './task-family';

export * from './task-family';
export * from './math-problem';
export * from './math-poc-families';
export * from './family-demand';

/** The specialisations this repository implements today: mathematics only. Extend with `.with(specialization)`. */
export const DEFAULT_TASK_FAMILY_REGISTRY = createTaskFamilyRegistry([MATH_PROBLEM_SPECIALIZATION]);
