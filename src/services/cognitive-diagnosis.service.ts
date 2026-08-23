/**
 * Cognitive Diagnosis Engine (Phase 2): turns a visible weakness on a
 * target concept into a ranked set of root-cause hypotheses drawn from
 * the Knowledge Graph, then confirms or rejects them with a short,
 * targeted Diagnostic Check -- never by asking an LLM "what's the
 * cause?" and trusting the answer directly.
 *
 * Consumes Phase 1 signals as-is (Mastery, Retention, Independent
 * Mastery, Evidence Strength) via learner-model.service.ts. Never
 * recomputes them, never creates a parallel Learner Model.
 */

import { db } from '@/lib/db';
import { getLearnerConceptState, type EvidenceStrength } from './learner-model.service';
import {
  getPrerequisites,
  inferPrerequisitesForConcept,
  confidenceTier,
  type ConceptRelationship,
} from './concept-graph.service';
import type { ErrorType } from './error-intelligence.service';
import { track } from '@/lib/analytics';

export type DiagnosisState = 'SUSPECTED' | 'LIKELY' | 'DIAGNOSIS_REQUIRED' | 'CONFIRMED' | 'REJECTED';
export type DiagnosticCheckOutcome = 'CONFIRMED' | 'REJECTED' | 'INCONCLUSIVE';

// --- Pure, testable scoring pieces ---------------------------------

/** CONCEPTUAL/INCOMPLETE/PROCEDURAL errors are real candidates for prerequisite investigation; CARELESS/MISREADING rarely are. */
export function errorTypeRelevance(errorType: ErrorType | string): number {
  switch (errorType) {
    case 'CONCEPTUAL':
      return 1.0;
    case 'INCOMPLETE':
      return 0.8;
    case 'PROCEDURAL':
      return 0.7;
    case 'MISREADING':
      return 0.3;
    case 'CARELESS':
      return 0.2;
    default:
      return 0.5;
  }
}

/** HIGH=1.0, MEDIUM=0.6, LOW=0.3, no evidence at all=0.15 (deliberately low -- see classifyDiagnosisState). */
export function evidenceConfidenceFactor(evidenceStrength: EvidenceStrength | null): number {
  if (evidenceStrength === 'HIGH') return 1.0;
  if (evidenceStrength === 'MEDIUM') return 0.6;
  if (evidenceStrength === 'LOW') return 0.3;
  return 0.15;
}

/**
 * How weak the candidate prerequisite itself looks (0-1, higher =
 * weaker). Averages whichever of mastery/retention/independent mastery
 * are actually available. Null (not 0) when none are -- the caller
 * must route that case to DIAGNOSIS_REQUIRED, never treat it as "full
 * gap" or "no gap".
 */
export function learnerGapFactor(masteryScore: number | null, retention: number | null, independentMastery: number | null): number | null {
  const signals = [masteryScore, retention, independentMastery].filter((v): v is number => v !== null);
  if (signals.length === 0) return null;
  const avg = signals.reduce((a, b) => a + b, 0) / signals.length;
  return Math.max(0, Math.min(1, 1 - avg / 100));
}

/** More repeated target-concept errors of a relevant type make the whole investigation more worth doing. Floored at 0.2 so one occurrence doesn't zero the score outright. */
export function recurrenceFactor(recurrenceCount: number): number {
  return Math.max(0.2, Math.min(1, recurrenceCount / 3));
}

export interface RootCauseFactors {
  dependencyStrength: number;
  learnerGap: number;
  errorRelevance: number;
  recurrenceFactor: number;
  evidenceConfidence: number;
  academicRelevance: number;
}

/**
 * RootCauseScore = DependencyStrength x LearnerGap x ErrorRelevance x
 * RecurrenceFactor x EvidenceConfidence x AcademicRelevance, each
 * factor 0-1. Multiplicative on purpose: a candidate needs every
 * factor to be at least plausible, not just one strong signal -- a
 * perfect graph edge to a concept the student clearly already knows
 * well should score near zero, and it does (learnerGap collapses it).
 * AcademicRelevance is 1.0 in this version (candidates are always
 * drawn from the same subject, which already carries the student's
 * academic context) -- a documented simplification, not an oversight.
 */
