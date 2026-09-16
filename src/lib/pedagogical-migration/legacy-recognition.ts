/**
 * CANON-R4 / CANON-V2-REMEDIATION Part 6 -- THE ONE LEGACY RECOGNITION
 * AUTHORITY.
 *
 * CANON-V2-REMEDIATION Part 6 (AUDIT-004 closed): Policy V2 Section 14
 * is explicit -- "Pre-cutover concepts may receive LEARN through
 * LEGACY_MIGRATION_BASELINE. Higher stages must not be fabricated."
 * This function used to grant PRACTICE/PROVE/RETAIN/TRANSFER
 * recognition purely from OLD legacy mastery-dimension scores, with
 * ZERO real v1 evidence backing any of it (`sourceEvidenceIds: []` in
 * every case) -- a direct violation, confirmed exploitable via the one
 * real caller, `scripts/canon-r4r1-pre-v1-learn-baseline.ts`, which
 * (despite its own name) applied every recognition this function
 * returned, unfiltered. The cascading PRACTICE/PROVE/RETENTION/TRANSFER
 * ladder has been REMOVED at its source: this function now returns, at
 * most, a single LEARN recognition -- never anything higher. A second,
 * independent defensive guard also exists at the persistence boundary
 * (`recognition-persistence-adapter.ts`'s `applyRecognitions`), so even
 * a future caller that reintroduces a higher-stage recognition object
 * (from this function or any other source) cannot actually persist it.
 *
 * `evaluateLegacyRecognition` answers exactly one question: "was LEARN
 * legitimately satisfied under the OLD authoritative policy?" -- never
 * "does raw activity exist?" and never "would this pass v1?" (Part 17).
 * It is grounded ENTIRELY in the old model's own already-computed
 * authority (`ConceptKnowledgeState`/`MasteryPolicy`, from
 * `src/services/knowledge-state.service.ts`) -- the same dimension
 * scores and thresholds `determineMasteryState`/`determineValidationReadiness`
 * already use, never re-derived from raw evidence rows (Part 9: "Prefer
 * existing old canonical state/evidence decisions where available").
 */
import type { ConceptKnowledgeState, MasteryPolicy } from '@/services/knowledge-state.service';
import type { LegacyRecognitionReasonCode, RequirementRecognition } from './types';
import { LEGACY_UNVERSIONED } from './types';

function passes(score: number | null, threshold: number): boolean {
  return score !== null && score >= threshold;
}

export interface LegacyRecognitionInput {
  knowledgeState: ConceptKnowledgeState | null;
  masteryPolicy: MasteryPolicy;
  /** Injected, never read from the system clock -- determinism. */
  recognizedAtMigration: string;
  /** CANON-R4R1 -- part of this recognition's deterministic id, so building the same recognition twice (idempotency, Part 32) always yields the same `RequirementRecognition.id`. */
  migrationVersion: string;
}

function makeRecognitionId(studentId: string, conceptId: string, requirement: string, migrationVersion: string): string {
  return `${studentId}:${conceptId}:${requirement}:${migrationVersion}`;
}

/**
 * Pure. Deterministic. Returns only the requirements that ARE
 * recognized (never a "not recognized" record -- a requirement simply
 * absent from the result is unresolved, exactly like the frozen engine's
 * own convention of only reporting what qualifies).
 *
 * CANON-V2-REMEDIATION Part 6 (AUDIT-004): returns AT MOST a single
 * LEARN recognition -- the PRACTICE/PROVE/RETENTION/TRANSFER cascading
 * ladder this function used to compute has been removed entirely, per
 * Policy V2 Section 14's explicit "higher stages must not be
 * fabricated." The old model's dimension scores below (`independenceOk`,
 * `retentionOk`, `applicationOk`, `transferOk`) are computed only
 * because `understandingOk`/`sufficiencyPassed` alone are the real LEARN
 * bar -- kept for this doc comment's own historical record of what the
 * OLD (pre-remediation) ladder used to gate on, not because this
 * function reads them for any decision anymore.
 */
export function evaluateLegacyRecognition(input: LegacyRecognitionInput): RequirementRecognition[] {
  const { knowledgeState: ks, masteryPolicy: p, recognizedAtMigration, migrationVersion } = input;
  if (!ks || ks.masteryState === 'UNKNOWN') return [];

  const criticalOk = ks.criticalMisconceptionCount <= p.maximumCriticalMisconceptions;
  const sufficiencyPassed = ks.evidenceCount >= p.minimumEvidenceCount;
  const understandingOk = passes(ks.understandingScore, p.minimumUnderstanding);

  if (!criticalOk) return [];

  // LEARN ONLY: the old model's own bar for "past raw Learning, real
  // understanding legitimately established" -- evidence sufficiency AND
  // the understanding dimension, exactly the gate `determineMasteryState`
  // already applies before ever leaving 'LEARNING'. CANON-V2-REMEDIATION
  // Part 6: this is now the ONLY requirement this function may ever
  // recognize -- PRACTICE/PROVE/RETAIN/TRANSFER recognition from legacy
  // mastery scores alone is a policy violation this phase closes.
  const learnRecognized = sufficiencyPassed && understandingOk;
  if (!learnRecognized) return [];

  return [
    {
      id: makeRecognitionId(ks.studentId, ks.conceptId, 'LEARN', migrationVersion),
      requirement: 'LEARN',
      status: 'SATISFIED',
      basis: 'LEGACY_POLICY_RECOGNITION',
      sourceEvidenceIds: [],
      legacyPolicyVersion: LEGACY_UNVERSIONED,
      recognizedAtMigration,
      reasonCode: 'LEGACY_HIGHER_STAGE_IMPLIES_LEARN',
    },
  ];
}
