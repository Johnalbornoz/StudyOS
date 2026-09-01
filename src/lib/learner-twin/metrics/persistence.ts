/**
 * Phase 1E, Step 17: Persistence / Recovery Summary (student + concept).
 *
 * Conservative, observable-only. Does NOT implement PRODUCTIVE_STRUGGLE,
 * GUESSING, or FLUENCY -- those require item-level context this module
 * doesn't have and are explicitly out of scope. Walks chronological
 * `learning_evidence` and reports only directly observable facts: does
 * an incorrect run get followed by more attempts, and does it get
 * followed by a correct one. No personality or motivation label is
 * ever produced.
 *
 * A "failure episode" is one maximal run of consecutive `incorrect`
 * evidence rows -- this groups a burst of consecutive misses as one
 * episode rather than counting each miss separately, while
 * `currentConsecutiveFailureStreak` still exposes the raw trailing
 * incorrect-run length directly.
 *
 * Step 18 (deliberate, not an oversight): response-time telemetry is
 * NOT used here. Production has little historical timing data yet, and
 * folding it in now would risk exactly the premature
 * response-time-based interpretation Phase 1D-R/Step 18-20 warn
 * against. A future phase may enrich this once sufficient VALID
 * samples exist -- see the Phase 1E report §11.
 */
import { db } from '@/lib/db';
import { type PersistenceSummary, type MetricResult, PERSISTENCE_MODEL_VERSION, metricAvailable, metricUnavailable, quality } from './types';

interface EvidenceRow {
  result: string;
  timestamp: string;
}

export function computePersistence(rows: EvidenceRow[]): PersistenceSummary {
  let failureEpisodeCount = 0;
  let returnAfterFailureCount = 0;
  let recoveryAfterFailureCount = 0;
  let unresolvedFailureCount = 0;

  let i = 0;
  while (i < rows.length) {
    if (rows[i].result !== 'incorrect') {
      i++;
      continue;
    }
    // Walk the full consecutive-incorrect run.
    while (i < rows.length && rows[i].result === 'incorrect') i++;
    failureEpisodeCount++;

    const after = rows.slice(i);
    const returned = after.length > 0;
    const recovered = after.some((r) => r.result === 'correct');
    if (returned) returnAfterFailureCount++;
    if (recovered) recoveryAfterFailureCount++;
    else unresolvedFailureCount++;
  }

  let currentConsecutiveFailureStreak = 0;
  for (let j = rows.length - 1; j >= 0 && rows[j].result === 'incorrect'; j--) currentConsecutiveFailureStreak++;

  const lastUpdatedAt = rows.length > 0 ? rows[rows.length - 1].timestamp : null;

  return {
    failureEpisodeCount,
    returnAfterFailureCount,
    recoveryAfterFailureCount,
    unresolvedFailureCount,
    currentConsecutiveFailureStreak,
    quality: quality(rows.length, lastUpdatedAt, PERSISTENCE_MODEL_VERSION),
  };
}

export async function readPersistence(studentId: string, conceptId: string): Promise<MetricResult<PersistenceSummary>> {
  const result = await db.query<EvidenceRow>(
    `SELECT result, timestamp FROM learning_evidence WHERE student_id = $1 AND concept_id = $2 ORDER BY timestamp ASC`,
    [studentId, conceptId]
  );
  if (result.rows.length === 0) {
    return metricUnavailable('INSUFFICIENT_EVIDENCE', 'No learning_evidence rows exist for this concept.');
  }
  return metricAvailable(computePersistence(result.rows));
}
