/**
 * Learner Model (Phase 1): the new dimensions the brief asks for --
 * Retention, Independent Mastery, Evidence Strength, Confidence,
 * Confidence Calibration, Evidence Coverage -- computed on demand from
 * data that already exists (mastery_records, learning_evidence), not
 * stored/cached anywhere yet.
 *
 * Deliberately not persisted, same reasoning the codebase already
 * applies to forgetting_risk: a stored value decays out of date
 * immediately, so it's always recomputed from the underlying evidence
 * at read time. If this ever becomes a hot path (e.g. computed for
 * every concept on every Progress page load), a cached
 * learner_concept_state table is the natural next step -- not needed
 * yet since nothing surfaces this broadly today.
 *
 * Mastery itself is untouched: this module only reads mastery_records,
 * it never writes to it.
 */

import { db } from '@/lib/db';
import { calculateReviewIntervalDays, calculateForgettingRisk } from '@/lib/algorithms/spaced-repetition';

export type EvidenceStrength = 'LOW' | 'MEDIUM' | 'HIGH';
// Matches the DB CHECK constraint on learning_evidence.confidence_before_answer
// (migration 021) exactly -- NOT_SURE/SOMEWHAT_SURE/VERY_SURE, not a generic
// LOW/MEDIUM/HIGH scale, since that schema already existed before this dimension
// was wired up and the brief calls for reusing it rather than adding a new one.
export type ConfidenceLevel = 'NOT_SURE' | 'SOMEWHAT_SURE' | 'VERY_SURE';
export type CalibrationLabel = 'OVERCONFIDENT' | 'WELL_CALIBRATED' | 'UNDERCONFIDENT' | 'INSUFFICIENT_EVIDENCE';

/** How each self-reported confidence level maps onto a 0-1 scale for calibration math. */
const CONFIDENCE_NUMERIC: Record<ConfidenceLevel, number> = { NOT_SURE: 0.33, SOMEWHAT_SURE: 0.66, VERY_SURE: 1.0 };
/** How each graded result maps onto the same 0-1 scale. */
const RESULT_NUMERIC: Record<string, number> = { correct: 1, partial: 0.5, incorrect: 0 };

/** Fewer than this many confidence+result pairs isn't enough to call a concept over/under/well-calibrated. */
const CALIBRATION_MIN_SAMPLES = 3;
/** abs(avg signed diff) below this counts as "well calibrated" rather than over/underconfident. */
const CALIBRATION_NEUTRAL_BAND = 0.2;

export interface ConfidenceCalibration {
  score: number | null; // 0-100, higher = confidence tracks performance more closely
  label: CalibrationLabel;
  samples: number;
}

/**
 * Confidence Calibration: how closely a student's self-reported
 * confidence tracks their actual performance, over confidence+result
 * pairs where confidence was actually captured (see Confidence Capture
 * below -- most evidence has no confidence attached, and only the
 * subset that does counts here).
 *
 * signedDiff = confidenceNumeric - resultNumeric, averaged:
 *   > +0.2  -> OVERCONFIDENT   (reports more certainty than performance shows)
 *   < -0.2  -> UNDERCONFIDENT  (reports less certainty than performance shows)
 *   else    -> WELL_CALIBRATED
 * score = 100 - avg(abs(signedDiff)) * 100 -- a single 0-100 number for
 * display, independent of the directional label.
 *
 * Requires >= 3 samples; returns { score: null, label: INSUFFICIENT_EVIDENCE }
 * otherwise -- one bad guess is not a diagnosis.
 */
export function computeConfidenceCalibration(
  pairs: { confidence: ConfidenceLevel; result: string }[]
): ConfidenceCalibration {
  if (pairs.length < CALIBRATION_MIN_SAMPLES) {
    return { score: null, label: 'INSUFFICIENT_EVIDENCE', samples: pairs.length };
  }
  const diffs = pairs.map((p) => CONFIDENCE_NUMERIC[p.confidence] - (RESULT_NUMERIC[p.result] ?? 0));
  const avgSignedDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const avgAbsDiff = diffs.reduce((a, b) => a + Math.abs(b), 0) / diffs.length;
  const label: CalibrationLabel =
    avgSignedDiff > CALIBRATION_NEUTRAL_BAND
      ? 'OVERCONFIDENT'
      : avgSignedDiff < -CALIBRATION_NEUTRAL_BAND
      ? 'UNDERCONFIDENT'
      : 'WELL_CALIBRATED';
  return { score: Math.max(0, Math.round((1 - avgAbsDiff) * 100)), label, samples: pairs.length };
}

