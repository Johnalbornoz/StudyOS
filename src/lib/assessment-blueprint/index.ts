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
