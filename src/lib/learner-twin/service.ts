/**
 * Digital Learning Twin -- canonical LearnerModelService (Phase 1C).
 *
 * READ ONLY. Four projections, all built from the shared sub-readers
 * in readers.ts -- never four independent implementations (Phase 1B
 * §22/§23). Existing domain sources (mastery_records,
 * concept_knowledge_state, learning_evidence, verification_attempts,
 * misconception_signatures/student_misconceptions, decision_events,
 * student_academic_profile, subjects, student_availability,
 * assessment_occurrences) remain exactly as certified in Phase 0/1A --
 * this module never writes to any of them, and never recomputes what
 * a certified algorithm already computes (mastery, Knowledge State
 * dimensions, retention, transfer, calibration, evidence strength).
 */

import { db } from '@/lib/db';
import * as R from './readers';
import { getSubjectLearnerModel } from '@/services/learner-model.service';
import { getKVR14 } from '@/services/validation-cycle.service';
import type { InterventionStateSummary } from '@/services/remediation.service';
import type { ConceptValidationSummary } from '@/services/validation-cycle.service';
import type {
  StudentId,
  ProjectionOptions,
  LearnerModel,
  SubjectView,
  ConceptView,
  DecisionContext,
  ConceptSummary,
  NeedsAttentionItem,
  DataQualitySummary,
  DerivedMetricSelection,
} from './types';
import {
  readHelpDependency,
  readLearningVelocity,
  readLearningVelocityForConcepts,
  aggregateLearningVelocity,
  readAggregateCalibration,
  readPrerequisiteGaps,
  readTransferCoverage,
  readStudyPlanAdherence,
  readPersistence,
  metricAvailable,
  metricUnavailable,
  metricRequested,
  METRIC_NOT_REQUESTED,
  ALL_DERIVED_METRIC_NAMES,
  type DerivedMetricName,
  type MetricProjection,
  type MetricResult,
} from './metrics';

const DEFAULT_HISTORY_LIMIT = 20;
const DEFAULT_RECENT_EVIDENCE_LIMIT = 5;

/**
 * Phase 1E-R: which of DecisionContext's future-Decision-Engine-only
 * derived metrics to actually compute this call. Default (undefined)
 * -> empty set -> zero of the three reader functions are even called
 * (not called-then-discarded -- literally skipped), so current live
 * consumers (remediation/cognitive-diagnosis/tutor-strategy, none of
 * which pass this option) pay zero extra query cost. See the Phase
 * 1E-R report §5 for the external-review finding this closes.
 */
function resolveDerivedMetrics(selection: DerivedMetricSelection | undefined): ReadonlySet<DerivedMetricName> {
  if (!selection) return new Set();
  if (selection === 'all') return new Set(ALL_DERIVED_METRIC_NAMES);
  return new Set(selection);
}

function dataQuality(sourcesUsed: DataQualitySummary['sourcesUsed'] = ['SYSTEM_FACT', 'DETERMINISTIC_DERIVATION']): DataQualitySummary {
  return { generatedAt: new Date().toISOString(), sourcesUsed };
}

// ---------------------------------------------------------------------
// getOverview -- student-level, cross-subject, bounded (Phase 1B §9's design)
// ---------------------------------------------------------------------

