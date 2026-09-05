/**
 * Phase 3 Pre-flight: Historical Knowledge State backfill/reprojection.
 *
 * Concept Knowledge State (Phase 2.2A) is a deterministic projection
 * from learning_evidence -- it was wired into updateMastery so it's
 * kept current going forward, but any evidence written before that
 * hook existed (or any row that recalculation failed for, per its own
 * caught/logged error) leaves a student x concept pair with no state,
 * or a stale one. This service finds those pairs and reprojects them
 * using the exact same production projector (recalculateConceptKnowledgeState)
 * -- never a second, parallel formula.
 *
 * Never fabricates evidence: reprojection only ever reads
 * learning_evidence that already exists. A concept with no Retention
 * evidence yet keeps retentionScore = null after backfill, exactly as
 * it would have from the projector's normal live path.
 *
 * Batchable / resumable: one call processes at most `batchSize`
 * candidate pairs, ordered by (student_id, concept_id), and returns a
 * cursor. Passing that cursor back in (via `resumeRunId`, which
 * persists it in backfill_runs) continues from where the previous call
 * left off -- safe to re-run to completion even across several
 * invocations, and safe to run twice on the same data since the
 * underlying projector is idempotent.
 *
 * Auditable: every invocation is recorded in backfill_runs with
 * aggregate counts only -- student/concept ids, never evidence
 * content, answer text, or anything else private.
 */

import { db } from '@/lib/db';
import {
  recalculateConceptKnowledgeState,
  getActiveMasteryPolicy,
  classifyUnderstanding,
  classifyIndependence,
  classifyApplication,
  determineMasteryState,
  evaluateEvidenceSufficiency,
  type EvidenceRow,
  type MasteryState,
} from './knowledge-state.service';
import { getTransferScore } from './transfer.service';
import { getMisconceptionCountsForConcept } from './misconception.service';
import { replayMemoryProjectionFromEvidence } from './memory-projector.service';

export interface BackfillMetrics {
  studentsScanned: number;
  conceptsWithEvidence: number;
  statesReconstructed: number;
  unknownRetained: number;
  retentionUnavailable: number;
  errors: number;
  durationMs: number;
}

export interface BackfillOptions {
  studentId?: string;
  dryRun?: boolean;
  batchSize?: number;
  runId?: string; // resume an existing run's cursor; omit to start a new run
}

export interface BackfillResult {
  runId: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  dryRun: boolean;
  metrics: BackfillMetrics;
  done: boolean; // true once every candidate pair (as of when the run started) has been processed
}

interface CandidatePair {
  studentId: string;
  conceptId: string;
}

const DEFAULT_BATCH_SIZE = 500;

async function findCandidates(
  studentFilter: string | null,
  cursor: { studentId: string; conceptId: string } | null,
  limit: number
): Promise<CandidatePair[]> {
  const result = await db.query(
    `
    SELECT le.student_id, le.concept_id
    FROM learning_evidence le
    LEFT JOIN concept_knowledge_state cks
      ON cks.student_id = le.student_id AND cks.concept_id = le.concept_id
    WHERE ($1::uuid IS NULL OR le.student_id = $1::uuid)
      AND ($3::uuid IS NULL OR (le.student_id, le.concept_id) > ($3::uuid, $4::uuid))
    GROUP BY le.student_id, le.concept_id, cks.updated_at
    HAVING cks.updated_at IS NULL OR cks.updated_at < MAX(le.timestamp)
    ORDER BY le.student_id, le.concept_id
    LIMIT $2
    `,
    [studentFilter, limit, cursor?.studentId ?? null, cursor?.conceptId ?? null]
  );
  return result.rows.map((r) => ({ studentId: r.student_id, conceptId: r.concept_id }));
}

/**
 * Read-only preview of what reprojection would produce for one pair,
 * WITHOUT persisting and WITHOUT calling evaluateValidationLifecycle
 * (Phase 2.2B's time-based overlay, which has real side effects --
 * opening/closing Validation Cycles -- that must never fire from a
 * dry run). Reuses the same exported, pure classification functions
 * the live projector uses, so the preview is a true preview of the
 * base (pre-2.2B-overlay) Mastery State, not a separate estimate.
 *
 * Step 6J-B2: the Retention dimension is now sourced the same way the
 * live path (recalculateConceptKnowledgeState) sources it -- Phase 6's
 * canonical demonstratedRetentionScore -- instead of the legacy
 * classifyRetention() formula. It is reconstructed via a pure replay
 * of learning_evidence (replayMemoryProjectionFromEvidence), NEVER by
 * reading concept_memory_state: a dry-run preview must produce a
 * correct answer even for a pair that has never been through Phase 6
 * live projection or backfill yet, so it cannot assume that table is
 * populated.
 */
