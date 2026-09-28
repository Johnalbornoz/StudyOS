/**
 * LEARNING_ACTIVITY_DELIVERY -- the launch lock: ONE transaction-scoped
 * advisory lock per (learner, concept, quiz mode). Launches take it (double
 * click / refresh idempotency) and so does the background worker while it
 * assembles and stores a READY activity, so the worker never reads the bank
 * in the middle of a launch that is delivering from it.
 */
import { createHash } from 'crypto';
import { db } from '@/lib/db';

export const LAUNCH_LOCK_TIMEOUT = '90s';

export interface LaunchLock {
  release(): Promise<void>;
}

/**
 * Transaction-scoped advisory lock on a dedicated connection. A
 * transaction is pinned to ONE server connection even behind a
 * transaction-pooling proxy (Neon's PgBouncer), and the lock is released
 * by COMMIT/ROLLBACK -- a session-level pg_advisory_lock/unlock pair is
 * NOT safe there (the unlock can land on another server connection and
 * orphan the lock: found by the delivery benchmark).
 */
export async function acquireLaunchLock(key: string): Promise<LaunchLock> {
  const client = await db.connect();
  let released = false;
  try {
    // one round trip; the key is a 64-bit integer computed here, so the multi-statement text carries no user input
    await client.query(`BEGIN; SET LOCAL lock_timeout = '${LAUNCH_LOCK_TIMEOUT}'; SELECT pg_advisory_xact_lock(${launchLockId(key)});`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    throw error;
  }
  return {
    async release() {
      if (released) return;
      released = true;
      try {
        await client.query('COMMIT');
      } catch {
        await client.query('ROLLBACK').catch(() => {});
      } finally {
        client.release();
      }
    },
  };
}

/** Stable signed 64-bit lock id for a launch key (first 8 bytes of its sha256). */
export function launchLockId(key: string): string {
  return createHash('sha256').update(key).digest().readBigInt64BE(0).toString();
}

export function launchLockKey(input: { studentId: string; conceptId: string; quizMode: string }): string {
  return `activity-launch:${input.studentId}:${input.conceptId}:${input.quizMode}`;
}

/** Runs `fn` while holding the launch lock for this (learner, concept, quiz mode). */
export async function withLaunchLock<T>(input: { studentId: string; conceptId: string; quizMode: string }, fn: () => Promise<T>): Promise<T> {
  const lock = await acquireLaunchLock(launchLockKey(input));
  try {
    return await fn();
  } finally {
    await lock.release();
  }
}
