/**
 * B1 -- Canonical Assessment Foundation: the contracts every assessment flow shares.
 *
 *   Student -> StudentAssessmentContext -> CurriculumScope -> PreparationContext
 *     -> QuestionCoverage -> QuestionEligibility -> BlueprintRequirement
 *     -> [B2 shared solver] -> BlueprintResult -> GeneratedAssessmentSnapshot
 *     -> [B3 execution / evidence] -> NextAction / Continuation
 *
 * Contracts and read boundaries only. No solver, no evidence writer, no next-action producer lives here.
 */
export * from './known';
export * from './families';
export * from './preparation-context';
export * from './student-assessment-context';
export * from './question-coverage';
export * from './question-eligibility';
export * from './blueprint-contract';
export * from './evidence-attribution';
export * from './generated-assessment';
export * from './exam-gap-candidate';
