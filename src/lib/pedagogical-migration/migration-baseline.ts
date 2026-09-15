/**
 * CANON-R4 Part 19 / CANON-R4R1 Part 6 -- THE DETERMINISTIC
 * MIGRATION-BASELINE BUILDER.
 *
 * Pure: composes `evaluateLegacyRecognition`'s output (the old-policy
 * dimension ladder, unchanged from CANON-R4) with CANON-R4R1's own
 * one-time, LEARN-only automatic baseline for PREEXISTING
 * learner-concept pairs, into the top-level `MigrationBaseline` shape a
 * dry-run tool or shadow comparison can consume. Idempotent by
 * construction (Part 32) -- calling it twice with the same input always
 * returns a structurally identical baseline (same recognition `id`s
 * too, via `evaluateLegacyRecognition`'s own deterministic id
 * derivation); nothing here is randomized or stateful.
 */
import type { ConceptKnowledgeState, MasteryPolicy } from '@/services/knowledge-state.service';
import { evaluateLegacyRecognition } from './legacy-recognition';
import { STAGE_ORDER } from '@/lib/pedagogical-engine';
import { LEGACY_UNVERSIONED } from './types';
import type { MigrationBaseline, MigrationCategory, RequirementRecognition } from './types';

const CATEGORY_BY_HIGHEST_REQUIREMENT: Record<string, MigrationCategory> = {
  LEARN: 'LEGACY_LEARN_RECOGNIZED',
  PRACTICE: 'LEGACY_PRACTICE_RECOGNIZED',
  PROVE: 'LEGACY_PROVE_RECOGNIZED',
  RETAIN: 'LEGACY_RETENTION_RECOGNIZED',
  TRANSFER: 'LEGACY_CONSOLIDATED_RECOGNIZED',
};

export function buildPedagogicalMigrationBaseline(params: {
  conceptId: string;
  studentId: string;
  knowledgeState: ConceptKnowledgeState | null;
  masteryPolicy: MasteryPolicy;
  recognizedAtMigration: string;
  migrationVersion: string;
  /**
   * CANON-R4R1 Part 0/5/6 -- the FINAL product decision's own gate:
   * true only when authoritative StudyUS data shows this EXACT
   * (studentId, conceptId) pair already existed in the learner's
   * history/state before the v1 cutover (Part 5's own population
   * query -- never "the concept exists in the global content
   * catalog"). Deliberately a SEPARATE input from `knowledgeState`
   * (which drives the higher-stage ladder, Parts 9-16, unchanged from
   * CANON-R4): a pair can be "preexisting" via raw
   * `learning_evidence` even in an edge case where no Concept
   * Knowledge State projection exists for some other reason.
   */
  isPreexistingLearnerConcept: boolean;
  /** True only when the OLD canonical read itself failed for a concept known to have activity -- distinct from a concept that was legitimately never attempted (Part 39's DATA_GAP vs. NO_RECOGNITION_REQUIRED). */
  oldStateReadFailed?: boolean;
}): MigrationBaseline {
  const {
    conceptId,
    studentId,
    knowledgeState,
    masteryPolicy,
    recognizedAtMigration,
    migrationVersion,
    isPreexistingLearnerConcept,
    oldStateReadFailed,
  } = params;

  if (!knowledgeState && !isPreexistingLearnerConcept) {
    return {
      conceptId,
      recognizedRequirements: [],
      unresolvedRequirements: [...STAGE_ORDER],
      warnings: [],
      sourceEvidenceIds: [],
      category: oldStateReadFailed ? 'DATA_GAP' : 'NO_RECOGNITION_REQUIRED',
    };
  }

  const higherStageRecognitions = knowledgeState
    ? evaluateLegacyRecognition({ knowledgeState, masteryPolicy, recognizedAtMigration, migrationVersion })
    : [];

  const recognitions = [...higherStageRecognitions];
  const alreadyHasLearn = recognitions.some((r) => r.requirement === 'LEARN');

  // CANON-R4R1 Part 0/6/7 -- the FINAL, one-time migration exception:
  // ONLY a preexisting learner-concept pair gets automatic LEARN
  // satisfaction, and ONLY when the higher-stage ladder above did not
  // already grant a stronger, evidence-grounded LEARN recognition.
  // Never a LEARN_CHECK row, never a fabricated score (Part 8).
  if (isPreexistingLearnerConcept && !alreadyHasLearn) {
    recognitions.unshift({
      id: `${studentId}:${conceptId}:LEARN:${migrationVersion}`,
      requirement: 'LEARN',
      status: 'SATISFIED',
      basis: 'LEGACY_MIGRATION_BASELINE',
      sourceEvidenceIds: [],
      legacyPolicyVersion: LEGACY_UNVERSIONED,
      recognizedAtMigration,
      reasonCode: 'PREEXISTING_LEARNER_CONCEPT_BEFORE_V1',
    });
  }

  const recognizedSet = new Set(recognitions.map((r) => r.requirement));
  const unresolved = STAGE_ORDER.filter((s) => !recognizedSet.has(s));
  const sourceEvidenceIds = [...new Set(recognitions.flatMap((r) => r.sourceEvidenceIds))];

  let category: MigrationCategory;
  if (recognitions.length === 0) {
    category = (knowledgeState?.criticalMisconceptionCount ?? 0) > 0 ? 'UNRESOLVED_LEGACY_POLICY' : 'INSUFFICIENT_LEGACY_EVIDENCE';
  } else {
    const highest = [...STAGE_ORDER].reverse().find((s) => recognizedSet.has(s))!;
    category = CATEGORY_BY_HIGHEST_REQUIREMENT[highest];
  }

  return {
    conceptId,
    recognizedRequirements: recognitions,
    unresolvedRequirements: unresolved,
    warnings: [],
    sourceEvidenceIds,
    category,
  };
}

export type { RequirementRecognition };