export function computeRootCauseScore(factors: RootCauseFactors): number {
  return (
    factors.dependencyStrength *
    factors.learnerGap *
    factors.errorRelevance *
    factors.recurrenceFactor *
    factors.evidenceConfidence *
    factors.academicRelevance
  );
}

/**
 * SUSPECTED/LIKELY/DIAGNOSIS_REQUIRED are all *hypotheses* -- only a
 * Diagnostic Check can move a candidate to CONFIRMED or REJECTED (see
 * evaluateDiagnosticCheck). hasCandidateEvidence=false always wins:
 * "we don't know" must never be silently treated as "there's a gap".
 */
export function classifyDiagnosisState(score: number | null, hasCandidateEvidence: boolean): DiagnosisState | null {
  if (!hasCandidateEvidence) return 'DIAGNOSIS_REQUIRED';
  if (score === null) return null;
  if (score >= 0.5) return 'LIKELY';
  if (score >= 0.22) return 'SUSPECTED';
  return null;
}

/**
 * <=34% correct -> CONFIRMED (e.g. 1/3), >=90% -> REJECTED (e.g. 3/3),
 * otherwise INCONCLUSIVE (stays open -- neither confirmed nor
 * rejected; the caller can re-check later rather than forcing a
 * premature verdict on a middling result like 2/3).
 */
export function evaluateDiagnosticCheck(correctCount: number, totalCount: number): DiagnosticCheckOutcome {
  if (totalCount === 0) return 'INCONCLUSIVE';
  const ratio = correctCount / totalCount;
  if (ratio <= 0.34) return 'CONFIRMED';
  if (ratio >= 0.9) return 'REJECTED';
  return 'INCONCLUSIVE';
}

// --- Orchestration (DB + graph + learner-model) --------------------

export interface RootCauseHypothesis {
  diagnosisId: string;
  candidateConceptId: string;
  candidateLabel: string;
  state: DiagnosisState;
  score: number | null;
  relationship: ConceptRelationship;
}

/**
 * How many times this concept has produced a CONCEPTUAL/PROCEDURAL/
 * INCOMPLETE error in the last 30 days -- the "recurrence" input to
 * the score. CARELESS/MISREADING are excluded: they don't count as
 * cognitive-investigation-worthy recurrence per the error taxonomy.
 */
async function getRelevantErrorRecurrence(studentId: string, conceptId: string): Promise<{ count: number; dominantType: string | null }> {
  const result = await db.query(
    `SELECT error_type, COUNT(*)::int AS count FROM errors
     WHERE student_id = $1 AND concept_id = $2 AND created_at > NOW() - INTERVAL '30 days'
       AND error_type IN ('CONCEPTUAL', 'PROCEDURAL', 'INCOMPLETE')
     GROUP BY error_type ORDER BY count DESC`,
    [studentId, conceptId]
  );
  const total = result.rows.reduce((sum, r) => sum + Number(r.count), 0);
  return { count: total, dominantType: result.rows[0]?.error_type ?? null };
}

export interface CognitiveIssueSignal {
  justified: boolean;
  reasons: string[];
  dominantErrorType: string | null;
  recurrenceCount: number;
}

/**
 * Should this concept even be investigated cognitively? Not every
 * wrong answer deserves a root-cause hunt -- this gate keeps the
 * engine from over-diagnosing isolated mistakes.
 */
export async function detectCognitiveIssue(studentId: string, conceptId: string): Promise<CognitiveIssueSignal> {
  const [{ count, dominantType }, state] = await Promise.all([
    getRelevantErrorRecurrence(studentId, conceptId),
    getLearnerConceptState(studentId, conceptId),
  ]);

  const reasons: string[] = [];
  if (count >= 2) reasons.push('repeated_conceptual_error');
  if (state && state.masteryScore < 50) reasons.push('low_mastery');
  if (state && state.independentMastery !== null && state.independentMastery < state.masteryScore - 20) {
    reasons.push('independence_gap');
  }
  if (state && state.confidenceCalibration.label === 'OVERCONFIDENT') reasons.push('overconfident');

  const signal = { justified: reasons.length > 0, reasons, dominantErrorType: dominantType, recurrenceCount: count };
  if (signal.justified) {
    track(studentId, 'cognitive_issue_detected', { conceptId, reasons, recurrenceCount: count });
  }
  return signal;
}

