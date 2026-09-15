/**
 * CANON-R5 Parts 1/5/6/7/8 -- THE ONE CANONICAL DECISION SERVICE.
 *
 * `getCanonicalPedagogicalDecision` is the single server-side
 * orchestration point that:
 *   1. loads real learning evidence for (studentId, conceptId) --
 *      `fetchStudyUSEvidenceRows` (CANON-R3, relocated this phase) +
 *      `mapStudyUSEvidenceToPedagogicalEvidence` (CANON-R3's own, sole
 *      evidence adapter -- never re-implemented here, Part 7);
 *   2. loads persisted requirement recognitions -- `loadRecognizedRequirementsForEngine`
 *      (CANON-R4R1's own, sole read adapter for
 *      `pedagogical_requirement_recognition`). Migration is NOT
 *      recomputed dynamically from old state on every request (Part 6)
 *      -- only the already-applied, persisted baseline is read;
 *   3. loads the CURRENT active-critical-misconception fact --
 *      `getMisconceptionCountsForConcept` (the existing, authoritative
 *      misconception service; never inferred from evidence scores);
 *   4. calls `evaluateCanonicalLearningState` -- the frozen Pedagogical
 *      Engine v1 (CANON-R2/R2R1/R4R1) -- exactly once.
 *
 * No DB IO lives inside the pure engine (Part 5): every read above is a
 * plain SELECT performed here, in this orchestration layer, before the
 * single, pure `evaluateCanonicalLearningState` call.
 *
 * FAIL-SAFE (Part 28): a read failure here is NEVER swallowed into a
 * default/empty decision -- it is re-thrown as
 * `CanonicalDecisionUnavailableError` so a caller can recognize it
 * specifically and return a controlled canonical-state error instead of
 * silently falling back to the old pedagogical authority.
 */
import { db, type DbExecutor } from '@/lib/db';
import {
  evaluateCanonicalLearningState,
  type CanonicalPedagogicalDecision,
  type RecognizedRequirement,
} from '@/lib/pedagogical-engine';
import { mapStudyUSEvidenceToPedagogicalEvidence, fetchStudyUSEvidenceRows, type AdapterConfidence, type AdapterUnresolvedMapping } from '@/lib/pedagogical-shadow';
import { loadRecognizedRequirementsForEngine, INITIAL_MIGRATION_VERSION } from '@/lib/pedagogical-migration';
import { getMisconceptionCountsForConcept } from '@/services/misconception.service';

export class CanonicalDecisionUnavailableError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'CanonicalDecisionUnavailableError';
  }
}

export interface CanonicalDecisionAdapterDiagnostics {
  unresolved: AdapterUnresolvedMapping[];
  warnings: string[];
  confidence: AdapterConfidence;
  rowsConsidered: number;
}

export interface CanonicalDecisionResult {
  decision: CanonicalPedagogicalDecision;
  /** Never authoritative, never consulted by any learner-facing branch -- observability only (mirrors CANON-R3's own adapter-confidence discipline: a LOW-confidence mapping is a statement about input completeness, not a defect). */
  adapterDiagnostics: CanonicalDecisionAdapterDiagnostics;
}

export interface GetCanonicalPedagogicalDecisionParams {
  studentId: string;
  conceptId: string;
  /** Injected, never read from the system clock by the pure engine -- defaults to `new Date().toISOString()` here, at the one IO boundary allowed to touch the clock. */
  now?: string;
  /** Transaction-aware override (Phase 2B pattern) -- defaults to the shared pool. */
  client?: DbExecutor;
}

/**
 * THE ONE canonical decision entry point every learner-facing surface
 * and every session-start call must use once this phase's feature gate
 * is enabled (Part 2's ONE AUTHORITY RULE). Never wraps or re-derives
 * the engine's own output -- `decision` is `evaluateCanonicalLearningState`'s
 * return value, verbatim.
 */
export async function getCanonicalPedagogicalDecision(
  params: GetCanonicalPedagogicalDecisionParams,
): Promise<CanonicalDecisionResult> {
  const { studentId, conceptId } = params;
  const now = params.now ?? new Date().toISOString();
  const client = params.client ?? db;

  let evidenceRows;
  let recognizedRequirements: RecognizedRequirement[];
  let activeCriticalMisconception: boolean;
  try {
    [evidenceRows, recognizedRequirements, activeCriticalMisconception] = await Promise.all([
      fetchStudyUSEvidenceRows(studentId, conceptId, client),
      loadRecognizedRequirementsForEngine(studentId, conceptId, INITIAL_MIGRATION_VERSION, client),
      getMisconceptionCountsForConcept(studentId, conceptId, client).then((counts) => counts.criticalCount > 0),
    ]);
  } catch (error) {
    throw new CanonicalDecisionUnavailableError(
      `Canonical decision inputs could not be read for student ${studentId}, concept ${conceptId}.`,
      error,
    );
  }

  const adapterResult = mapStudyUSEvidenceToPedagogicalEvidence(evidenceRows);

  const decision = evaluateCanonicalLearningState({
    conceptId,
    studentId,
    now,
    evidence: adapterResult.items,
    activeCriticalMisconception,
    recognizedRequirements: recognizedRequirements.length > 0 ? recognizedRequirements : undefined,
  });

  return {
    decision,
    adapterDiagnostics: {
      unresolved: adapterResult.unresolved,
      warnings: adapterResult.warnings,
      confidence: adapterResult.confidence,
      rowsConsidered: adapterResult.rowsConsidered,
    },
  };
}
