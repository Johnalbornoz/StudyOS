/**
 * THE canonical learning-entitlement resolution.
 *
 * One answer to "is this learner licensed right now?", reused by every
 * surface: `canUseCapability(..., 'LEARNING_FULL_ACCESS')` (global demo
 * banner, Learning Engine / session start / quiz generation, tutor, exam
 * readiness, simulations, study plan, hints...) AND the Billing page. No
 * surface may derive "licensed" from the raw subscription row on its own.
 *
 * Inputs: the EFFECTIVE subscription (`getEffectiveSubscription` -- an admin
 * grant past its own expiry is already `expired`) and ownership through the
 * F1 canonical link (`students.user_id`). An administrative grant and a paid
 * plan are the same entitlement here (source differs, access does not).
 *
 * Note: the data model has no start date -- an administrative grant takes
 * effect when it is created and ends at `grant_expires_at`; a paid plan is
 * bounded by its status (and, for cancel-at-period-end, `current_period_end`).
 */
import { db } from '@/lib/db';
import { getEffectiveSubscription } from './subscription.service';
import type { SubscriptionRecord, SubscriptionStatus } from './types';

export const PAID_ACCESS_STATUSES: readonly SubscriptionStatus[] = ['active', 'past_due', 'reactivated'];

export type LearningAccessReason = 'LICENSED' | 'NOT_OWNER' | 'NO_LICENSE' | 'NOT_ACTIVE' | 'PERIOD_ENDED';

export interface LearningAccess {
  licensed: boolean;
  reason: LearningAccessReason;
  /** Effective subscription status (after admin-grant expiry reconciliation). */
  status: SubscriptionStatus;
  source: 'ADMIN_GRANT' | 'PAID' | 'NONE';
  /** When the current access ends, if known (admin grant expiry or paid period end). */
  validUntil: string | null;
}

/** Pure decision -- see module comment. */
export function decideLearningAccess(sub: SubscriptionRecord, isOwner: boolean, now: Date = new Date()): LearningAccess {
  const source: LearningAccess['source'] = !sub.id ? 'NONE' : sub.manuallySetByAdmin ? 'ADMIN_GRANT' : 'PAID';
  const validUntil = sub.manuallySetByAdmin ? sub.grantExpiresAt : sub.currentPeriodEnd;
  const base = { status: sub.status, source, validUntil };

  if (!isOwner) return { ...base, licensed: false, reason: 'NOT_OWNER' };
  if (!sub.id) return { ...base, licensed: false, reason: 'NO_LICENSE' };
  if (sub.manuallySetByAdmin && sub.grantExpiresAt && new Date(sub.grantExpiresAt).getTime() <= now.getTime()) {
    return { ...base, licensed: false, reason: 'PERIOD_ENDED' };
  }
  if (PAID_ACCESS_STATUSES.includes(sub.status)) return { ...base, licensed: true, reason: 'LICENSED' };
  if (sub.status === 'cancelled_at_period_end') {
    const inPeriod = !!sub.currentPeriodEnd && new Date(sub.currentPeriodEnd).getTime() >= now.getTime();
    return { ...base, licensed: inPeriod, reason: inPeriod ? 'LICENSED' : 'PERIOD_ENDED' };
  }
  return { ...base, licensed: false, reason: 'NOT_ACTIVE' };
}

/** Ownership through the F1 canonical link -- the learner's own account only. */
export async function isLearnerOwner(actorUserId: string, learnerId: string): Promise<boolean> {
  try {
    const result = await db.query(`SELECT 1 FROM students WHERE id = $1 AND user_id = $2 LIMIT 1`, [learnerId, actorUserId]);
    return result.rows.length > 0;
  } catch {
    return false;
  }
}

export async function resolveLearningAccess(actorUserId: string, learnerId: string): Promise<LearningAccess> {
  const [owner, sub] = await Promise.all([isLearnerOwner(actorUserId, learnerId), getEffectiveSubscription(learnerId)]);
  return decideLearningAccess(sub, owner);
}

/**
 * What the Billing page displays: the canonical resolution, never the raw
 * row. A row that says "active" but does not grant access (e.g. not linked
 * to this learner) is shown as demo/unpaid -- Billing can never say "up to
 * date" while the rest of the app treats the learner as unlicensed.
 */
export function billingDisplayStatus(access: LearningAccess): SubscriptionStatus {
  if (access.licensed) return access.status;
  return PAID_ACCESS_STATUSES.includes(access.status) ? 'unpaid' : access.status;
}