export async function getOverview(studentId: StudentId, options: ProjectionOptions = {}): Promise<LearnerModel> {
  const [academicContext, languageContext, subjectRows, planningContext, evidenceCoverage, evidencedConceptIds] = await Promise.all([
    R.readAcademicContext(studentId),
    R.readLanguageContext(studentId),
    R.readSubjects(studentId, options.subjectIds),
    R.readPlanningContext(studentId),
    R.getEvidenceCoverage(studentId),
    // Phase 1E: bounded to concepts the student has actually engaged
    // with (a mastery_records row exists) -- never the full curriculum.
    db.query<{ concept_id: string }>(`SELECT concept_id FROM mastery_records WHERE student_id = $1`, [studentId]).then((r) => r.rows.map((row) => row.concept_id)),
  ]);

  // Phase 1E: learner-wide derived metrics. Calibration pools all
  // confidence-tagged evidence in one query; velocity batches all
  // evidenced concepts in 3 fixed-shape queries (readLearningVelocityForConcepts) --
  // neither is one-query-per-concept (Step 28).
  const [calibration, velocityByConcept, studyPlanAdherence, kvr14Result] = await Promise.all([
    readAggregateCalibration(studentId),
    readLearningVelocityForConcepts(studentId, evidencedConceptIds),
    readStudyPlanAdherence(studentId),
    // Phase 2E: student-scoped, unchanged algorithm (getKVR14) -- one
    // bounded, indexed query, same cost class as the other three.
    getKVR14(studentId),
  ]);
  const kvr14: MetricResult<{ value: number | null; eligibleCount: number; validatedCount: number }> =
    kvr14Result.eligibleCount === 0
      ? metricUnavailable('INSUFFICIENT_EVIDENCE', 'No Validation Cycle has reached a terminal outcome yet.')
      : metricAvailable(kvr14Result);
  const velocitySummary =
    evidencedConceptIds.length === 0
      ? metricUnavailable('INSUFFICIENT_EVIDENCE', 'No evidenced concepts yet.')
      : metricAvailable(aggregateLearningVelocity(velocityByConcept));

  // Bounded, cross-subject summary only -- never per-concept detail here (no mega-object, Phase 1B §23).
  const subjects = await Promise.all(
    subjectRows.map(async (s) => {
      const [masteryRows, subjectEvidenceCoverage] = await Promise.all([
        R.readSubjectMasteryRows(studentId, s.id),
        R.getEvidenceCoverage(studentId, s.id),
      ]);
      const validScores = masteryRows.flatMap((r) => {
        const score = R.tryMasteryScore(Number(r.mastery_score), `learner-twin overview subject ${s.id} concept ${r.concept_id}`);
        return score !== null ? [score] : [];
      });
      return {
        subjectId: s.id,
        subjectName: s.name,
        academicContext: R.toSubjectAcademicContext(s),
        avgMasteryPercent: R.masteryToPercent(R.averageMasteryScore(validScores)),
        conceptCount: masteryRows.length,
        evidenceCoveragePercent: subjectEvidenceCoverage?.percent ?? null,
      };
    })
  );

  return {
    studentId,
    generatedAt: new Date().toISOString(),
    academicContext,
    languageContext,
    subjects,
    planningContext,
    derivedMetrics: { evidenceCoveragePercent: evidenceCoverage?.percent ?? null },
    calibration,
    velocitySummary,
    studyPlanAdherence,
    kvr14,
    dataQuality: dataQuality(),
  };
}

// ---------------------------------------------------------------------
// getSubjectView -- student + subject
// ---------------------------------------------------------------------

