/**
 * Digital Learning Twin -- shared internal sub-readers (Phase 1C).
 *
 * READ-ONLY, by construction and by convention: every function in this
 * file issues SELECT-only queries or calls another already-certified,
 * side-effect-free read function. None of them may call a function
 * that writes -- two existing "read-shaped" functions were found this
 * phase to have hidden write side effects and are deliberately NOT
 * reused here (see the Phase 1C report §19 for the full disclosure):
 *
 *   - mastery.service.ts::getStudentMastery(..., ensureLabels=true)
 *     fire-and-forget writes via ensureConceptLocalizations. This
 *     module always calls it with ensureLabels=false (the default).
 *   - assessment.service.ts::getUpcomingForStudent calls
 *     ensureRecurringOccurrence, which can INSERT a new
 *     assessment_occurrences row. This module reads
 *     assessment_occurrences directly instead (readAssessmentPressure
 *     below), never that function.
 *
 * Every other call below reuses an existing, certified, pure read
 * function or algorithm rather than reimplementing its logic (Phase
 * 1B Step 6 / Phase 1C Step 4) -- see each function's comment for its
 * source.
 */

import { db } from '@/lib/db';
import { getAcademicProfile } from '@/services/academic-profile.service';
import {
  getIndependentMastery,
  getEvidenceStrength,
  getConfidence,
  getConfidenceCalibration,
  getRetention,
  type ConfidenceCalibration,
  type EvidenceStrength,
} from '@/services/learner-model.service';
import {
  getConceptKnowledgeState,
  getSubjectKnowledgeState,
  getActiveMasteryPolicy,
  type ConceptKnowledgeState,
} from '@/services/knowledge-state.service';
import { getMisconceptionCountsForConcept, getRecurringMisconceptions } from '@/services/misconception.service';
import { getErrorPatterns } from '@/services/error-intelligence.service';
import { getTransferScore } from '@/services/transfer.service';
import { calculateForgettingRisk, calculateReviewIntervalDays } from '@/lib/algorithms/spaced-repetition';
import { tryMasteryScore, masteryToPercent, averageMasteryScore } from '@/lib/mastery-format';
import type {
  StudentId,
  SignalQuality,
  MasterySignal,
  KnowledgeStateSignal,
  RetentionSignal,
  TransferSignal,
  MetacognitionSignal,
  IndependenceSignal,
  MisconceptionSummary,
  EvidenceSummary,
  ErrorPatternSummary,
  StateTransitionEvent,
  LanguageContext,
  AcademicContext,
  SubjectAcademicContext,
  PlanningContext,
  AssessmentPressure,
} from './types';

const fact = (lastUpdatedAt: string | null = null): SignalQuality => ({ sourceType: 'SYSTEM_FACT', lastUpdatedAt });
const derived = (lastUpdatedAt: string | null, sampleSize?: number): SignalQuality => ({
  sourceType: 'DETERMINISTIC_DERIVATION',
  lastUpdatedAt,
  ...(sampleSize !== undefined ? { sampleSize } : {}),
});
const selfReport = (lastUpdatedAt: string | null, sampleSize: number): SignalQuality => ({
  sourceType: 'STUDENT_SELF_REPORT',
  lastUpdatedAt,
  sampleSize,
});

// ---------------------------------------------------------------------
// Identity / Academic / Language
// ---------------------------------------------------------------------

/** Direct source: student_academic_profile. */
export async function readAcademicContext(studentId: StudentId): Promise<AcademicContext> {
  const profile = await getAcademicProfile(studentId);
  return {
    countryOfStudy: profile?.countryOfStudy ?? 'OTHER',
    schoolYear: profile?.schoolYear ?? null,
    curriculumType: profile?.curriculumType ?? 'not_sure',
    ibProgramme: profile?.ibProgramme ?? null,
    ibYear: profile?.ibYear ?? null,
    academicYear: profile?.academicYear ?? null,
    schoolName: profile?.schoolName ?? null,
    profileCompleted: profile?.profileCompleted ?? false,
    quality: fact(),
  };
}

