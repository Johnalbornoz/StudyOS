/**
 * B2 -- Blueprint & Question Selection Core.
 *
 *   StudentAssessmentContext + CurriculumScope + PreparationContext + learner state
 *     + QuestionCoverage + QuestionEligibility
 *     -> blueprint policy (LEARNING | EXAM_PREPARATION | OFFICIAL_EXAM)
 *     -> BlueprintRequirement
 *     -> shared deterministic solver
 *     -> BlueprintResult (+ audit snapshot)
 *
 * It reads the authorities B1 fixed and owns none of them. It writes nothing: no evidence, no mastery, no
 * attempt, no assessment row. No route or runtime selector calls it yet (no cutover).
 */
export * from './solver/candidate';
export * from './solver/plan';
export * from './solver/solve';
export * from './policy/evidence-requirement';
export * from './policy/practice-depth';
export * from './policy/learning';
export * from './policy/exam-preparation';
export * from './policy/official-exam';
export * from './result';
export * from './pipeline';
export * from './readiness/feasibility';
// B2-A: blueprint variants, authority tags, protected pools, hard exposure, frozen forms, selection-unit contract.
export * from './protected/blueprint-identity';
export * from './protected/authority';
export * from './protected/pools';
export * from './protected/exposure-policy';
export * from './protected/selection-unit';
export * from './protected/diagnostic';
export * from './protected/frozen-form';
export * from './protected/protected-selection';
