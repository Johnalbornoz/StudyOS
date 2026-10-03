/**
 * Exam V2 -- shared authorization for the /api/exams routes.
 *
 * Execution (create / start / delete an instance, build a submission, read
 * one's own media) is OWNER-ONLY: a Teacher or Parent relationship never
 * authorizes acting inside a Student's exam (same rule as the attempt runner).
 */
import { verifyAuth, checkRateLimit } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { isOwner } from '@/lib/authorization';
import { canUseCapability } from '@/lib/entitlements';
import { db } from '@/lib/db';

export type Gate = { ok: true; actorUserId: string } | { ok: false; status: number; error: string };

export async function requireActor(rateKey?: string, limit = 60): Promise<Gate> {
  const authContext = await verifyAuth();
  if (!authContext) return { ok: false, status: 401, error: 'UNAUTHORIZED' };
  if (rateKey && !checkRateLimit(authContext.userId, rateKey, limit, 60)) return { ok: false, status: 429, error: 'RATE_LIMITED' };
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);
  return { ok: true, actorUserId: actor.id };
}

/** The actor must BE the Student (owner); with `entitled`, also hold LEARNING_FULL_ACCESS. */
export async function requireOwnerOf(actorUserId: string, studentId: string, opts: { entitled?: boolean } = {}): Promise<Gate> {
  if (!(await isOwner(actorUserId, studentId))) return { ok: false, status: 403, error: 'FORBIDDEN' };
  if (opts.entitled && !(await canUseCapability(actorUserId, studentId, 'LEARNING_FULL_ACCESS'))) return { ok: false, status: 403, error: 'ENTITLEMENT_REQUIRED' };
  return { ok: true, actorUserId };
}

/** The Student id the actor owns (the learner account behind this user), or null. */
export async function ownStudentId(actorUserId: string): Promise<string | null> {
  const r = await db.query(`SELECT id FROM students WHERE user_id = $1 ORDER BY created_at LIMIT 1`, [actorUserId]);
  return r.rows[0]?.id ?? null;
}