interface SubjectAcademicRow {
  ib_subject_group: string | null;
  ib_level: string | null;
  target_language: string | null;
  quiz_language_mode: 'match_interface' | 'fixed_english';
}

function toSubjectAcademicContext(row: SubjectAcademicRow): SubjectAcademicContext {
  return {
    ibSubjectGroup: row.ib_subject_group,
    ibLevel: row.ib_level,
    targetLanguage: row.target_language,
    quizLanguageMode: row.quiz_language_mode,
  };
}

/**
 * Read-time-only language resolution (Phase 1B §17 hierarchy). Does
 * NOT write to user_language_preferences or students.language --
 * students.language is read only as a fallback when no
 * user_language_preferences row exists yet.
 */
export async function readLanguageContext(studentId: StudentId, subjectId?: string): Promise<LanguageContext> {
  const [prefsResult, studentResult, subjectResult] = await Promise.all([
    db.query(
      `SELECT interface_language, preferred_learning_language, source_language FROM user_language_preferences WHERE user_id = $1`,
      [studentId]
    ),
    db.query(`SELECT language FROM students WHERE id = $1`, [studentId]),
    subjectId
      ? db.query(`SELECT target_language, quiz_language_mode FROM subjects WHERE id = $1`, [subjectId])
      : Promise.resolve({ rows: [] as any[] }),
  ]);

  const prefs = prefsResult.rows[0];
  const fallbackLanguage = studentResult.rows[0]?.language ?? 'en';
  const interfaceLanguage = prefs?.interface_language ?? fallbackLanguage;
  const preferredLearningLanguage = prefs?.preferred_learning_language ?? interfaceLanguage;
  const sourceContentLanguage = prefs?.source_language ?? interfaceLanguage;

  const subjectRow = subjectResult.rows[0];

  return {
    interfaceLanguage,
    preferredLearningLanguage,
    sourceContentLanguage,
    ...(subjectRow
      ? {
          subjectInstructionLanguage: subjectRow.target_language ?? preferredLearningLanguage,
          quizLanguageMode: subjectRow.quiz_language_mode,
        }
      : {}),
    quality: fact(),
  };
}

// ---------------------------------------------------------------------
// Subjects
// ---------------------------------------------------------------------

export interface SubjectRow {
  id: string;
  name: string;
  ib_subject_group: string | null;
  ib_level: string | null;
  target_language: string | null;
  quiz_language_mode: 'match_interface' | 'fixed_english';
}

/** Direct source: subjects (active only, matching every other subject listing in the app). */
export async function readSubjects(studentId: StudentId, subjectIds?: string[]): Promise<SubjectRow[]> {
  const result = await db.query(
    subjectIds && subjectIds.length > 0
      ? `SELECT id, name, ib_subject_group, ib_level, target_language, quiz_language_mode
         FROM subjects WHERE student_id = $1 AND status = 'active' AND id = ANY($2) ORDER BY created_at DESC`
      : `SELECT id, name, ib_subject_group, ib_level, target_language, quiz_language_mode
         FROM subjects WHERE student_id = $1 AND status = 'active' ORDER BY created_at DESC`,
    subjectIds && subjectIds.length > 0 ? [studentId, subjectIds] : [studentId]
  );
  return result.rows;
}

export { toSubjectAcademicContext };

// ---------------------------------------------------------------------
// Cognitive state (concept-level)
// ---------------------------------------------------------------------

