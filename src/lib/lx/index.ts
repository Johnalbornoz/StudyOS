/**
 * LX-1 -- CANONICAL LEARNING & EVIDENCE CONTRACTS.
 *
 * Pure, deterministic, additive contracts that translate existing
 * canonical StudyUS learning truth into the vocabulary the future
 * learner journey (LX-2+) will present. NONE of these modules:
 *   - reads a raw score / threshold / evidence row directly,
 *   - grades an answer,
 *   - generates a question,
 *   - writes to any table,
 *   - re-implements a Learning Engine.
 *
 * They are consumed by later LX phases; nothing in the product imports
 * them yet, so legacy flows are byte-identical until LX-4 wires them.
 */

export * from './learner-journey-contract';
export * from './response-evidence-contract';
export * from './evidence-sufficiency-contract';
export * from './difficulty-contract';