export async function getSubjectView(studentId: StudentId, subjectId: string, options: ProjectionOptions = {}): Promise<SubjectView | null> {
  const subjectRows = await R.readSubjects(studentId, [subjectId]);
  const subjectRow = subjectRows[0];
  if (!subjectRow) return null;

  const [masteryRows, knowledgeStates, recurringMisconceptions, subjectAggregate] = await Promise.all([
    R.readSubjectMasteryRows(studentId, subjectId),
    R.getSubjectKnowledgeState(studentId, subjectId),
    R.getRecurringMisconceptions(studentId),
    // Reuses the existing, certified, N+1-safe subject-aggregate algorithm
    // (learner-model.service.ts::getSubjectLearnerModel) rather than
    // reimplementing avgMastery/avgRetention/avgIndependentMastery/
    // avgConfidenceCalibration/evidenceCoverage -- see Phase 1C report §6.
    getSubjectLearnerModel(studentId, subjectId),
  ]);

  const subjectConceptIds = masteryRows.map((r) => r.concept_id);
  // Phase 1E: subject-scoped derived metrics -- batched, not per-concept.
  const [aggregateCalibration, aggregateVelocityByConcept, transferCoverage] = await Promise.all([
    readAggregateCalibration(studentId, subjectConceptIds),
    readLearningVelocityForConcepts(studentId, subjectConceptIds),
    readTransferCoverage(studentId, subjectId),
  ]);
  const aggregateVelocity =
    subjectConceptIds.length === 0
      ? metricUnavailable('INSUFFICIENT_EVIDENCE', 'No evidenced concepts in this subject yet.')
      : metricAvailable(aggregateLearningVelocity(aggregateVelocityByConcept));

  const ksByConcept = new Map(knowledgeStates.map((k) => [k.conceptId, k]));
  const misconceptionsByConcept = new Map<string, typeof recurringMisconceptions>();
  for (const m of recurringMisconceptions) {
    if (m.subjectId !== subjectId) continue;
    const list = misconceptionsByConcept.get(m.conceptId) ?? [];
    list.push(m);
    misconceptionsByConcept.set(m.conceptId, list);
  }

  const conceptIdFilter = options.conceptIds ? new Set(options.conceptIds) : null;
  const boundedRows = conceptIdFilter ? masteryRows.filter((r) => conceptIdFilter.has(r.concept_id)) : masteryRows;

  const concepts: ConceptSummary[] = boundedRows.map((row) => {
    const ks = ksByConcept.get(row.concept_id);
    return {
      conceptId: row.concept_id,
      label: row.label,
      mastery: {
        score: Number(row.mastery_score),
        confidenceScore: Number(row.confidence_score),
        attemptCount: Number(row.attempt_count),
        correctCount: Number(row.correct_count),
        incorrectCount: Number(row.incorrect_count),
        quality: { sourceType: 'SYSTEM_FACT', lastUpdatedAt: row.updated_at },
      },
      knowledgeState: {
        masteryState: ks?.masteryState ?? 'UNKNOWN',
        dimensions: {
          understanding: ks?.understandingScore ?? null,
          independence: ks?.independenceScore ?? null,
          application: ks?.applicationScore ?? null,
          retention: ks?.retentionScore ?? null,
          transfer: ks?.transferScore ?? null,
        },
      },
      needsAttention: (misconceptionsByConcept.get(row.concept_id) ?? []).map((m) => ({
        description: m.description,
        occurrenceCount: m.occurrenceCount,
      })),
    };
  });

  const needsAttention: NeedsAttentionItem[] = [...misconceptionsByConcept.entries()]
    .map(([conceptId, list]) => ({
      conceptId,
      conceptLabel: concepts.find((c) => c.conceptId === conceptId)?.label ?? conceptId,
      severity: Math.max(...list.map((m) => m.occurrenceCount)),
    }))
    .sort((a, b) => b.severity - a.severity);

  return {
    studentId,
    subjectId,
    subjectName: subjectRow.name,
    generatedAt: new Date().toISOString(),
    academicContext: R.toSubjectAcademicContext(subjectRow),
    cognitiveSummary: {
      avgMasteryPercent: subjectAggregate.avgMastery,
      avgRetentionScore: subjectAggregate.avgRetention,
      avgIndependentMastery: subjectAggregate.avgIndependentMastery,
      avgConfidenceCalibration: subjectAggregate.avgConfidenceCalibration,
      evidenceCoverage: subjectAggregate.evidenceCoverage,
      activeLearningDebtCount: subjectAggregate.activeLearningDebtCount,
      atRiskCount: subjectAggregate.atRiskCount,
    },
    concepts,
    needsAttention,
    aggregateCalibration,
    aggregateVelocity,
    transferCoverage,
    dataQuality: dataQuality(),
  };
}

// ---------------------------------------------------------------------
// getConceptView -- student + concept, the richest projection
// ---------------------------------------------------------------------

