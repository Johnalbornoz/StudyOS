/**
 * CANON-R4 -- LEGACY EVIDENCE COMPATIBILITY & v1 EVIDENCE CAPTURE: shared
 * types.
 *
 * This directory is a COMPATIBILITY LAYER, separate from both the frozen
 * pure engine (`src/lib/pedagogical-engine/`, untouched this phase) and
 * the shadow comparator (`src/lib/pedagogical-shadow/`, extended-by-
 * composition, never replaced). It answers exactly one question per
 * requirement: "was this legitimately satisfied under the policy that
 * existed when the evidence was produced?" -- never "would this pass
 * v1?" (CANON-R4 Part 17's own explicit distinction).
 *
 * Nothing here fabricates evidence, rewrites history, or grants the new
 * engine authority over any learner-facing behavior.
 */
import type { EvidenceQualificationReasonCode, PedagogicalStage, RecognizedRequirementBasis } from '@/lib/pedagogical-engine';

/** CANON-R4 Part 3/29 -- the ONE version label new pedagogical evidence may ever carry once cutover is active. */
export const V1_POLICY_VERSION = 'studyus-canonical-v1' as const;

/** CANON-R4 Part 4 -- historical evidence's honest classification. Never pretends a specific historical policy version is known when the system never stored one. */
export const LEGACY_UNVERSIONED = 'LEGACY_UNVERSIONED' as const;

export type EvidenceVersionLabel = typeof V1_POLICY_VERSION | typeof LEGACY_UNVERSIONED;

/**
 * CANON-R4 Part 5 -- the one explicit v1 cutover boundary. `cutoverAt:
 * null` means "no cutover has been approved/configured yet" -- every
 * evidence timestamp is then classified LEGACY_UNVERSIONED,
 * unconditionally (CANON-R4 Part 5: "Do not choose the Production
 * cutover timestamp yet if deployment has not been approved. Implement/
 * configure the mechanism without executing Production cutover.").
 */
export interface MigrationPolicy {
  cutoverAt: string | null;
}

/** CANON-R4 Part 18 -- kept structurally distinct from `EvidenceQualificationReasonCode` (the pure engine's own vocabulary) so a consumer can never confuse "this requirement was satisfied by real qualifying v1 evidence" with "this requirement was recognized from legacy history." */
export type QualificationBasis = 'V1_EVIDENCE' | 'LEGACY_POLICY_RECOGNITION';

/** CANON-R4 Part 1 -- the ONE explicit vocabulary for why a legacy requirement was (or was not) recognized. Never a bespoke ad hoc string. */
export type LegacyRecognitionReasonCode =
  | 'LEGACY_HIGHER_STAGE_IMPLIES_LEARN'
  | 'LEGACY_PRACTICE_EVIDENCE_SUFFICIENT_AND_UNDERSTANDING_OK'
  | 'LEGACY_INDEPENDENT_EVIDENCE_OK'
  | 'LEGACY_RETENTION_DIMENSION_OK'
  | 'LEGACY_VALIDATED_MASTERY_CONSOLIDATED'
  | 'LEGACY_EVIDENCE_INSUFFICIENT'
  | 'LEGACY_CRITICAL_MISCONCEPTION_BLOCKS_RECOGNITION'
  | 'LEGACY_PREREQUISITE_NOT_RECOGNIZED'
  | 'LEGACY_STATE_UNAVAILABLE'
  /** CANON-R4R1 Part 6 -- the one-time, LEARN-only automatic migration baseline reason, distinct from every `LEGACY_POLICY_RECOGNITION`-basis reason above (which are all earned through old-model dimension checks, never granted merely for existing). */
  | 'PREEXISTING_LEARNER_CONCEPT_BEFORE_V1';