/** Average self-reported confidence (0-100). Null with zero captured samples -- not 0%. */
export function computeAverageConfidence(levels: ConfidenceLevel[]): number | null {
  if (levels.length === 0) return null;
  return Math.round((levels.reduce((sum, l) => sum + CONFIDENCE_NUMERIC[l], 0) / levels.length) * 100);
}

/**
 * Deterministic sampling rule for when to ask "how confident are you?"
 * before a question, instead of every question (fatigue). Any one
 * condition triggers it:
 *   - first evidence ever for this concept (no mastery_records row yet)
 *   - a SOLO-mode quiz (cumulative_assessment/exam_simulation) -- these
 *     are exactly the attempts Independent Mastery draws on, so pairing
 *     them with a confidence read is the highest-value moment for
 *     calibration
 *   - mastery and independent mastery disagree by >= 20 points -- the
 *     concept where "looks fine overall but shaky alone" (or vice
 *     versa) is exactly where confidence is most informative
 *   - periodic resampling every 5th attempt on a concept, so
 *     calibration keeps getting fresh data even on concepts that never
 *     trigger the other rules
 */
export function shouldAskConfidence(input: {
  quizMode: 'topic_practice' | 'review' | 'quick_check' | 'retention_check' | 'cumulative_assessment' | 'exam_simulation';
  hasExistingMasteryRecord: boolean;
  masteryScore: number | null;
  independentMastery: number | null;
  attemptCount: number;
}): boolean {
  if (!input.hasExistingMasteryRecord) return true;
  if (input.quizMode === 'cumulative_assessment' || input.quizMode === 'exam_simulation') return true;
  if (
    input.masteryScore !== null &&
    input.independentMastery !== null &&
    Math.abs(input.masteryScore - input.independentMastery) >= 20
  ) {
    return true;
  }
  if (input.attemptCount > 0 && input.attemptCount % 5 === 0) return true;
  return false;
}

/**
 * Retention (0-100): how likely the student is to still retrieve this
 * concept right now, given how long it's been since they last
 * practiced relative to the spaced-repetition interval that was set
 * for them. The inverse of the existing forgetting-risk calculation --
 * no new algorithm, just a normalization for display.
 *
 * Returns null when there's no practice history yet ("not enough
 * evidence" is a real, distinct state from "0% retention").
 */
export function getRetention(
  masteryScore: number,
  confidenceScore: number,
  lastPracticed: Date | string | null
): number | null {
  if (!lastPracticed) return null;
  const daysSincePractice = Math.floor((Date.now() - new Date(lastPracticed).getTime()) / (1000 * 60 * 60 * 24));
  const intervalDays = calculateReviewIntervalDays(masteryScore, confidenceScore);
  const forgettingRisk = calculateForgettingRisk(daysSincePractice, intervalDays);
  return 100 - forgettingRisk;
}

/**
 * Independent Mastery (0-100): can the student demonstrate this
 * concept without hints or tutor help? Averages the result (correct
 * =100, partial=50, incorrect=0) of the student's most recent
 * unassisted (ai_assistance_type = 'NONE') evidence for this concept.
 *
 * Deliberately ignores assisted attempts entirely rather than
 * discounting them -- mixing assisted and unassisted evidence into one
 * number would hide exactly the distinction this dimension exists to
 * show. Returns null with fewer than 2 unassisted data points (not
 * enough evidence to say anything about independent performance yet,
 * as opposed to "0% independent").
 */
export async function getIndependentMastery(studentId: string, conceptId: string): Promise<number | null> {
  const result = await db.query(
    `
    SELECT result FROM learning_evidence
    WHERE student_id = $1 AND concept_id = $2 AND ai_assistance_type = 'NONE'
    ORDER BY timestamp DESC
    LIMIT 10
    `,
    [studentId, conceptId]
  );

  if (result.rows.length < 2) return null;

  const scores = result.rows.map((r) => (r.result === 'correct' ? 100 : r.result === 'partial' ? 50 : 0));
  return Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length);
}