export async function getConceptView(studentId: StudentId, conceptId: string, options: ProjectionOptions = {}): Promise<ConceptView | null> {
  const conceptRow = await db.query(
    `SELECT c.subject_id, COALESCE(cl.label, c.canonical_id) AS label
     FROM concepts c LEFT JOIN concept_localizations cl ON cl.concept_id = c.id AND cl.language = 'en'
     WHERE c.id = $1`,
    [conceptId]
  );
  const concept = conceptRow.rows[0];
  if (!concept) return null;
  const subjectId: string = concept.subject_id;

  const masteryRow = await R.readMasteryRow(studentId, conceptId);
  if (!masteryRow) return null; // no evidence yet for this concept -- matches the pre-existing getLearnerConceptState contract exactly

  const [
    knowledgeStateSignal,
    independence,
    metacognition,
    transfer,
    misconceptions,
    interventionState,
    validationState,
    recentEvidence,
    errorPatterns,
    assessmentContext,
    responseTiming,
    prerequisiteGaps,
    helpDependency,
    learningVelocity,
    persistence,
  ] = await Promise.all([
    R.readKnowledgeStateSignal(studentId, conceptId),
    R.readIndependenceSignal(studentId, conceptId),
    R.readMetacognitionSignal(studentId, conceptId),
    R.readTransferSignal(studentId, conceptId),
    R.readMisconceptionSummary(studentId, conceptId),
    // Phase 2D/2E: eager, like misconceptions -- ConceptView is the "full detail" projection.
    R.readInterventionState(studentId, conceptId),
    R.readConceptValidationState(studentId, conceptId),
    R.readRecentEvidence(studentId, conceptId, DEFAULT_RECENT_EVIDENCE_LIMIT),
    R.readConceptErrorPatterns(studentId, subjectId, conceptId),
    R.readAssessmentPressure(studentId, subjectId),
    // Phase 1D: raw behavioral observation only -- see ResponseTimingSignal's doc comment.
    R.readResponseTimingSignal(studentId, conceptId),
    // Phase 1E: derived learner metrics -- see docs/architecture/digital-learning-twin.md.
    readPrerequisiteGaps(studentId, conceptId),
    readHelpDependency(studentId, conceptId),
    readLearningVelocity(studentId, conceptId),
    readPersistence(studentId, conceptId),
  ]);

  const retention = R.toRetentionSignal(masteryRow, knowledgeStateSignal?.dimensions.retention ?? null);

  const stateHistory = options.includeHistory
    ? await R.readStateHistory(studentId, conceptId, options.historyLimit ?? DEFAULT_HISTORY_LIMIT)
    : undefined;

  return {
    studentId,
    conceptId,
    subjectId,
    conceptLabel: concept.label,
    generatedAt: new Date().toISOString(),
    mastery: R.toMasterySignal(masteryRow),
    knowledgeState: knowledgeStateSignal ?? {
      masteryState: 'UNKNOWN',
      dimensions: { understanding: null, independence: null, application: null, retention: null, transfer: null },
      validationReadiness: 'INSUFFICIENT_EVIDENCE',
      stateReason: null,
      quality: { sourceType: 'DETERMINISTIC_DERIVATION', lastUpdatedAt: null },
    },
    independence,
    metacognition,
    retention,
    transfer,
    misconceptions,
    interventionState,
    validationState,
    recentEvidence,
    errorPatterns,
    assessmentContext,
    behavior: { responseTiming },
    ...(stateHistory ? { stateHistory } : {}),
    // Phase 1E: implemented -- see docs/architecture/digital-learning-twin.md's
    // "Derived Learner Metrics" section for each metric's availability semantics.
    prerequisiteGaps,
    helpDependency,
    learningVelocity,
    persistence,
    dataQuality: dataQuality(),
  };
}

// ---------------------------------------------------------------------
// getDecisionContext -- minimal, decision-optimized slice (Phase 1B §26)
// ---------------------------------------------------------------------

