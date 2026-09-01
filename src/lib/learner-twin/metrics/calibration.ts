/**
 * Phase 1E, Steps 9-10: Aggregate Confidence Calibration (student, and
 * student + subject).
 *
 * Reuses `computeConfidenceCalibration` (learner-model.service.ts)
 * VERBATIM, per-concept -- this module never reimplements its formula.
 * Its own `label === 'INSUFFICIENT_EVIDENCE'` (< its internal
 * CALIBRATION_MIN_SAMPLES) is reused directly as the per-concept
 * qualification gate, so no new sample-size constant is duplicated.
 *
 * Step 9's preferred aggregation ("median of qualifying concept
 * calibration values") is followed for the numeric magnitude
 * (`medianCalibrationScore`). Direction (over/under-confident) is
 * deliberately NOT collapsed into one aggregate label -- the atomic
 * function's `.score` is direction-agnostic (computed from absolute
 * differences), so a single aggregate "OVERCONFIDENT" label would have
 * to be invented from nothing. Instead `labelDistribution` reports how
 * many qualifying concepts landed in each of the atomic function's own
 * certified labels -- honest, not fabricated (Step 10).
 */
import { db } from '@/lib/db';
import { computeConfidenceCalibration, type ConfidenceLevel, type CalibrationLabel } from '@/services/learner-model.service';
import {
  type AggregateCalibrationSummary,
  type MetricResult,
  CALIBRATION_AGGREGATE_MODEL_VERSION,
  AGGREGATE_CALIBRATION_MIN_QUALIFYING_CONCEPTS,
  metricAvailable,
  metricUnavailable,
  quality,
} from './types';

interface ConfidenceRow {
  concept_id: string;
  confidence_before_answer: ConfidenceLevel;
  result: string;
}

const EMPTY_LABEL_DISTRIBUTION: Record<CalibrationLabel, number> = {
  OVERCONFIDENT: 0,
  WELL_CALIBRATED: 0,
  UNDERCONFIDENT: 0,
  INSUFFICIENT_EVIDENCE: 0,
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Pure: computes the aggregate from already-fetched (concept_id, confidence, result) rows -- one query's worth, grouped in memory (no per-concept queries). */
export function computeAggregateCalibration(rows: ConfidenceRow[]): MetricResult<AggregateCalibrationSummary> {
  const byConcept = new Map<string, ConfidenceRow[]>();
  for (const r of rows) {
    const list = byConcept.get(r.concept_id) ?? [];
    list.push(r);
    byConcept.set(r.concept_id, list);
  }

  const labelDistribution = { ...EMPTY_LABEL_DISTRIBUTION };
  const qualifyingScores: number[] = [];
  let qualifyingConceptCount = 0;

  for (const conceptRows of byConcept.values()) {
    const calibration = computeConfidenceCalibration(
      conceptRows.map((r) => ({ confidence: r.confidence_before_answer, result: r.result }))
    );
    if (calibration.label !== 'INSUFFICIENT_EVIDENCE') {
      qualifyingConceptCount++;
      labelDistribution[calibration.label]++;
      if (calibration.score !== null) qualifyingScores.push(calibration.score);
    }
  }

  if (qualifyingConceptCount < AGGREGATE_CALIBRATION_MIN_QUALIFYING_CONCEPTS) {
    return metricUnavailable(
      'INSUFFICIENT_EVIDENCE',
      `${qualifyingConceptCount} qualifying concept(s) (each needs its own sufficient confidence-tagged evidence); at least ${AGGREGATE_CALIBRATION_MIN_QUALIFYING_CONCEPTS} are required for a meaningful aggregate.`
    );
  }

  return metricAvailable({
    medianCalibrationScore: median(qualifyingScores),
    labelDistribution,
    qualifyingConceptCount,
    totalRelevantConceptCount: byConcept.size,
    totalConfidenceSamples: rows.length,
    quality: quality(rows.length, null, CALIBRATION_AGGREGATE_MODEL_VERSION, Math.round((qualifyingConceptCount / byConcept.size) * 100)),
  });
}

/** Read-only. One query, optionally scoped to a subject via a concept_id list. */
export async function readAggregateCalibration(studentId: string, conceptIds?: string[]): Promise<MetricResult<AggregateCalibrationSummary>> {
  const result = conceptIds
    ? await db.query<ConfidenceRow>(
        `SELECT concept_id, confidence_before_answer, result FROM learning_evidence
         WHERE student_id = $1 AND concept_id = ANY($2) AND confidence_before_answer IS NOT NULL`,
        [studentId, conceptIds]
      )
    : await db.query<ConfidenceRow>(
        `SELECT concept_id, confidence_before_answer, result FROM learning_evidence
         WHERE student_id = $1 AND confidence_before_answer IS NOT NULL`,
        [studentId]
      );
  return computeAggregateCalibration(result.rows);
}
