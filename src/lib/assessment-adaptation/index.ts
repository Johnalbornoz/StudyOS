/**
 * EA-1 -- Transversal Assessment Adaptation (owner: shared assessment architecture).
 *
 *   Canonical Knowledge -> AssessmentTaskFamily (Question Bank) -> AssessmentSystemProfile -> AssessmentComponentProfile
 *     -> DisciplineAdaptationPolicy
 *     -> AdaptationSpecification -> [Production OS: GenerationRequest -> QuestionCandidate -> validation -> review]
 *     -> [B2 selection] -> [B3 evidence]
 *
 * FOUR SEPARATIONS this directory exists to keep:
 *   knowledge      vs  how it is asked      a profile holds no concept; a family references a certified one
 *   concept certification  vs  assessment applicability      the Curriculum's, exam-independent vs a recorded fact about a concept and a scope
 *   how a system asks  vs  what that means in a discipline      profile vs discipline policy
 *   what is invariant  vs  what is variable      hashed invariants vs provenance-carrying variable dimensions
 *   a specification    vs  an instance           an immutable input vs content that still has every gate to pass
 *
 * Pure contracts, a pure engine and illustrative data. No database, no environment, no network, no clock, no
 * randomness. It imports the task-family contract and the exam-family taxonomy; it does not import the
 * Production OS, B2 (`assessment-blueprint`) or any service, and nothing at runtime imports it yet.
 */
export * from './canonical-hash';
export * from './assessment-applicability';
export * from './assessment-system-profile';
export * from './system-profiles';
export * from './discipline-policy';
export * from './instance-lineage';
export * from './adaptation-specification';
export * from './adapt';
export * from './cell-bridge';
export * from './math-poc-applicability';
export * from './math-poc-matrix';