async function previewOne(studentId: string, conceptId: string): Promise<{ masteryState: Exclude<MasteryState, 'AT_RISK' | 'INTERVENTION_REQUIRED'>; retentionAvailable: boolean } | null> {
  const conceptRow = await db.query(`SELECT subject_id FROM concepts WHERE id = $1`, [conceptId]);
  if (!conceptRow.rows[0]) return null;

  const evidenceRows = await db.query(
    `SELECT source_type, result, score_percent, ai_assistance_type, timestamp
     FROM learning_evidence WHERE student_id = $1 AND concept_id = $2 ORDER BY timestamp DESC`,
    [studentId, conceptId]
  );
  const rows: EvidenceRow[] = evidenceRows.rows.map((r) => ({
    sourceType: r.source_type,
    result: r.result,
    scorePercent: r.score_percent !== null ? Number(r.score_percent) : null,
    aiAssistanceType: r.ai_assistance_type,
    timestamp: r.timestamp,
  }));

  const policy = await getActiveMasteryPolicy();
  const [transferScore, misconceptionCounts, memoryProjection] = await Promise.all([
    getTransferScore(studentId, conceptId),
    getMisconceptionCountsForConcept(studentId, conceptId),
    replayMemoryProjectionFromEvidence(db, studentId, conceptId),
  ]);
  const unassistedRows = rows.filter((r) => r.aiAssistanceType === 'NONE');
  const scores = {
    understanding: classifyUnderstanding(rows),
    independence: classifyIndependence(unassistedRows),
    application: classifyApplication(rows),
    retention: memoryProjection.detail.state.demonstratedRetentionScore,
    transfer: transferScore,
  };
  const sufficiency = evaluateEvidenceSufficiency(rows, policy);
  const masteryState = determineMasteryState(scores, misconceptionCounts, sufficiency, policy);
  return { masteryState, retentionAvailable: scores.retention !== null };
}

async function createRun(studentFilter: string | null, dryRun: boolean): Promise<string> {
  const result = await db.query(
    `INSERT INTO backfill_runs (kind, status, dry_run, student_filter, metrics)
     VALUES ('KNOWLEDGE_STATE', 'RUNNING', $1, $2, $3) RETURNING id`,
    [dryRun, studentFilter, JSON.stringify(emptyMetrics())]
  );
  return result.rows[0].id;
}

function emptyMetrics(): BackfillMetrics {
  return {
    studentsScanned: 0,
    conceptsWithEvidence: 0,
    statesReconstructed: 0,
    unknownRetained: 0,
    retentionUnavailable: 0,
    errors: 0,
    durationMs: 0,
  };
}

/**
 * Processes up to `batchSize` candidate (student, concept) pairs and
 * returns the accumulated run state. Call repeatedly (passing back
 * `runId` from the previous call's result) until `done` is true.
 */
export async function runKnowledgeStateBackfill(options: BackfillOptions = {}): Promise<BackfillResult> {
  const startedAt = Date.now();
  const dryRun = options.dryRun ?? false;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const studentFilter = options.studentId ?? null;

  let runId = options.runId ?? null;
  let cursor: { studentId: string; conceptId: string } | null = null;
  let metrics = emptyMetrics();

  if (runId) {
    const existing = await db.query(`SELECT metrics, cursor_student_id, cursor_concept_id, status FROM backfill_runs WHERE id = $1`, [runId]);
    const row = existing.rows[0];
    if (!row) throw new Error('BACKFILL_RUN_NOT_FOUND');
    metrics = { ...emptyMetrics(), ...row.metrics };
    cursor = row.cursor_student_id ? { studentId: row.cursor_student_id, conceptId: row.cursor_concept_id } : null;
  } else {
    runId = await createRun(studentFilter, dryRun);
  }

  let candidates: CandidatePair[] = [];
  try {
    candidates = await findCandidates(studentFilter, cursor, batchSize);
  } catch (error) {
    await db.query(`UPDATE backfill_runs SET status = 'FAILED', error = $2, completed_at = NOW() WHERE id = $1`, [runId, String(error)]);
    throw error;
  }

  const scannedStudents = new Set<string>();
  let lastPair: CandidatePair | null = null;

  for (const pair of candidates) {
    scannedStudents.add(pair.studentId);
    metrics.conceptsWithEvidence++;
    lastPair = pair;

    try {
      if (dryRun) {
        const preview = await previewOne(pair.studentId, pair.conceptId);
        if (preview) {
          metrics.statesReconstructed++;
          if (preview.masteryState === 'UNKNOWN') metrics.unknownRetained++;
          if (!preview.retentionAvailable) metrics.retentionUnavailable++;
        }
      } else {
        const state = await recalculateConceptKnowledgeState(pair.studentId, pair.conceptId);
        if (state) {
          metrics.statesReconstructed++;
          if (state.masteryState === 'UNKNOWN') metrics.unknownRetained++;
          if (state.retentionScore === null) metrics.retentionUnavailable++;
        }
      }
    } catch (error) {
      metrics.errors++;
      // Never logs evidence content -- only which pair failed.
      console.error(`Knowledge State backfill failed for student=${pair.studentId} concept=${pair.conceptId}:`, error);
    }
  }

  metrics.studentsScanned += scannedStudents.size;
  metrics.durationMs += Date.now() - startedAt;
  const done = candidates.length < batchSize;

  await db.query(
    `UPDATE backfill_runs SET
       metrics = $2,
       cursor_student_id = $3,
       cursor_concept_id = $4,
       status = $5,
       completed_at = $6
     WHERE id = $1`,
    [
      runId,
      JSON.stringify(metrics),
      lastPair?.studentId ?? null,
      lastPair?.conceptId ?? null,
      done ? 'COMPLETED' : 'RUNNING',
      done ? new Date() : null,
    ]
  );

  return {
    runId,
    status: done ? 'COMPLETED' : 'RUNNING',
    dryRun,
    metrics,
    done,
  };
}

export async function getBackfillRun(runId: string) {
  const result = await db.query(`SELECT * FROM backfill_runs WHERE id = $1`, [runId]);
  return result.rows[0] ?? null;
}