export async function getDecisionContext(studentId: StudentId, conceptId: string, options: ProjectionOptions = {}): Promise<DecisionContext | null> {
  const conceptRow = await db.query(`SELECT subject_id FROM concepts WHERE id = $1`, [conceptId]);
  const subjectId: string | undefined = conceptRow.rows[0]?.subject_id;
  if (!subjectId) return null;

  const masteryRow = await R.readMasteryRow(studentId, conceptId);
  if (!masteryRow) return null;

  // Phase 1E-R: only the metrics the caller actually asked for are
  // computed -- current live consumers pass no `derivedMetrics` option,
  // so this set is empty and none of the three reader functions below
  // are even invoked (not called-then-discarded). See resolveDerivedMetrics.
  const requestedMetrics = resolveDerivedMetrics(options.derivedMetrics);
  const learningVelocityPromise: Promise<MetricProjection<any>> = requestedMetrics.has('learningVelocity')
    ? readLearningVelocity(studentId, conceptId).then(metricRequested)
    : Promise.resolve(METRIC_NOT_REQUESTED);
  const helpDependencyPromise: Promise<MetricProjection<any>> = requestedMetrics.has('helpDependency')
    ? readHelpDependency(studentId, conceptId).then(metricRequested)
    : Promise.resolve(METRIC_NOT_REQUESTED);
  const prerequisiteGapsPromise: Promise<MetricProjection<any>> = requestedMetrics.has('prerequisiteGaps')
    ? readPrerequisiteGaps(studentId, conceptId).then(metricRequested)
    : Promise.resolve(METRIC_NOT_REQUESTED);
  // Phase 2D/2E: same lazy contract as the three Phase 1E metrics above
  // -- these summaries are always well-defined (a COUNT is never
  // "insufficient evidence"), so when requested they resolve straight
  // to `metricAvailable`, never `metricUnavailable`.
  const interventionStatePromise: Promise<MetricProjection<InterventionStateSummary>> = requestedMetrics.has('interventionState')
    ? R.readInterventionState(studentId, conceptId).then((v) => metricRequested(metricAvailable(v)))
    : Promise.resolve(METRIC_NOT_REQUESTED);
  const validationStatePromise: Promise<MetricProjection<ConceptValidationSummary>> = requestedMetrics.has('validationState')
    ? R.readConceptValidationState(studentId, conceptId).then((v) => metricRequested(metricAvailable(v)))
    : Promise.resolve(METRIC_NOT_REQUESTED);

  const [
    knowledgeStateSignal,
    independence,
    metacognition,
    misconceptions,
    recentEvidence,
    assessmentPressure,
    planningContext,
    learningVelocity,
    helpDependency,
    prerequisiteGaps,
    interventionState,
    validationState,
  ] = await Promise.all([
    R.readKnowledgeStateSignal(studentId, conceptId),
    R.readIndependenceSignal(studentId, conceptId),
    R.readMetacognitionSignal(studentId, conceptId),
    R.readMisconceptionSummary(studentId, conceptId),
    R.readRecentEvidence(studentId, conceptId, DEFAULT_RECENT_EVIDENCE_LIMIT),
    R.readAssessmentPressure(studentId, subjectId),
    R.readPlanningContext(studentId),
    // Phase 1E: computed for a FUTURE Decision Engine's use only --
    // Step 24 invariant: no current consumer reads these fields.
    // Phase 1E-R: conditional on options.derivedMetrics (see above).
    learningVelocityPromise,
    helpDependencyPromise,
    prerequisiteGapsPromise,
    interventionStatePromise,
    validationStatePromise,
  ]);

  const retention = R.toRetentionSignal(masteryRow, knowledgeStateSignal?.dimensions.retention ?? null);

  return {
    studentId,
    conceptId,
    subjectId,
    generatedAt: new Date().toISOString(),
    mastery: { score: masteryRow.masteryScore, confidence: masteryRow.confidenceScore },
    knowledgeState: {
      masteryState: knowledgeStateSignal?.masteryState ?? 'UNKNOWN',
      dimensions: knowledgeStateSignal?.dimensions ?? { understanding: null, independence: null, application: null, retention: null, transfer: null },
      validationReadiness: knowledgeStateSignal?.validationReadiness ?? 'INSUFFICIENT_EVIDENCE',
    },
    metacognition: { confidenceCalibration: metacognition.confidenceCalibration },
    independence: { independentMastery: independence.independentMastery, evidenceStrength: independence.evidenceStrength },
    retention: { retentionScore: retention.retentionScore, forgettingRisk: retention.forgettingRisk, nextReviewAt: retention.nextReviewAt },
    misconceptions: { activeCount: misconceptions.activeCount, criticalCount: misconceptions.criticalCount, recurringCount: misconceptions.recurringCount },
    recentEvidence,
    assessmentPressure,
    availability: { dailyMinutes: planningContext.maxDailyMinutes },
    // Phase 1E: implemented, exposed only as future Decision Engine
    // inputs. Phase 1E-R: each is `{requested: false}` by default (see
    // resolveDerivedMetrics above) -- never fabricated as unavailable
    // and never claiming NOT_AVAILABLE_YET (the computation exists).
    learningVelocity,
    helpDependency,
    prerequisiteGaps,
    interventionState,
    validationState,
    dataQuality: dataQuality(),
  };
}
