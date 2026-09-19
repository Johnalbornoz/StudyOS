/**
 * F9 -- CAN_PROJECT_OFFICIAL_SCORE gate (task §29, INV-F9-16/17/20).
 * score_conversion_models is real and versioned but seeded with ZERO
 * rows in this environment -- a missing calibration model is a valid,
 * controlled state, never an implementation error to fake around. See
 * F9_SCORE_PROJECTION_POLICY.md.
 */
import { db } from '@/lib/db';
import type { ScoreProjectionAvailability } from './types';

export async function getScoreProjectionAvailability(examVersionId: string, qualifyingEvidenceCount: number): Promise<ScoreProjectionAvailability> {
  const result = await db.query(`SELECT minimum_evidence_count FROM score_conversion_models WHERE exam_version_id = $1 AND status = 'ACTIVE'`, [examVersionId]);
  if (result.rows.length === 0) return 'NOT_AVAILABLE_NO_CALIBRATION';
  const minimumEvidenceCount = result.rows[0].minimum_evidence_count;
  if (qualifyingEvidenceCount < minimumEvidenceCount) return 'NOT_AVAILABLE_INSUFFICIENT_DATA';
  return 'AVAILABLE';
}

export async function createScoreConversionModel(params: {
  examVersionId: string;
  conversionTable: Record<string, unknown>;
  minimumEvidenceCount: number;
}): Promise<{ id: string }> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE score_conversion_models SET status = 'RETIRED' WHERE exam_version_id = $1 AND status = 'ACTIVE'`, [params.examVersionId]);
    const inserted = await client.query(
      `INSERT INTO score_conversion_models (exam_version_id, status, conversion_table, minimum_evidence_count) VALUES ($1, 'ACTIVE', $2, $3) RETURNING id`,
      [params.examVersionId, JSON.stringify(params.conversionTable), params.minimumEvidenceCount]
    );
    await client.query('COMMIT');
    return { id: inserted.rows[0].id };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