/**
 * Evidence Strength: how much (and how good) evidence backs the
 * current mastery number for this concept -- quantity, recency,
 * diversity of assessment type, and whether any of it came from a
 * real school exam (the highest-confidence source type that exists).
 *
 * Deterministic point score, not an LLM judgment call:
 *   quantity  (attempts, capped)         0-50
 *   recency   (practiced in last 30d)    0-20
 *   diversity (2+ distinct source types) 0-15
 *   real exam evidence present           0-15
 * >=60 HIGH, >=30 MEDIUM, else LOW. Null with zero attempts.
 */
export async function getEvidenceStrength(studentId: string, conceptId: string): Promise<EvidenceStrength | null> {
  const masteryRow = await db.query(
    `SELECT attempt_count, last_practiced FROM mastery_records WHERE student_id = $1 AND concept_id = $2`,
    [studentId, conceptId]
  );
  const record = masteryRow.rows[0];
  if (!record || Number(record.attempt_count) === 0) return null;

  const attemptCount = Number(record.attempt_count);
  const daysSincePractice = record.last_practiced
    ? Math.floor((Date.now() - new Date(record.last_practiced).getTime()) / (1000 * 60 * 60 * 24))
    : Infinity;

  const evidenceRows = await db.query(
    `SELECT DISTINCT source_type FROM learning_evidence WHERE student_id = $1 AND concept_id = $2`,
    [studentId, conceptId]
  );
  const sourceTypes = new Set(evidenceRows.rows.map((r) => r.source_type));

  let score = Math.min(attemptCount, 5) * 10;
  score += daysSincePractice <= 14 ? 20 : daysSincePractice <= 30 ? 10 : 0;
  score += sourceTypes.size >= 2 ? 15 : 0;
  score += sourceTypes.has('REAL_SCHOOL_EXAM') ? 15 : 0;

  if (score >= 60) return 'HIGH';
  if (score >= 30) return 'MEDIUM';
  return 'LOW';
}

/**
 * Confidence (0-100): average self-reported confidence across every
 * captured sample for this concept (see Confidence Capture -- only a
 * subset of evidence has this at all). Null with zero captured samples.
 */
export async function getConfidence(studentId: string, conceptId: string): Promise<number | null> {
  const rows = await db.query(
    `SELECT confidence_before_answer FROM learning_evidence
     WHERE student_id = $1 AND concept_id = $2 AND confidence_before_answer IS NOT NULL`,
    [studentId, conceptId]
  );
  return computeAverageConfidence(rows.rows.map((r) => r.confidence_before_answer as ConfidenceLevel));
}

/** Confidence Calibration for a single concept -- see computeConfidenceCalibration for the math. */
export async function getConfidenceCalibration(studentId: string, conceptId: string): Promise<ConfidenceCalibration> {
  const rows = await db.query(
    `SELECT confidence_before_answer, result FROM learning_evidence
     WHERE student_id = $1 AND concept_id = $2 AND confidence_before_answer IS NOT NULL`,
    [studentId, conceptId]
  );
  return computeConfidenceCalibration(
    rows.rows.map((r) => ({ confidence: r.confidence_before_answer as ConfidenceLevel, result: r.result as string }))
  );
}

export interface LearnerConceptState {
  masteryScore: number;
  retention: number | null;
  independentMastery: number | null;
  evidenceStrength: EvidenceStrength | null;
  confidence: number | null;
  confidenceCalibration: ConfidenceCalibration;
}

export interface EvidenceCoverage {
  totalConcepts: number;
  evidencedConcepts: number;
  percent: number;
}

export interface LearnerModelSummary {
  avgRetention: number | null;
  avgIndependentMastery: number | null;
  avgConfidenceCalibration: number | null;
  conceptsWithRetention: number;
  conceptsWithIndependentMastery: number;
  evidenceCoverage: EvidenceCoverage | null;
}

export interface SubjectLearnerModel {
  avgMastery: number | null;
  avgRetention: number | null;
  avgIndependentMastery: number | null;
  avgConfidenceCalibration: number | null;
  evidenceCoverage: EvidenceCoverage | null;
  activeLearningDebtCount: number;
  atRiskCount: number;
}

