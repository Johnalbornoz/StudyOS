/**
 * QF V5.1 -- Construct core -> exam adapter -> runtime instance.
 *
 *   canonical concept -> certified construct core (an EA-1 AssessmentTaskFamily, persisted)
 *     -> explicit applicability -> the one assessment adapter (EA-1 system + component profile)
 *     -> governed blueprint bucket -> AdaptationSpecification (EA-1 `adapt`) -> rendered item instance with lineage
 *
 * This directory adds no family model and no adaptation rule: it composes `exam-core/question-bank/task-families`
 * and `assessment-adaptation`, and adds what was missing between a specification and a Student -- persistence,
 * explicit applicability, one adapter view, a deterministic renderer, lineage, one supply policy, one planning unit.
 * Pure except `construct-core.repository.ts`. Nothing here calls a provider.
 */
export * from './construct-core';
export * from './core-applicability';
export * from './assessment-adapter';
export * from './assessment-system-registry';
export * from './active-configuration-binding';
export * from './registered-systems';
export * from './item-instance-lineage';
export * from './blueprint-classification';
export * from './assessment-specification';
export * from './renderer';
export * from './strategy-quadratic-factorising';
export * from './strategy-certified-template';
export * from './response-evaluation';
export * from './instance-validators';
export * from './student-supply-policy';
export * from './planning-unit';
export * from './construct-core.repository';
