/**
 * Learner Model (Phase 1): the new dimensions the brief asks for --
 * Retention, Independent Mastery, Evidence Strength -- computed on
 * demand from data that already exists (mastery_records,
 * learning_evidence), not stored/cached anywhere yet.
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

export interface LearnerConceptState {
  masteryScore: number;
  retention: number | null;
  independentMastery: number | null;
  evidenceStrength: EvidenceStrength | null;
}

export interface LearnerModelSummary {
  avgRetention: number | null;
  avgIndependentMastery: number | null;
  conceptsWithRetention: number;
  conceptsWithIndependentMastery: number;
}

/**
 * Student-wide averages for Progress's "Your Learning" section. Two
 * queries total no matter how many concepts the student has (one for
 * mastery_records, one grouped over learning_evidence) -- averaging
 * happens in memory, not per-concept round trips. Returns null
 * averages when there isn't enough evidence anywhere yet, rather than
 * a misleading 0.
 */
export async function getLearnerModelSummary(studentId: string): Promise<LearnerModelSummary> {
  const masteryRows = await db.query(
    `SELECT mastery_score, confidence_score, last_practiced FROM mastery_records WHERE student_id = $1`,
    [studentId]
  );
  const retentions: number[] = [];
  for (const row of masteryRows.rows) {
    const r = getRetention(Number(row.mastery_score), Number(row.confidence_score), row.last_practiced);
    if (r !== null) retentions.push(r);
  }

  const evidenceRows = await db.query(
    `
    SELECT
      COUNT(*) FILTER (WHERE ai_assistance_type = 'NONE') AS unassisted_count,
      COUNT(*) FILTER (WHERE ai_assistance_type = 'NONE' AND result = 'correct') AS unassisted_correct
    FROM learning_evidence
    WHERE student_id = $1
    GROUP BY concept_id
    `,
    [studentId]
  );
  const independentScores: number[] = [];
  for (const row of evidenceRows.rows) {
    const count = Number(row.unassisted_count);
    if (count >= 2) independentScores.push((Number(row.unassisted_correct) / count) * 100);
  }

  return {
    avgRetention: retentions.length ? Math.round(retentions.reduce((a, b) => a + b, 0) / retentions.length) : null,
    avgIndependentMastery: independentScores.length
      ? Math.round(independentScores.reduce((a, b) => a + b, 0) / independentScores.length)
      : null,
    conceptsWithRetention: retentions.length,
    conceptsWithIndependentMastery: independentScores.length,
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

  const [independentMastery, evidenceStrength] = await Promise.all([
    getIndependentMastery(studentId, conceptId),
    getEvidenceStrength(studentId, conceptId),
  ]);

  return {
    masteryScore: Number(record.mastery_score),
    retention: getRetention(Number(record.mastery_score), Number(record.confidence_score), record.last_practiced),
    independentMastery,
    evidenceStrength,
  };
}