/** Per-concept intelligence bundle used to aggregate Topic/Subtopic views without N+1 queries. */
export interface ConceptIntelligenceLite {
  independentMastery: number | null;
  confidenceCalibration: number | null;
}

/**
 * What fraction of a subject's (or, with no subjectId, every active
 * subject's) concepts have ever been attempted at all -- distinct from
 * Mastery, which only describes the concepts that already have
 * evidence. Null when the scope has zero concepts (nothing to cover
 * yet, not 0% coverage).
 */
export async function getEvidenceCoverage(studentId: string, subjectId?: string): Promise<EvidenceCoverage | null> {
  const totalResult = await db.query(
    subjectId
      ? `SELECT COUNT(*)::int AS count FROM concepts WHERE subject_id = $1`
      : `SELECT COUNT(*)::int AS count FROM concepts c JOIN subjects s ON s.id = c.subject_id WHERE s.student_id = $1 AND s.status = 'active'`,
    subjectId ? [subjectId] : [studentId]
  );
  const totalConcepts = Number(totalResult.rows[0].count);
  if (totalConcepts === 0) return null;

  const evidencedResult = await db.query(
    subjectId
      ? `SELECT COUNT(*)::int AS count FROM mastery_records WHERE student_id = $1 AND subject_id = $2`
      : `SELECT COUNT(*)::int AS count FROM mastery_records mr JOIN subjects s ON s.id = mr.subject_id WHERE mr.student_id = $1 AND s.status = 'active'`,
    subjectId ? [studentId, subjectId] : [studentId]
  );
  const evidencedConcepts = Number(evidencedResult.rows[0].count);

  return { totalConcepts, evidencedConcepts, percent: Math.round((evidencedConcepts / totalConcepts) * 100) };
}

/**
 * Batched Independent Mastery + Confidence Calibration for a list of
 * concept IDs (a subject's concepts, typically) -- one raw query over
 * learning_evidence grouped in memory by concept_id, instead of N
 * per-concept round trips. Used by Topic/Subtopic aggregation.
 */
export async function getConceptIntelligenceBatch(
  studentId: string,
  conceptIds: string[]
): Promise<Map<string, ConceptIntelligenceLite>> {
  const result = new Map<string, ConceptIntelligenceLite>();
  if (conceptIds.length === 0) return result;

  const rows = await db.query(
    `SELECT concept_id, ai_assistance_type, result, confidence_before_answer
     FROM learning_evidence
     WHERE student_id = $1 AND concept_id = ANY($2)
     ORDER BY timestamp DESC`,
    [studentId, conceptIds]
  );

  const byConcept = new Map<string, typeof rows.rows>();
  for (const row of rows.rows) {
    const list = byConcept.get(row.concept_id) || [];
    list.push(row);
    byConcept.set(row.concept_id, list);
  }

  for (const conceptId of conceptIds) {
    const rowsForConcept = byConcept.get(conceptId) || [];

    const unassisted = rowsForConcept.filter((r) => r.ai_assistance_type === 'NONE').slice(0, 10);
    const independentMastery =
      unassisted.length >= 2
        ? Math.round(
            unassisted.reduce((sum, r) => sum + (r.result === 'correct' ? 100 : r.result === 'partial' ? 50 : 0), 0) /
              unassisted.length
          )
        : null;

    const withConfidence = rowsForConcept.filter((r) => r.confidence_before_answer !== null);
    const calibration = computeConfidenceCalibration(
      withConfidence.map((r) => ({ confidence: r.confidence_before_answer as ConfidenceLevel, result: r.result as string }))
    );

    result.set(conceptId, { independentMastery, confidenceCalibration: calibration.score });
  }

  return result;
}

/**
 * Bundles Mastery, Retention, Independent Mastery, Confidence
 * Calibration, Evidence Coverage, active Learning Debt and At-Risk
 * count into one object for a single subject -- the "Subject
 * Intelligence" view. Same null-safety rules as the per-concept
 * functions: a dimension is null when there isn't enough evidence for
 * it yet, never 0.
 */
