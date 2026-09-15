/**
 * CANON-R4 -- THE ONE LEGACY RECOGNITION AUTHORITY.
 *
 * `evaluateLegacyRecognition` answers exactly one question per
 * requirement: "was this legitimately satisfied under the OLD
 * authoritative policy?" -- never "does raw activity exist?" and never
 * "would this pass v1?" (Part 17). It is grounded ENTIRELY in the old
 * model's own already-computed authority
 * (`ConceptKnowledgeState`/`MasteryPolicy`, from
 * `src/services/knowledge-state.service.ts`) -- the same dimension
 * scores and thresholds `determineMasteryState`/`determineValidationReadiness`
 * already use, never re-derived from raw evidence rows (Part 9: "Prefer
 * existing old canonical state/evidence decisions where available").
 *
 * Recognition is a strict, cascading ladder -- each requirement's
 * recognition REQUIRES every requirement below it to also be
 * recognized, so an isolated dimension spike (e.g. one lucky
 * independent question, Part 36's own "do not over-recognize downstream
 * stages" concern) can never grant a higher requirement without the
 * foundational ones actually holding too.
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
 */
export function evaluateLegacyRecognition(input: LegacyRecognitionInput): RequirementRecognition[] {
  const { knowledgeState: ks, masteryPolicy: p, recognizedAtMigration, migrationVersion } = input;
  if (!ks || ks.masteryState === 'UNKNOWN') return [];

  const criticalOk = ks.criticalMisconceptionCount <= p.maximumCriticalMisconceptions;
  const sufficiencyPassed = ks.evidenceCount >= p.minimumEvidenceCount;
  const understandingOk = passes(ks.understandingScore, p.minimumUnderstanding);
  const independenceOk = passes(ks.independenceScore, p.minimumIndependence);
  const applicationOk = passes(ks.applicationScore, p.minimumApplication);
  const retentionOk = passes(ks.retentionScore, p.minimumRetention);
  const transferOk = !p.requiresTransfer || passes(ks.transferScore, p.minimumTransfer);

  const recognitions: RequirementRecognition[] = [];
  const record = (requirement: RequirementRecognition['requirement'], reasonCode: LegacyRecognitionReasonCode) => {
    recognitions.push({
      id: makeRecognitionId(ks.studentId, ks.conceptId, requirement, migrationVersion),
      requirement,
      status: 'SATISFIED',
      basis: 'LEGACY_POLICY_RECOGNITION',
      sourceEvidenceIds: [],
      legacyPolicyVersion: LEGACY_UNVERSIONED,
      recognizedAtMigration,
      reasonCode,
    });
  };

  if (!criticalOk) return [];

  // PRACTICE: the old model's own bar for "past raw Learning, real
  // understanding legitimately established" -- evidence sufficiency AND
  // the understanding dimension, exactly the gate `determineMasteryState`
  // already applies before ever leaving 'LEARNING'.
  const practiceRecognized = sufficiencyPassed && understandingOk;
  if (practiceRecognized) {
    // Part 7/8: LEARN is recognized ONLY as an implication of a
    // legitimately-reached HIGHER stage -- never from raw activity
    // existence alone.
    record('LEARN', 'LEGACY_HIGHER_STAGE_IMPLIES_LEARN');
    record('PRACTICE', 'LEGACY_PRACTICE_EVIDENCE_SUFFICIENT_AND_UNDERSTANDING_OK');
  }

  // PROVE: requires PRACTICE already recognized (cascading -- Part 36)
  // AND the old model's own independence dimension passing.
  const proveRecognized = practiceRecognized && independenceOk;
  if (proveRecognized) record('PROVE', 'LEGACY_INDEPENDENT_EVIDENCE_OK');

  // RETENTION: requires PROVE already recognized AND the old model's
  // own (Phase 6-sourced) retention dimension passing.
  const retentionRecognized = proveRecognized && retentionOk;
  if (retentionRecognized) record('RETAIN', 'LEGACY_RETENTION_DIMENSION_OK');

  // TRANSFER/CONSOLIDATED: only the old model's own strongest,
  // fully-validated state -- every dimension (including transfer, when
  // required) passing at once, exactly `determineMasteryState`'s own
  // VALIDATED_MASTERY gate. Never inferred from Transfer evidence
  // existing alone (Part 16).
  const transferRecognized = retentionRecognized && ks.masteryState === 'VALIDATED_MASTERY' && applicationOk && transferOk;
  if (transferRecognized) record('TRANSFER', 'LEGACY_VALIDATED_MASTERY_CONSOLIDATED');

  return recognitions;
}