/** Direct source: mastery_records (a fresh, minimal query -- getMasteryRecord's existing SELECT list omits next_review_date, which this module needs for retention). */
export async function readMasteryRow(
  studentId: StudentId,
  conceptId: string
): Promise<{
  masteryScore: number;
  confidenceScore: number;
  attemptCount: number;
  correctCount: number;
  incorrectCount: number;
  lastPracticed: string | null;
  nextReviewDate: string | null;
  updatedAt: string | null;
} | null> {
  const result = await db.query(
    `SELECT mastery_score, confidence_score, attempt_count, correct_count, incorrect_count, last_practiced, next_review_date, updated_at
     FROM mastery_records WHERE student_id = $1 AND concept_id = $2`,
    [studentId, conceptId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    masteryScore: Number(row.mastery_score),
    confidenceScore: Number(row.confidence_score),
    attemptCount: Number(row.attempt_count),
    correctCount: Number(row.correct_count),
    incorrectCount: Number(row.incorrect_count),
    lastPracticed: row.last_practiced,
    nextReviewDate: row.next_review_date,
    updatedAt: row.updated_at,
  };
}

export function toMasterySignal(row: NonNullable<Awaited<ReturnType<typeof readMasteryRow>>>): MasterySignal {
  return {
    score: row.masteryScore,
    confidenceScore: row.confidenceScore,
    attemptCount: row.attemptCount,
    correctCount: row.correctCount,
    incorrectCount: row.incorrectCount,
    quality: fact(row.updatedAt),
  };
}

/** Direct source: concept_knowledge_state (via the existing, pure, certified read function). */
export async function readKnowledgeStateSignal(studentId: StudentId, conceptId: string): Promise<KnowledgeStateSignal | null> {
  const state: ConceptKnowledgeState | null = await getConceptKnowledgeState(studentId, conceptId);
  if (!state) return null;
  return {
    masteryState: state.masteryState,
    dimensions: {
      understanding: state.understandingScore,
      independence: state.independenceScore,
      application: state.applicationScore,
      retention: state.retentionScore,
      transfer: state.transferScore,
    },
    validationReadiness: state.validationReadiness,
    stateReason: state.stateReason,
    quality: derived(state.updatedAt),
  };
}

/** Derived on read: independentMastery + evidenceStrength, both existing certified algorithms (learner-model.service.ts). */
export async function readIndependenceSignal(studentId: StudentId, conceptId: string): Promise<IndependenceSignal> {
  const [independentMastery, evidenceStrength] = await Promise.all([
    getIndependentMastery(studentId, conceptId),
    getEvidenceStrength(studentId, conceptId),
  ]);
  return { independentMastery, evidenceStrength, quality: derived(null) };
}

/** Derived on read: self-reported confidence average + calibration, both existing certified algorithms. */
export async function readMetacognitionSignal(studentId: StudentId, conceptId: string): Promise<MetacognitionSignal> {
  const [confidence, confidenceCalibration] = await Promise.all([
    getConfidence(studentId, conceptId),
    getConfidenceCalibration(studentId, conceptId),
  ]);
  const quality: SignalQuality =
    confidenceCalibration.samples > 0
      ? selfReport(null, confidenceCalibration.samples)
      : { sourceType: 'STUDENT_SELF_REPORT', lastUpdatedAt: null, sampleSize: 0 };
  return { confidence, confidenceCalibration, quality };
}

/**
 * Derived on read: retentionScore comes from the Knowledge State
 * dimension (already computed); forgettingRisk is computed fresh from
 * the SAME spaced-repetition algorithm mastery.service.ts already
 * uses to set next_review_date -- no new algorithm, no duplicate
 * formula (Phase 1B §19/§17).
 */
export function toRetentionSignal(
  masteryRow: NonNullable<Awaited<ReturnType<typeof readMasteryRow>>> | null,
  retentionDimension: number | null
): RetentionSignal {
  if (!masteryRow) {
    return { retentionScore: retentionDimension, forgettingRisk: null, lastRetrievalAt: null, nextReviewAt: null, quality: derived(null) };
  }
  let forgettingRisk: number | null = null;
  if (masteryRow.lastPracticed) {
    const daysSincePractice = Math.floor((Date.now() - new Date(masteryRow.lastPracticed).getTime()) / (1000 * 60 * 60 * 24));
    const intervalDays = calculateReviewIntervalDays(masteryRow.masteryScore, masteryRow.confidenceScore);
    forgettingRisk = calculateForgettingRisk(daysSincePractice, intervalDays);
  }
  return {
    retentionScore: retentionDimension,
    forgettingRisk,
    lastRetrievalAt: masteryRow.lastPracticed,
    nextReviewAt: masteryRow.nextReviewDate,
    quality: derived(masteryRow.updatedAt),
  };
}

/** Direct/derived: computeTransferScore over learning_evidence, existing certified algorithm (transfer.service.ts). */
export async function readTransferSignal(studentId: StudentId, conceptId: string): Promise<TransferSignal> {
  const transferScore = await getTransferScore(studentId, conceptId);
  return { transferScore, quality: derived(null) };
}

/** Direct source: student_misconceptions, via the existing certified aggregate function. */
export async function readMisconceptionSummary(studentId: StudentId, conceptId: string): Promise<MisconceptionSummary> {
  const counts = await getMisconceptionCountsForConcept(studentId, conceptId);
  return { ...counts, quality: fact() };
}

/** Direct source: learning_evidence, bounded (default last 10) -- never the full history. */
export async function readRecentEvidence(studentId: StudentId, conceptId: string, limit = 10): Promise<EvidenceSummary[]> {
  const result = await db.query(
    `SELECT timestamp, source_type, result, score_percent, ai_assistance_type, learning_mode
     FROM learning_evidence WHERE student_id = $1 AND concept_id = $2 ORDER BY timestamp DESC LIMIT $3`,
    [studentId, conceptId, limit]
  );
  return result.rows.map((r) => ({
    timestamp: r.timestamp,
    sourceType: r.source_type,
    result: r.result,
    scorePercent: r.score_percent !== null ? Number(r.score_percent) : null,
    aiAssistanceType: r.ai_assistance_type,
    learningMode: r.learning_mode,
  }));
}

/** Derived on read: thresholded error-pattern detection, existing certified function (error-intelligence.service.ts), scoped down to one concept. */
export async function readConceptErrorPatterns(studentId: StudentId, subjectId: string, conceptId: string): Promise<ErrorPatternSummary[]> {
  const patterns = await getErrorPatterns(studentId, subjectId);
  return patterns
    .filter((p) => p.topConceptId === conceptId)
    .map((p) => ({ errorType: p.errorType, count: p.topConceptCount, lastOccurredAt: p.lastOccurredAt }));
}

// ---------------------------------------------------------------------
// Planning / Assessment
// ---------------------------------------------------------------------

/** Direct source: student_availability. No existing read function -- this is a new, minimal, pure SELECT (no table found with an existing reader, per Phase 1A). */
export async function readPlanningContext(studentId: StudentId): Promise<PlanningContext> {
  const result = await db.query(
    `SELECT study_start_time, study_end_time, max_daily_minutes, timezone, updated_at FROM student_availability WHERE student_id = $1`,
    [studentId]
  );
  const row = result.rows[0];
  return {
    studyStartTime: row?.study_start_time ?? '16:30:00',
    studyEndTime: row?.study_end_time ?? '18:30:00',
    maxDailyMinutes: row ? Number(row.max_daily_minutes) : 120,
    timezone: row?.timezone ?? 'UTC',
    quality: fact(row?.updated_at ?? null),
  };
}

/**
 * Direct source: assessment_occurrences, read directly with a plain
 * SELECT -- deliberately NOT assessment.service.ts::getUpcomingForStudent,
 * which has a hidden write side effect (ensureRecurringOccurrence).
 * See this file's header comment and the Phase 1C report §19.
 */
export async function readAssessmentPressure(studentId: StudentId, subjectId: string): Promise<AssessmentPressure> {
  const result = await db.query(
    `SELECT scheduled_date, exam_readiness FROM assessment_occurrences ao
     JOIN subjects s ON s.id = ao.subject_id
     WHERE s.id = $2 AND s.student_id = $1
       AND ao.status NOT IN ('cancelled', 'completed', 'result_recorded')
       AND ao.scheduled_date >= CURRENT_DATE
     ORDER BY ao.scheduled_date ASC LIMIT 1`,
    [studentId, subjectId]
  );
  const row = result.rows[0];
  if (!row) return { upcomingOccurrence: false, daysUntil: null, examReadiness: null, quality: fact() };
  const daysUntil = Math.ceil((new Date(row.scheduled_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  return {
    upcomingOccurrence: true,
    daysUntil,
    examReadiness: row.exam_readiness !== null ? Number(row.exam_readiness) : null,
    quality: fact(),
  };
}

// ---------------------------------------------------------------------
// Temporal history (decision_events, Phase 0E2)
// ---------------------------------------------------------------------

/**
 * Bounded read of decision_events for one concept's state-transition
 * history (Phase 1B §9's chosen mechanism -- reuses decision_events,
 * no dedicated history table). Never fetches unbounded history; opt-in
 * only, called solely when getConceptView's options.includeHistory is
 * true. History prior to Phase 0E2's production deployment
 * (2026-08-31) does not exist and is not reconstructed.
 */
export async function readStateHistory(studentId: StudentId, conceptId: string, limit = 20): Promise<StateTransitionEvent[]> {
  const result = await db.query(
    `SELECT decision_id, decision_type, created_at, previous_state, new_state, reason_code
     FROM decision_events
     WHERE student_id = $1 AND concept_id = $2 AND decision_type IN ('MASTERY_UPDATED', 'KNOWLEDGE_STATE_PROJECTED')
     ORDER BY created_at DESC LIMIT $3`,
    [studentId, conceptId, limit]
  );
  return result.rows.map((r) => ({
    decisionId: r.decision_id,
    decisionType: r.decision_type,
    createdAt: r.created_at,
    previousState: r.previous_state,
    newState: r.new_state,
    reasonCode: r.reason_code,
  }));
}

// ---------------------------------------------------------------------
// Bulk / subject-scoped reads (avoid N+1)
// ---------------------------------------------------------------------

export interface SubjectConceptRow {
  concept_id: string;
  label: string;
  mastery_score: string;
  confidence_score: string;
  attempt_count: string;
  correct_count: string;
  incorrect_count: string;
  updated_at: string | null;
}

/** Direct source: mastery_records + concepts, one bulk query -- never one query per concept. */
export async function readSubjectMasteryRows(studentId: StudentId, subjectId: string): Promise<SubjectConceptRow[]> {
  const result = await db.query(
    `SELECT c.id AS concept_id, COALESCE(cl.label, c.canonical_id) AS label,
            mr.mastery_score, mr.confidence_score, mr.attempt_count, mr.correct_count, mr.incorrect_count, mr.updated_at
     FROM mastery_records mr
     JOIN concepts c ON mr.concept_id = c.id
     LEFT JOIN concept_localizations cl ON cl.concept_id = c.id AND cl.language = 'en'
     WHERE mr.student_id = $1 AND mr.subject_id = $2
     ORDER BY mr.updated_at DESC`,
    [studentId, subjectId]
  );
  return result.rows;
}

/** Bulk Knowledge State for a subject -- reuses the existing certified function, one query, no N+1 (Phase 1B §18). */
export { getSubjectKnowledgeState };

/** Reused as-is: the deterministic mastery policy, needed for calibration/independence thresholds if a future caller wants them. */
export { getActiveMasteryPolicy };

/** Reused as-is: recurring misconceptions across a whole student (used for SubjectView/Overview needs-attention). */
export { getRecurringMisconceptions };

/** Evidence coverage: reuses learner-model.service.ts's existing certified function -- not reimplemented. */
export { getEvidenceCoverage } from '@/services/learner-model.service';

export { tryMasteryScore, masteryToPercent, averageMasteryScore };
export type { ConfidenceCalibration, EvidenceStrength };
