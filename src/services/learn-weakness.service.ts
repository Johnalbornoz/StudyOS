/**
 * LEARN -> PRACTICE (approved requirement §22) -- the ONE accessor of a concept's LEARN weaknesses, shared by every
 * PRACTICE supply path (live generation, validated bank, READY prepared sets), and the ONE writer of the session's
 * `learnWeaknessProvenance`. DB reads only: no model, no generation (safe on the 0-AI launch hot path).
 *
 * Provenance lives in the existing `quiz_sessions.canonical_activity_contract` jsonb (every canonical Practice
 * session has one) under the additive key `learnWeaknessProvenance`; no migration. Readers of that column read
 * named keys only (findResumableCanonicalSession, getQuizSession), so the extra key changes nothing for them.
 */
import { db, type DbExecutor } from '@/lib/db';
import { LEARN_GUIDED_SOURCE_TYPE } from '@/lib/learn-guided/policy';
import { focusFromEvidenceRows, LEARN_FOCUS_MAX_SESSIONS, type LearnWeaknessFocus, type LearnWeaknessProvenance } from '@/lib/learn-guided/weakness-focus';

/**
 * Weaknesses + misconception ids of the latest guided LEARN session(s) of (student, concept), with the evidence
 * id(s) they came from. `null` when there is no LEARN session or it detected nothing. Never throws.
 */
export async function getLearnWeaknessesForConcept(
  studentId: string,
  conceptId: string,
  opts: { client?: DbExecutor; maxSessions?: number } = {},
): Promise<LearnWeaknessFocus | null> {
  const limit = Math.max(1, Math.min(LEARN_FOCUS_MAX_SESSIONS, opts.maxSessions ?? LEARN_FOCUS_MAX_SESSIONS));
  try {
    const r = await (opts.client ?? db).query(
      `SELECT id, metadata FROM learning_evidence WHERE student_id = $1 AND concept_id = $2 AND source_type = $3 AND metadata->>'activityType' = 'LEARN_CHECK'
        ORDER BY timestamp DESC, id DESC LIMIT ${limit}`,
      [studentId, conceptId, LEARN_GUIDED_SOURCE_TYPE],
    );
    return focusFromEvidenceRows((r?.rows ?? []) as Array<{ id?: unknown; metadata: unknown }>);
  } catch {
    return null;
  }
}

/** Stamps the provenance onto a canonical session. Best-effort: auditing never breaks a launch. */
export async function recordLearnWeaknessProvenance(quizId: string, provenance: LearnWeaknessProvenance, client: DbExecutor = db): Promise<void> {
  try {
    await client.query(
      `UPDATE quiz_sessions SET canonical_activity_contract = canonical_activity_contract || jsonb_build_object('learnWeaknessProvenance', $2::jsonb)
        WHERE id = $1 AND canonical_activity_contract IS NOT NULL`,
      [quizId, JSON.stringify(provenance)],
    );
  } catch (err) {
    console.error('[learn-weakness] provenance write failed', err);
  }
}
