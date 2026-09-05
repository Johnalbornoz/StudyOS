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
import { getInterventionStateForConcept } from '@/services/remediation.service';
import { getConceptValidationState, getKVR14 } from '@/services/validation-cycle.service';
import { getAssessmentStateForConcept } from '@/services/assessment-verification.service';
import { getErrorPatterns } from '@/services/error-intelligence.service';
import { getTransferScore } from '@/services/transfer.service';
// Step 6I: getRetention/calculateForgettingRisk/calculateReviewIntervalDays
// (the legacy spaced-repetition formula) are deliberately NOT imported
// here anymore -- Twin's canonical forgettingRisk/nextReviewAt/
// lastRetrievalAt now come exclusively from Phase 6 via
// memory-read.service.ts (see toRetentionSignal/toMemorySignal below).
import { getTwinMemorySignal, getTwinMemorySignalsForStudent, type TwinMemorySignal } from '@/services/memory-read.service';
import { tryMasteryScore, masteryToPercent, averageMasteryScore } from '@/lib/mastery-format';
import type {
  StudentId,
  SignalQuality,
  MasterySignal,
  KnowledgeStateSignal,
  RetentionSignal,
  MemorySignal,
  SubjectMemorySummary,
  MemoryOverviewSummary,
  TransferSignal,
  MetacognitionSignal,
  IndependenceSignal,
  MisconceptionSummary,
  InterventionState,
  ConceptValidationState,
  AssessmentState,
  EvidenceSummary,
  ErrorPatternSummary,
  StateTransitionEvent,
  LanguageContext,
  AcademicContext,
  SubjectAcademicContext,
  PlanningContext,
  AssessmentPressure,
  ResponseTimingSignal,
  ResponseTimingObservation,
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
const behaviorObservation = (lastUpdatedAt: string | null, sampleSize: number): SignalQuality => ({
  sourceType: 'BEHAVIOR_OBSERVATION',
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

/**
 * Direct source: mastery_records (a fresh, minimal query).
 *
 * Step 6J-B2: no longer selects next_review_date -- a fresh
 * repository-wide search found zero readers of this row's
 * (now-removed) nextReviewDate field anywhere in the Twin (every
 * consumer already sources review timing from Phase 6's
 * concept_memory_state.next_review_at via TwinMemorySignal/
 * MemorySignal instead). The mastery_records.next_review_date column
 * itself, and mastery.service.ts's write to it, are unchanged.
 */
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
  updatedAt: string | null;
} | null> {
  const result = await db.query(
    `SELECT mastery_score, confidence_score, attempt_count, correct_count, incorrect_count, last_practiced, updated_at
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
 * dimension (already computed, and itself a Phase 6 mirror since Step
 * 6G -- see knowledge-state.service.ts's own doc comment on
 * `retentionScore`). forgettingRisk/nextReviewAt come from Phase 6's
 * canonical memory signal (`memorySignal`, read via
 * memory-read.service.ts::getTwinMemorySignal) -- Step 6I removes the
 * legacy spaced-repetition.ts computation entirely; Twin computes no
 * formula of its own. `memorySignal` is null when no
 * concept_memory_state row exists yet -- these fields become null in
 * that case, never a fallback to mastery_records, never a fabricated
 * zero (Step 6I Section 11).
 *
 * Step 6J-B2: lastRetrievalAt (Step 6I's compatibility mapping for the
 * ambiguous legacy field name) was removed from RetentionSignal
 * entirely -- a fresh repository-wide search found zero readers of it
 * anywhere, so this function no longer populates it.
 */
export function toRetentionSignal(
  masteryRow: NonNullable<Awaited<ReturnType<typeof readMasteryRow>>> | null,
  retentionDimension: number | null,
  memorySignal: TwinMemorySignal | null
): RetentionSignal {
  return {
    retentionScore: retentionDimension,
    forgettingRisk: memorySignal?.forgettingRisk ?? null,
    nextReviewAt: memorySignal?.nextReviewAt ?? null,
    quality: derived(masteryRow?.updatedAt ?? null),
  };
}

/**
 * Step 6I: the full Phase 6B memory contract for one concept (Section
 * 3) -- ConceptView's canonical memory detail. `quality.sourceType` is
 * a DIFFERENT axis from `predictionConfidence` (Section 12): quality
 * describes data completeness/provenance (do we have a
 * concept_memory_state row at all, and how was it derived), while
 * predictionConfidence describes how much to trust the specific
 * retrievabilityNow/forgettingRisk NUMBER Phase 6 just computed
 * (LOW when no successful retention proof exists yet). Never conflated.
 * `memoryStatus: 'NOT_ESTABLISHED'` / `policyVersion: null` is the
 * honest "no canonical memory state yet" representation when
 * `memorySignal` is null -- never retention=0, forgettingRisk=0, or a
 * legacy-sourced nextReviewAt.
 */
export function toMemorySignal(memorySignal: TwinMemorySignal | null): MemorySignal {
  if (!memorySignal) {
    return {
      demonstratedRetentionScore: null,
      retentionEvidenceCount: 0,
      memoryStatus: 'NOT_ESTABLISHED',
      memoryStability: 'UNSTABLE',
      consecutiveQualifyingSuccesses: 0,
      initialCompetenceAnchorAt: null,
      lastQualifiedAttemptAt: null,
      lastSuccessfulRetentionAt: null,
      lastUnsuccessfulRetentionAt: null,
      nextReviewAt: null,
      retentionDue: false,
      daysOverdue: null,
      retrievabilityNow: null,
      forgettingRisk: null,
      predictionConfidence: 'LOW',
      policyVersion: null,
      quality: derived(null),
    };
  }
  return { ...memorySignal, quality: derived(null) };
}

/**
 * Step 6I Section 5/28: subject-level memory DISPLAY AGGREGATE only --
 * never fed to Phase 4. Averages exclude concepts with a null value
 * from BOTH the sum and the denominator (a null demonstratedRetentionScore
 * is "not yet proven," not zero); `conceptsWithMemoryState` reports how
 * many of the subject's concepts had a row at all, so a caller can tell
 * "average of 2" from "average of 20" at a glance. Status counts are
 * over every concept WITH a row (a concept with none contributes to
 * none of the status buckets -- it is simply absent from this subject's
 * memory picture yet, not silently folded into NOT_ESTABLISHED).
 */
export function aggregateSubjectMemorySummary(signals: TwinMemorySignal[]): SubjectMemorySummary {
  const demonstrated = signals.flatMap((s) => (s.demonstratedRetentionScore !== null ? [s.demonstratedRetentionScore] : []));
  const retrievability = signals.flatMap((s) => (s.retrievabilityNow !== null ? [s.retrievabilityNow] : []));
  const avg = (values: number[]): number | null => (values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100 : null);

  return {
    avgDemonstratedRetentionScore: avg(demonstrated),
    avgRetrievabilityNow: avg(retrievability),
    conceptsWithMemoryState: signals.length,
    conceptsDueCount: signals.filter((s) => s.retentionDue).length,
    conceptsAtRiskCount: signals.filter((s) => s.memoryStatus === 'AT_RISK').length,
    stableConceptsCount: signals.filter((s) => s.memoryStatus === 'STABLE').length,
    waitingForRetentionCount: signals.filter((s) => s.memoryStatus === 'WAITING_FOR_RETENTION').length,
    developingConceptsCount: signals.filter((s) => s.memoryStatus === 'DEVELOPING').length,
    notEstablishedCount: signals.filter((s) => s.memoryStatus === 'NOT_ESTABLISHED').length,
  };
}

/** Step 6I Section 6: Overview's coarse, student-wide memory counts -- transparent counts only, never a fabricated global "memory score." */
export function aggregateMemoryOverview(signals: TwinMemorySignal[]): MemoryOverviewSummary {
  return {
    conceptsDueCount: signals.filter((s) => s.retentionDue).length,
    conceptsAtRiskCount: signals.filter((s) => s.memoryStatus === 'AT_RISK').length,
    stableConceptsCount: signals.filter((s) => s.memoryStatus === 'STABLE').length,
    waitingForRetentionCount: signals.filter((s) => s.memoryStatus === 'WAITING_FOR_RETENTION').length,
    totalConceptsWithMemoryState: signals.length,
  };
}

export { getTwinMemorySignal, getTwinMemorySignalsForStudent };

/** Direct/derived: computeTransferScore over learning_evidence, existing certified algorithm (transfer.service.ts). */
export async function readTransferSignal(studentId: StudentId, conceptId: string): Promise<TransferSignal> {
  const transferScore = await getTransferScore(studentId, conceptId);
  return { transferScore, quality: derived(null) };
}

/**
 * Direct source: student_misconceptions, via the existing certified
 * aggregate function. Phase 2C: activeCount/criticalCount/recurringCount
 * are ACTIVE-only; resolvedCount is exposed too (real learner history,
 * not a current defect). historicalCount (lifetime, active+resolved)
 * exists on the underlying MisconceptionCounts but is deliberately not
 * surfaced here -- the Twin stays a read layer over what a Decision
 * Engine actually needs (current state), not a full misconception
 * history browser.
 */
export async function readMisconceptionSummary(studentId: StudentId, conceptId: string): Promise<MisconceptionSummary> {
  const counts = await getMisconceptionCountsForConcept(studentId, conceptId);
  return { activeCount: counts.activeCount, criticalCount: counts.criticalCount, recurringCount: counts.recurringCount, resolvedCount: counts.resolvedCount, quality: fact() };
}

/** Direct source: cognitive_diagnoses/remediation_paths, via the certified Phase 2D aggregate function (remediation.service.ts::getInterventionStateForConcept). Read-only -- never mutates a diagnosis/path's state. */
export async function readInterventionState(studentId: StudentId, conceptId: string): Promise<InterventionState> {
  const summary = await getInterventionStateForConcept(studentId, conceptId);
  return { ...summary, quality: fact() };
}

/** Direct source: validation_cycles, via the certified Phase 2E aggregate function (validation-cycle.service.ts::getConceptValidationState). Deliberately never calls getActiveValidationCycle/resolveActiveCycle -- see that function's own doc comment on why a mere read must never close an expired cycle. */
export async function readConceptValidationState(studentId: StudentId, conceptId: string): Promise<ConceptValidationState> {
  const summary = await getConceptValidationState(studentId, conceptId);
  return { ...summary, quality: fact() };
}

/**
 * Direct source: learning_evidence + verification_attempts, via the
 * certified Phase 3F/3-R aggregate function
 * (assessment-verification.service.ts::getAssessmentStateForConcept).
 * Read-only -- never resolves a pending verification attempt.
 *
 * Phase 3-R §3.4: `cognitiveDemand` gets its own DETERMINISTIC_DERIVATION
 * quality, distinct from the rest of this summary's SYSTEM_FACT quality
 * -- its values are derived from an AI-tagged question property, never
 * an unquestionable fact, even though the derivation itself is
 * deterministic (see AssessmentState's own doc comment in types.ts).
 */
export async function readAssessmentState(studentId: StudentId, conceptId: string): Promise<AssessmentState> {
  const summary = await getAssessmentStateForConcept(studentId, conceptId);
  return {
    ...summary,
    quality: fact(),
    cognitiveDemand: { ...summary.cognitiveDemand, quality: derived(summary.cognitiveDemand.lastObservedAt, summary.cognitiveDemand.sampleSize) },
  };
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

/**
 * Phase 1D: RAW OBSERVATION read of learning_evidence.metadata.behavior
 * -- no interpretation, no FAST/SLOW/GUESS classification (that is
 * explicitly Phase 1E). Reads only from learning_evidence (no new
 * table), never writes. Scans a bounded window of recent rows
 * (rowLimit, default 20 -- generous enough that a multi-question quiz
 * bucket's evidence row, which itself can carry several observations,
 * doesn't starve the flattened result) and returns at most
 * `observationLimit` (default 10) individual observations, most recent
 * first. A concept with no timing-instrumented evidence yet returns an
 * empty `recentObservations` array -- NO_TIMING_DATA, distinct from a
 * fabricated 0ms or "fast" (Step 19).
 */
export async function readResponseTimingSignal(
  studentId: StudentId,
  conceptId: string,
  observationLimit = 10,
  rowLimit = 20
): Promise<ResponseTimingSignal> {
  const result = await db.query(
    `SELECT timestamp, metadata FROM learning_evidence
     WHERE student_id = $1 AND concept_id = $2 AND metadata IS NOT NULL
     ORDER BY timestamp DESC LIMIT $3`,
    [studentId, conceptId, rowLimit]
  );

  const observations: ResponseTimingObservation[] = [];
  // Phase 1D-R: three mutually exclusive categories -- see
  // ResponseTimingSignal's doc comment in types.ts. No observation is
  // ever counted in more than one bucket.
  let validSampleCount = 0;
  let outlierSampleCount = 0;
  let invalidSampleCount = 0;
  let lastUpdatedAt: string | null = null;

  for (const row of result.rows) {
    const entries = row.metadata?.behavior?.responseTimes;
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (lastUpdatedAt === null) lastUpdatedAt = row.timestamp;
      const hasRealDuration =
        (entry.timingQuality === 'VALID' || entry.timingQuality === 'OUTLIER') &&
        typeof entry.responseTimeMs === 'number' &&
        Number.isFinite(entry.responseTimeMs);

      if (hasRealDuration) {
        // VALID and OUTLIER both have a real duration and both remain
        // visible in recentObservations for transparency -- but only
        // VALID counts toward validSampleCount. OUTLIER is preserved,
        // never silently discarded or clamped, and gets its own
        // dedicated count instead of inflating the usable-sample count
        // (Phase 1D-R: external review finding -- see the Phase 1D-R
        // report for the full before/after).
        if (entry.timingQuality === 'VALID') validSampleCount++;
        else outlierSampleCount++;

        if (observations.length < observationLimit) {
          observations.push({
            responseTimeMs: entry.responseTimeMs,
            timingQuality: entry.timingQuality,
            observedAt: row.timestamp,
            ...(typeof entry.questionIndex === 'number' ? { questionIndex: entry.questionIndex } : {}),
          });
        }
      } else if (entry.timingQuality === 'INVALID' || entry.timingQuality === 'CLOCK_SKEW') {
        invalidSampleCount++;
      }
    }
  }

  return {
    recentObservations: observations,
    validSampleCount,
    outlierSampleCount,
    invalidSampleCount,
    // sampleSize == validSampleCount, strictly -- never inflated by
    // outliers (Phase 1D-R). A future minimum-sample gate reading
    // quality.sampleSize gets exactly the same honest number as
    // validSampleCount itself.
    quality: behaviorObservation(lastUpdatedAt, validSampleCount),
  };
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
