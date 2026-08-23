/**
 * External Validation (Phase 2.2C): school assessments are external
 * validation signals, not automatic corrections to internal Knowledge
 * State. This module never writes to concept_knowledge_state or
 * mastery_records -- it only reads the existing assessment_results/
 * assessment_occurrences tables (reused as-is, no new external-
 * assessment table) plus a new concept-coverage mapping, and records a
 * Calibration Conflict when internal and external evidence genuinely
 * disagree. Deciding what to DO about a conflict is Phase 3's job.
 *
 * See docs/architecture/phase-2-2-knowledge-validation.md for the
 * design and docs/architecture/phase-2-2-knowledge-validation.md's
 * note on exam-result.service.ts's existing (pre-Phase-2.2, Phase 1)
 * uniform per-exam mastery recalibration -- that mechanism is untouched
 * by this module, which is a separate, additive analysis layer.
 */

import { db } from '@/lib/db';
import { getConceptKnowledgeState } from './knowledge-state.service';

/** Below this, a mapping is too unreliable to treat the resulting conflict as high-confidence cognitive truth. */
const LOW_MAPPING_CONFIDENCE_THRESHOLD = 0.5;
/** Below this coverage weight, the exam barely touched the concept -- a disagreement says little. */
const LOW_COVERAGE_WEIGHT_THRESHOLD = 0.5;
/** A conflict is only worth recording once internal/external disagree by at least this many points. */
const CONFLICT_MAGNITUDE_THRESHOLD = 20;

export interface ConceptCoverageMapping {
  conceptId: string;
  weight: number;
  mappingConfidence: number;
}

/** Explicit, caller-supplied concept coverage for one assessment occurrence -- never auto-inferred from the topics text[], which isn't precise enough to trust unattended. */
export async function mapAssessmentConceptCoverage(occurrenceId: string, mappings: ConceptCoverageMapping[]): Promise<void> {
  for (const m of mappings) {
    await db.query(
      `INSERT INTO assessment_concept_coverage (assessment_occurrence_id, concept_id, weight, mapping_confidence)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (assessment_occurrence_id, concept_id) DO UPDATE SET weight = EXCLUDED.weight, mapping_confidence = EXCLUDED.mapping_confidence`,
      [occurrenceId, m.conceptId, m.weight, m.mappingConfidence]
    );
  }
}

export interface ExternalConceptEvidence {
  externalScore: number;
  coverageWeight: number;
  mappingConfidence: number;
  assessmentResultId: string;
}

/**
 * The most recent external (school assessment) evidence for one
 * concept, weighted by how confidently it was mapped and how much of
 * the assessment actually covered it. Null when no assessment has ever
 * been mapped to this concept -- never a fabricated 0.
 */