export async function getSubjectLearnerModel(studentId: string, subjectId: string): Promise<SubjectLearnerModel> {
  const masteryRows = await db.query(
    `SELECT concept_id, mastery_score, confidence_score, last_practiced FROM mastery_records WHERE student_id = $1 AND subject_id = $2`,
    [studentId, subjectId]
  );
  const masteryScores: number[] = [];
  const retentions: number[] = [];
  let atRiskCount = 0;
  for (const row of masteryRows.rows) {
    masteryScores.push(Number(row.mastery_score));
    const r = getRetention(Number(row.mastery_score), Number(row.confidence_score), row.last_practiced);
    if (r !== null) {
      retentions.push(r);
      if (r < 50) atRiskCount++;
    }
  }

  const conceptIds = masteryRows.rows.map((r) => r.concept_id as string);
  const intelligence = await getConceptIntelligenceBatch(studentId, conceptIds);
  const independentScores = [...intelligence.values()].flatMap((v) => (v.independentMastery !== null ? [v.independentMastery] : []));
  const calibrationScores = [...intelligence.values()].flatMap((v) => (v.confidenceCalibration !== null ? [v.confidenceCalibration] : []));

  const debtResult = await db.query(
    `SELECT COUNT(*)::int AS count FROM learning_debt WHERE student_id = $1 AND subject_id = $2 AND status IN ('active', 'monitoring')`,
    [studentId, subjectId]
  );

  const evidenceCoverage = await getEvidenceCoverage(studentId, subjectId);

  return {
    avgMastery: masteryScores.length ? Math.round(masteryScores.reduce((a, b) => a + b, 0) / masteryScores.length) : null,
    avgRetention: retentions.length ? Math.round(retentions.reduce((a, b) => a + b, 0) / retentions.length) : null,
    avgIndependentMastery: independentScores.length
      ? Math.round(independentScores.reduce((a, b) => a + b, 0) / independentScores.length)
      : null,
    avgConfidenceCalibration: calibrationScores.length
      ? Math.round(calibrationScores.reduce((a, b) => a + b, 0) / calibrationScores.length)
      : null,
    evidenceCoverage,
    activeLearningDebtCount: Number(debtResult.rows[0].count),
    atRiskCount,
  };
}

/**
 * Student-wide averages for Progress's "Your Learning" section.
 * Bounded number of queries no matter how many concepts the student
 * has -- averaging happens in memory, not per-concept round trips.
 * Returns null averages when there isn't enough evidence anywhere yet,
 * rather than a misleading 0.
 */
export async function getLearnerModelSummary(studentId: string): Promise<LearnerModelSummary> {
  const masteryRows = await db.query(
    `SELECT mr.concept_id, mr.mastery_score, mr.confidence_score, mr.last_practiced
     FROM mastery_records mr JOIN subjects s ON s.id = mr.subject_id
     WHERE mr.student_id = $1 AND s.status = 'active'`,
    [studentId]
  );
  const retentions: number[] = [];
  for (const row of masteryRows.rows) {
    const r = getRetention(Number(row.mastery_score), Number(row.confidence_score), row.last_practiced);
    if (r !== null) retentions.push(r);
  }

  const conceptIds = masteryRows.rows.map((r) => r.concept_id as string);
  const intelligence = await getConceptIntelligenceBatch(studentId, conceptIds);
  const independentScores = [...intelligence.values()].flatMap((v) => (v.independentMastery !== null ? [v.independentMastery] : []));
  const calibrationScores = [...intelligence.values()].flatMap((v) => (v.confidenceCalibration !== null ? [v.confidenceCalibration] : []));

  return {
    avgRetention: retentions.length ? Math.round(retentions.reduce((a, b) => a + b, 0) / retentions.length) : null,
    avgIndependentMastery: independentScores.length
      ? Math.round(independentScores.reduce((a, b) => a + b, 0) / independentScores.length)
      : null,
    avgConfidenceCalibration: calibrationScores.length
      ? Math.round(calibrationScores.reduce((a, b) => a + b, 0) / calibrationScores.length)
      : null,
    conceptsWithRetention: retentions.length,
    conceptsWithIndependentMastery: independentScores.length,
    evidenceCoverage: await getEvidenceCoverage(studentId),
  };
}

