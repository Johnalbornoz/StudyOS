/**
 * CANON-R4 Part 19 -- THE DETERMINISTIC MIGRATION-BASELINE BUILDER.
 *
 * Pure: composes `evaluateLegacyRecognition`'s output into the
 * top-level `MigrationBaseline` shape a dry-run tool or shadow
 * comparison can consume, and classifies it into exactly one
 * `MigrationCategory` (Part 39). Idempotent by construction (Part 32) --
 * calling it twice with the same input always returns a structurally
 * identical baseline; nothing here is randomized or stateful.
 */
import type { ConceptKnowledgeState, MasteryPolicy } from '@/services/knowledge-state.service';
import { evaluateLegacyRecognition } from './legacy-recognition';
import { STAGE_ORDER } from '@/lib/pedagogical-engine';
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
  knowledgeState: ConceptKnowledgeState | null;
  masteryPolicy: MasteryPolicy;
  recognizedAtMigration: string;
  /** True only when the OLD canonical read itself failed for a concept known to have activity -- distinct from a concept that was legitimately never attempted (Part 39's DATA_GAP vs. NO_RECOGNITION_REQUIRED). */
  oldStateReadFailed?: boolean;
}): MigrationBaseline {
  const { conceptId, knowledgeState, masteryPolicy, recognizedAtMigration, oldStateReadFailed } = params;

  if (!knowledgeState) {
    return {
      conceptId,
      recognizedRequirements: [],
      unresolvedRequirements: [...STAGE_ORDER],
      warnings: [],
      sourceEvidenceIds: [],
      category: oldStateReadFailed ? 'DATA_GAP' : 'NO_RECOGNITION_REQUIRED',
    };
  }

  const recognitions = evaluateLegacyRecognition({ knowledgeState, masteryPolicy, recognizedAtMigration });
  const recognizedSet = new Set(recognitions.map((r) => r.requirement));
  const unresolved = STAGE_ORDER.filter((s) => !recognizedSet.has(s));
  const sourceEvidenceIds = [...new Set(recognitions.flatMap((r) => r.sourceEvidenceIds))];

  let category: MigrationCategory;
  if (recognitions.length === 0) {
    category = knowledgeState.criticalMisconceptionCount > 0 ? 'UNRESOLVED_LEGACY_POLICY' : 'INSUFFICIENT_LEGACY_EVIDENCE';
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
