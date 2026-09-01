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
} from './types';
import { notYetAvailable } from './types';

const DEFAULT_HISTORY_LIMIT = 20;
const DEFAULT_RECENT_EVIDENCE_LIMIT = 5;

function dataQuality(sourcesUsed: DataQualitySummary['sourcesUsed'] = ['SYSTEM_FACT', 'DETERMINISTIC_DERIVATION']): DataQualitySummary {
  return { generatedAt: new Date().toISOString(), sourcesUsed };
}

// ---------------------------------------------------------------------
// getOverview -- student-level, cross-subject, bounded (Phase 1B §9's design)
// ---------------------------------------------------------------------

export async function getOverview(studentId: StudentId, options: ProjectionOptions = {}): Promise<LearnerModel> {
  const [academicContext, languageContext, subjectRows, planningContext, evidenceCoverage] = await Promise.all([
    R.readAcademicContext(studentId),
    R.readLanguageContext(studentId),
    R.readSubjects(studentId, options.subjectIds),
    R.readPlanningContext(studentId),
    R.getEvidenceCoverage(studentId),
  ]);

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

  const [knowledgeStateSignal, independence, metacognition, transfer, misconceptions, recentEvidence, errorPatterns, assessmentContext, responseTiming] =
    await Promise.all([
      R.readKnowledgeStateSignal(studentId, conceptId),
      R.readIndependenceSignal(studentId, conceptId),
      R.readMetacognitionSignal(studentId, conceptId),
      R.readTransferSignal(studentId, conceptId),
      R.readMisconceptionSummary(studentId, conceptId),
      R.readRecentEvidence(studentId, conceptId, DEFAULT_RECENT_EVIDENCE_LIMIT),
      R.readConceptErrorPatterns(studentId, subjectId, conceptId),
      R.readAssessmentPressure(studentId, subjectId),
      // Phase 1D: raw behavioral observation only -- see ResponseTimingSignal's doc comment.
      R.readResponseTimingSignal(studentId, conceptId),
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
    recentEvidence,
    errorPatterns,
    assessmentContext,
    behavior: { responseTiming },
    ...(stateHistory ? { stateHistory } : {}),
    // Deferred to Phase 1E -- Phase 1B §21 defines the derivation (concept_relationships
    // + learner Knowledge State) but explicitly withheld production blockingSeverity
    // thresholds. Never fabricated here.
    prerequisiteGaps: notYetAvailable('1E'),
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

  const [knowledgeStateSignal, independence, metacognition, misconceptions, recentEvidence, assessmentPressure, planningContext] =
    await Promise.all([
      R.readKnowledgeStateSignal(studentId, conceptId),
      R.readIndependenceSignal(studentId, conceptId),
      R.readMetacognitionSignal(studentId, conceptId),
      R.readMisconceptionSummary(studentId, conceptId),
      R.readRecentEvidence(studentId, conceptId, DEFAULT_RECENT_EVIDENCE_LIMIT),
      R.readAssessmentPressure(studentId, subjectId),
      R.readPlanningContext(studentId),
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
    // Deferred to Phase 1D/1E -- never fabricated as 0/null-that-looks-real (Phase 1C Step 3/13).
    learningVelocity: notYetAvailable('1E'),
    helpDependency: notYetAvailable('1E'),
    prerequisiteGaps: notYetAvailable('1E'),
    dataQuality: dataQuality(),
  };
}