/**
 * CANON-R4 Part 1 / CANON-R4R1 Part 6 -- ONE requirement's migration
 * recognition record. `basis` is `'LEGACY_POLICY_RECOGNITION'` for every
 * requirement `evaluateLegacyRecognition` grants (old-model dimension
 * checks) and `'LEGACY_MIGRATION_BASELINE'` ONLY for the one-time,
 * LEARN-only automatic baseline CANON-R4R1 introduces for preexisting
 * learner-concept pairs (`reasonCode: 'PREEXISTING_LEARNER_CONCEPT_BEFORE_V1'`)
 * -- never produced for a v1-evidence-satisfied requirement, since the
 * frozen engine already reports that directly via
 * `RequirementResult.satisfactionBasis: 'V1_EVIDENCE'`.
 */
export interface RequirementRecognition {
  /**
   * CANON-R4R1 -- opaque identifier for this recognition (maps 1:1 to a
   * `pedagogical_requirement_recognition` row's own primary key once
   * persisted). Deterministically derived from
   * `(studentId, conceptId, requirement, migrationVersion)` so building
   * the same recognition twice always yields the SAME id -- the
   * foundation of idempotent persistence (Part 32).
   */
  id: string;
  requirement: Exclude<PedagogicalStage, 'CONSOLIDATED'>;
  status: 'SATISFIED';
  basis: RecognizedRequirementBasis;
  /** Opaque `learning_evidence.id` values only, when traceable -- never learner content. May be empty when the recognition is grounded in an aggregate old-model authority (Concept Knowledge State) that does not itself carry row-level ids (Part 9's own preference: "old canonical state/evidence decisions where available" -- the DECISION is authoritative, not necessarily every contributing row), or when grounded in mere preexistence (`LEGACY_MIGRATION_BASELINE`), which by definition has no per-row evidence basis. */
  sourceEvidenceIds: string[];
  legacyPolicyVersion: typeof LEGACY_UNVERSIONED;
  recognizedAtMigration: string;
  reasonCode: LegacyRecognitionReasonCode;
}

/** CANON-R4 Part 39 -- the closed vocabulary for a migration baseline's own top-level classification. */
export type MigrationCategory =
  | 'NO_RECOGNITION_REQUIRED'
  | 'LEGACY_LEARN_RECOGNIZED'
  | 'LEGACY_PRACTICE_RECOGNIZED'
  | 'LEGACY_PROVE_RECOGNIZED'
  | 'LEGACY_RETENTION_RECOGNIZED'
  | 'LEGACY_CONSOLIDATED_RECOGNIZED'
  | 'INSUFFICIENT_LEGACY_EVIDENCE'
  | 'UNRESOLVED_LEGACY_POLICY'
  | 'DATA_GAP'
  | 'ENGINE_INTERFACE_EXTENSION_REQUIRED';

/** CANON-R4 Part 19 -- the deterministic migration-baseline builder's output. */
export interface MigrationBaseline {
  conceptId: string;
  recognizedRequirements: RequirementRecognition[];
  unresolvedRequirements: Exclude<PedagogicalStage, 'CONSOLIDATED'>[];
  warnings: string[];
  sourceEvidenceIds: string[];
  category: MigrationCategory;
}

/**
 * CANON-R4 Part 20/21 -- the composition this phase produces INSTEAD of
 * modifying the frozen engine's input contract. `engineInterfaceNote`
 * always documents that this composition happens strictly downstream of
 * (never inside) `evaluateCanonicalLearningState` -- the engine itself
 * never sees a recognition, only real `RawEvidenceItem`s.
 */
export interface EffectiveRequirementView {
  requirement: Exclude<PedagogicalStage, 'CONSOLIDATED'>;
  satisfied: boolean;
  basis: QualificationBasis | null;
}

export interface EffectiveMigratedState {
  conceptId: string;
  studentId: string;
  effectiveStage: PedagogicalStage;
  perRequirement: EffectiveRequirementView[];
  /** Always `'ENGINE_INTERFACE_EXTENSION_REQUIRED'` -- see the CANON-R4 report's ENGINE INTERFACE COMPATIBILITY section. This composition is NOT an engine capability; it is external, documented, and stops short of touching engine semantics. */
  engineInterfaceNote: 'ENGINE_INTERFACE_EXTENSION_REQUIRED';
}

export type { EvidenceQualificationReasonCode };