/** Combines all Learner Model dimensions for one student+concept in a single call. */
export async function getLearnerConceptState(studentId: string, conceptId: string): Promise<LearnerConceptState | null> {
  const masteryRow = await db.query(
    `SELECT mastery_score, confidence_score, last_practiced FROM mastery_records WHERE student_id = $1 AND concept_id = $2`,
    [studentId, conceptId]
  );
  const record = masteryRow.rows[0];
  if (!record) return null;

  const [independentMastery, evidenceStrength, confidence, confidenceCalibration] = await Promise.all([
    getIndependentMastery(studentId, conceptId),
    getEvidenceStrength(studentId, conceptId),
    getConfidence(studentId, conceptId),
    getConfidenceCalibration(studentId, conceptId),
  ]);

  return {
    masteryScore: Number(record.mastery_score),
    retention: getRetention(Number(record.mastery_score), Number(record.confidence_score), record.last_practiced),
    independentMastery,
    evidenceStrength,
    confidence,
    confidenceCalibration,
  };
}

export interface ConceptEvidenceHistoryItem {
  timestamp: string;
  sourceType: string;
  result: 'correct' | 'partial' | 'incorrect';
  scorePercent: number | null;
  learningMode: 'SOLO' | 'COACH' | 'AI_NATIVE' | null;
  hintsUsed: number;
}

/**
 * Every individual quiz/exam attempt recorded for a concept, most
 * recent first -- the raw event log behind the aggregate counts in
 * "Why StudyUS thinks this". Distinct from that summary: this is for
 * a student who wants to see each attempt, not just a total.
 */
export async function getConceptEvidenceHistory(
  studentId: string,
  conceptId: string,
  limit: number = 20
): Promise<ConceptEvidenceHistoryItem[]> {
  const rows = await db.query(
    `SELECT timestamp, source_type, result, score_percent, learning_mode, hints_used
     FROM learning_evidence
     WHERE student_id = $1 AND concept_id = $2
     ORDER BY timestamp DESC
     LIMIT $3`,
    [studentId, conceptId, limit]
  );
  return rows.rows.map((r) => ({
    timestamp: r.timestamp,
    sourceType: r.source_type,
    result: r.result,
    scorePercent: r.score_percent !== null ? Number(r.score_percent) : null,
    learningMode: r.learning_mode,
    hintsUsed: Number(r.hints_used || 0),
  }));
}

export interface ConceptEvidenceSummary {
  totalAttempts: number;
  correctAttempts: number;
  soloAttempts: number;
  soloCorrect: number;
  hintsUsedTotal: number;
  realExamCount: number;
  realExamAvgScore: number | null;
  lastEvidenceDate: Date | string | null;
  lastIndependentEvidenceDate: Date | string | null;
}

/**
 * The evidence behind a concept's numbers, summarized for "Why
 * StudyUS thinks this" on Concept Detail -- never raw-event-log, but
 * every number here is a direct count/aggregate over real
 * learning_evidence rows, not an LLM's characterization of them.
 */
export async function getConceptEvidenceSummary(studentId: string, conceptId: string): Promise<ConceptEvidenceSummary> {
  const rows = await db.query(
    `SELECT source_type, result, ai_assistance_type, hints_used, timestamp
     FROM learning_evidence WHERE student_id = $1 AND concept_id = $2 ORDER BY timestamp DESC`,
    [studentId, conceptId]
  );

  const realExamRows = rows.rows.filter((r) => r.source_type === 'REAL_SCHOOL_EXAM');
  const independentRows = rows.rows.filter((r) => r.ai_assistance_type === 'NONE');

  return {
    totalAttempts: rows.rows.length,
    correctAttempts: rows.rows.filter((r) => r.result === 'correct').length,
    soloAttempts: independentRows.length,
    soloCorrect: independentRows.filter((r) => r.result === 'correct').length,
    hintsUsedTotal: rows.rows.reduce((sum, r) => sum + Number(r.hints_used || 0), 0),
    realExamCount: realExamRows.length,
    realExamAvgScore: realExamRows.length
      ? Math.round(
          (realExamRows.reduce((sum, r) => sum + (RESULT_NUMERIC[r.result] ?? 0), 0) / realExamRows.length) * 100
        )
      : null,
    lastEvidenceDate: rows.rows[0]?.timestamp ?? null,
    lastIndependentEvidenceDate: independentRows[0]?.timestamp ?? null,
  };
}
