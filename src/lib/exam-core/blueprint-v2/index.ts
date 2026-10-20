/**
 * Blueprint Engine V2 -- BP-0 foundation + BP-1 exam definition / session / outcome + BP-2 variants / resolution + BP-3 runtime resolution shadow + BP-4A runtime shadow hooks (observe only; legacy stays authoritative).
 * Spec: docs/exams/blueprint-v2/EXAM_BLUEPRINT_ENGINE_V2_SPEC.md; blocks: BP0_FOUNDATION.md, BP1_EXAM_DEFINITION_SESSION_OUTCOME.md, ../BP2_BLUEPRINT_VARIANTS_CARDINALITY.md, ../BP3_RUNTIME_RESOLUTION_SHADOW.md, ../BP4A_RUNTIME_SHADOW_WIRING.md.
 */
export * from './provenance';
export * from './units';
export * from './schema';
export * from './pipeline';
export * from './validate';
export * from './compiler';
export * from './parity';
// BP-1
export * from './session';
export * from './outcome';
export * from './exam-definition';
export * from './exam-compiler';
// BP-2
export * from './variant';
export * from './resolver';
// BP-3
export * from './canonical-identity';
export * from './structural-diagnostics';
export * from './runtime-shadow';
export * from './shadow-parity';
// BP-4A
export * from './runtime-hook';
export * from './shadow-catalog';