export async function getExternalScoreForConcept(studentId: string, conceptId: string): Promise<ExternalConceptEvidence | null> {
  const result = await db.query(
    `SELECT ar.id AS assessment_result_id, ar.percentage, acc.weight, acc.mapping_confidence
     FROM assessment_concept_coverage acc
     JOIN assessment_results ar ON ar.occurrence_id = acc.assessment_occurrence_id
     WHERE acc.concept_id = $1 AND ar.student_id = $2
     ORDER BY ar.analyzed_at DESC
     LIMIT 1`,
    [conceptId, studentId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    externalScore: Number(row.percentage),
    coverageWeight: Number(row.weight),
    mappingConfidence: Number(row.mapping_confidence),
    assessmentResultId: row.assessment_result_id,
  };
}

export type CalibrationTag =
  | 'LOW_MAPPING_CONFIDENCE'
  | 'COVERAGE_MISMATCH'
  | 'POSSIBLE_TRANSFER_WEAKNESS'
  | 'INTERNAL_OVERESTIMATION'
  | 'EXTERNAL_STRONGER_THAN_INTERNAL'
  | 'ASSESSMENT_DIFFICULTY_OR_TIME_PRESSURE';

/**
 * Which interpretations plausibly explain a disagreement -- deterministic,
 * data-quality caveats first (an unreliable mapping or thin coverage
 * should always be flagged before drawing any conclusion about the
 * student), then the directional signal. Never a single fabricated
 * "this is definitely why" -- multiple tags can and often should apply
 * together.
 */
export function interpretCalibrationConflict(
  internalScore: number,
  externalScore: number,
  mappingConfidence: number,
  coverageWeight: number,
  transferScore: number | null,
  transferThreshold: number
): CalibrationTag[] {
  const tags: CalibrationTag[] = [];
  if (mappingConfidence < LOW_MAPPING_CONFIDENCE_THRESHOLD) tags.push('LOW_MAPPING_CONFIDENCE');
  if (coverageWeight < LOW_COVERAGE_WEIGHT_THRESHOLD) tags.push('COVERAGE_MISMATCH');

  if (internalScore > externalScore) {
    tags.push('INTERNAL_OVERESTIMATION');
    if (transferScore !== null && transferScore < transferThreshold) tags.push('POSSIBLE_TRANSFER_WEAKNESS');
    else tags.push('ASSESSMENT_DIFFICULTY_OR_TIME_PRESSURE');
  } else {
    tags.push('EXTERNAL_STRONGER_THAN_INTERNAL');
  }
  return tags;
}

export interface CalibrationConflict {
  id: string;
  studentId: string;
  conceptId: string;
  assessmentResultId: string;
  internalScore: number;
  externalScore: number;
  mappingConfidence: number;
  coverageWeight: number;
  conflictMagnitude: number;
  possibleInterpretations: CalibrationTag[];
  detectedAt: string;
}

/**
 * Compares the concept's current internal Understanding (Phase 2.2A's
 * own deterministic dimension -- the closest existing analog to "does
 * the student understand this concept", never re-derived here) against
 * its most recent external evidence. Records (and returns) a
 * Calibration Conflict only when they genuinely disagree by more than
 * the threshold -- agreement is not logged as a conflict, and this
 * function never writes to concept_knowledge_state/mastery_records
 * either way. Returns null when there's nothing to compare (no internal
 * Understanding yet, or no external evidence mapped to this concept).
 */
export async function detectCalibrationConflict(studentId: string, conceptId: string): Promise<CalibrationConflict | null> {
  const [knowledgeState, external] = await Promise.all([
    getConceptKnowledgeState(studentId, conceptId),
    getExternalScoreForConcept(studentId, conceptId),
  ]);
  if (!knowledgeState || knowledgeState.understandingScore === null || !external) return null;

  const internalScore = knowledgeState.understandingScore;
  const conflictMagnitude = Math.abs(internalScore - external.externalScore);
  if (conflictMagnitude < CONFLICT_MAGNITUDE_THRESHOLD) return null;

  const transferThreshold = 70; // matches Policy v1's minimumTransfer; not re-read from mastery_policies to keep this a pure comparison, documented as a known simplification if policy versions ever diverge.
  const tags = interpretCalibrationConflict(
    internalScore,
    external.externalScore,
    external.mappingConfidence,
    external.coverageWeight,
    knowledgeState.transferScore,
    transferThreshold
  );

  const inserted = await db.query(
    `INSERT INTO calibration_conflicts (
       student_id, concept_id, assessment_result_id, internal_score, external_score,
       mapping_confidence, coverage_weight, conflict_magnitude, possible_interpretations
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [
      studentId,
      conceptId,
      external.assessmentResultId,
      internalScore,
      external.externalScore,
      external.mappingConfidence,
      external.coverageWeight,
      conflictMagnitude,
      JSON.stringify(tags),
    ]
  );
  const row = inserted.rows[0];
  return {
    id: row.id,
    studentId: row.student_id,
    conceptId: row.concept_id,
    assessmentResultId: row.assessment_result_id,
    internalScore: Number(row.internal_score),
    externalScore: Number(row.external_score),
    mappingConfidence: Number(row.mapping_confidence),
    coverageWeight: Number(row.coverage_weight),
    conflictMagnitude: Number(row.conflict_magnitude),
    possibleInterpretations: row.possible_interpretations,
    detectedAt: row.detected_at,
  };
}

export async function getCalibrationConflicts(studentId: string): Promise<CalibrationConflict[]> {
  const result = await db.query(`SELECT * FROM calibration_conflicts WHERE student_id = $1 ORDER BY detected_at DESC`, [studentId]);
  return result.rows.map((row) => ({
    id: row.id,
    studentId: row.student_id,
    conceptId: row.concept_id,
    assessmentResultId: row.assessment_result_id,
    internalScore: Number(row.internal_score),
    externalScore: Number(row.external_score),
    mappingConfidence: Number(row.mapping_confidence),
    coverageWeight: Number(row.coverage_weight),
    conflictMagnitude: Number(row.conflict_magnitude),
    possibleInterpretations: row.possible_interpretations,
    detectedAt: row.detected_at,
  }));
}