/**
 * Ranked root-cause hypotheses for a target concept. Seeds the
 * Knowledge Graph on demand (AI inference) if this concept has no
 * prerequisite edges yet -- the graph doesn't need to be pre-built
 * over the whole curriculum, only where the diagnosis engine actually
 * needs it, which keeps AI cost proportional to real usage.
 */
export async function generateRootCauseHypotheses(
  studentId: string,
  subjectId: string,
  targetConceptId: string,
  language: string = 'en'
): Promise<RootCauseHypothesis[]> {
  const { count: recurrenceCount, dominantType: dominantErrorType } = await getRelevantErrorRecurrence(studentId, targetConceptId);

  let prerequisites = await getPrerequisites(targetConceptId);
  if (prerequisites.length === 0) {
    await inferPrerequisitesForConcept(subjectId, targetConceptId, language).catch((err) => {
      console.error('Prerequisite inference failed:', err);
    });
    prerequisites = await getPrerequisites(targetConceptId);
  }
  if (prerequisites.length === 0) return [];

  const labelsResult = await db.query(
    `SELECT c.id, COALESCE(cl.label, c.canonical_id) AS label
     FROM concepts c
     LEFT JOIN LATERAL (SELECT label FROM concept_localizations WHERE concept_id = c.id ORDER BY (language = $2) DESC LIMIT 1) cl ON true
     WHERE c.id = ANY($1)`,
    [prerequisites.map((p) => p.sourceConceptId), language]
  );
  const labels = new Map(labelsResult.rows.map((r) => [r.id, r.label]));

  const hypotheses: RootCauseHypothesis[] = [];
  for (const rel of prerequisites) {
    const candidateState = await getLearnerConceptState(studentId, rel.sourceConceptId);
    const hasCandidateEvidence = candidateState !== null;
    const gap = hasCandidateEvidence
      ? learnerGapFactor(candidateState!.masteryScore, candidateState!.retention, candidateState!.independentMastery)
      : null;

    let score: number | null = null;
    if (gap !== null) {
      score = computeRootCauseScore({
        dependencyStrength: rel.confidence,
        learnerGap: gap,
        errorRelevance: errorTypeRelevance(dominantErrorType ?? 'CONCEPTUAL'),
        recurrenceFactor: recurrenceFactor(recurrenceCount),
        evidenceConfidence: evidenceConfidenceFactor(candidateState!.evidenceStrength),
        academicRelevance: 1.0,
      });
    }

    const state = classifyDiagnosisState(score, hasCandidateEvidence);
    if (state === null) continue;

    const upserted = await db.query(
      `INSERT INTO cognitive_diagnoses (student_id, target_concept_id, candidate_concept_id, state, score, evidence)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [studentId, targetConceptId, rel.sourceConceptId, state, score ?? 0, JSON.stringify({ recurrenceCount, dominantErrorType, edgeConfidence: rel.confidence, edgeConfidenceTier: confidenceTier(rel.confidence) })]
    );
    // No unique constraint exists on (student, target, candidate) by
    // design -- a student can be re-diagnosed over time as evidence
    // changes -- so ON CONFLICT DO NOTHING never actually fires today;
    // it's a guard against a future constraint, not dead code removal.
    const diagnosisId = upserted.rows[0]?.id;
    if (!diagnosisId) continue;

    hypotheses.push({
      diagnosisId,
      candidateConceptId: rel.sourceConceptId,
      candidateLabel: labels.get(rel.sourceConceptId) || rel.sourceConceptId,
      state,
      score,
      relationship: rel,
    });
  }

  hypotheses.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return hypotheses;
}

export interface DiagnosisRecord {
  id: string;
  studentId: string;
  targetConceptId: string;
  candidateConceptId: string;
  state: DiagnosisState;
  score: number;
}

export async function getDiagnosis(diagnosisId: string): Promise<DiagnosisRecord | null> {
  const result = await db.query(
    `SELECT id, student_id, target_concept_id, candidate_concept_id, state, score FROM cognitive_diagnoses WHERE id = $1`,
    [diagnosisId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    studentId: row.student_id,
    targetConceptId: row.target_concept_id,
    candidateConceptId: row.candidate_concept_id,
    state: row.state,
    score: Number(row.score),
  };
}

/**
 * Applies a Diagnostic Check's result to a diagnosis: CONFIRMED,
 * REJECTED (the engine must be able to say "that wasn't it"), or left
 * unchanged on INCONCLUSIVE so a later re-check can still resolve it.
 */
export async function resolveDiagnosticCheck(
  diagnosisId: string,
  correctCount: number,
  totalCount: number
): Promise<{ diagnosis: DiagnosisRecord; outcome: DiagnosticCheckOutcome } | null> {
  const diagnosis = await getDiagnosis(diagnosisId);
  if (!diagnosis) return null;

  const outcome = evaluateDiagnosticCheck(correctCount, totalCount);
  if (outcome === 'INCONCLUSIVE') return { diagnosis, outcome };

  const newState: DiagnosisState = outcome === 'CONFIRMED' ? 'CONFIRMED' : 'REJECTED';
  await db.query(
    `UPDATE cognitive_diagnoses
     SET state = $2, evidence = evidence || $3::jsonb, updated_at = NOW(), resolved_at = NOW()
     WHERE id = $1`,
    [diagnosisId, newState, JSON.stringify({ diagnosticCheck: { correctCount, totalCount, outcome } })]
  );
  track(diagnosis.studentId, outcome === 'CONFIRMED' ? 'root_cause_confirmed' : 'root_cause_rejected', {
    diagnosisId,
    candidateConceptId: diagnosis.candidateConceptId,
    targetConceptId: diagnosis.targetConceptId,
    correctCount,
    totalCount,
  });

  return { diagnosis: { ...diagnosis, state: newState }, outcome };
}

/** Every currently-relevant (non-rejected, non-resolved-remediation) diagnosis for a student, most recent first -- feeds Improve v2's "Foundational gaps". */
export async function getActiveDiagnoses(studentId: string): Promise<
  Array<DiagnosisRecord & { targetLabel: string; candidateLabel: string; subjectId: string; subjectName: string }>
> {
  const result = await db.query(
    `SELECT cd.id, cd.student_id, cd.target_concept_id, cd.candidate_concept_id, cd.state, cd.score,
            COALESCE(tcl.label, tc.canonical_id) AS target_label,
            COALESCE(ccl.label, cc.canonical_id) AS candidate_label,
            cc.subject_id, s.name AS subject_name
     FROM cognitive_diagnoses cd
     JOIN concepts tc ON tc.id = cd.target_concept_id
     JOIN concepts cc ON cc.id = cd.candidate_concept_id
     JOIN subjects s ON s.id = cc.subject_id
     LEFT JOIN LATERAL (SELECT label FROM concept_localizations WHERE concept_id = tc.id LIMIT 1) tcl ON true
     LEFT JOIN LATERAL (SELECT label FROM concept_localizations WHERE concept_id = cc.id LIMIT 1) ccl ON true
     WHERE cd.student_id = $1 AND cd.state IN ('LIKELY', 'DIAGNOSIS_REQUIRED', 'CONFIRMED') AND s.status = 'active'
       AND NOT EXISTS (SELECT 1 FROM remediation_paths rp WHERE rp.diagnosis_id = cd.id AND rp.state = 'RESOLVED')
     ORDER BY cd.updated_at DESC`,
    [studentId]
  );
  return result.rows.map((row) => ({
    id: row.id,
    studentId: row.student_id,
    targetConceptId: row.target_concept_id,
    candidateConceptId: row.candidate_concept_id,
    state: row.state,
    score: Number(row.score),
    targetLabel: row.target_label,
    candidateLabel: row.candidate_label,
    subjectId: row.subject_id,
    subjectName: row.subject_name,
  }));
}
