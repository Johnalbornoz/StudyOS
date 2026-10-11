/**
 * L11 / EN-3 -- what a payment-provider event may do to a subscription.
 *
 * Pure. The webhook (src/services/payment.service.ts) re-fetches the real
 * resource from the provider and applies exactly what `decideProviderEvent`
 * returns; nothing else moves a subscription on a provider's word.
 *
 * Rules:
 *  - an administrator's decision is never changed by a provider event: a row
 *    in `suspended`, `disputed`, `refunded` or `payment_under_review` stays
 *    where the administrator put it (same protection as self-reactivation.ts);
 *  - an administrator-set row (`manually_set_by_admin`: a grant, with its own
 *    expiry) is not governed by the provider while the grant stands: its
 *    status and its grant fields are left untouched, so the grant expiry
 *    keeps applying, and no checkout is started (access is already sponsored);
 *  - once a grant has EXPIRED the historical sponsorship no longer blocks a
 *    purchase, and an expired entitlement of any source is renewed only by a
 *    provider-CONFIRMED PAYMENT (`decideConfirmedPayment`) -- never by a
 *    checkout being created or a preapproval being `authorized`;
 *  - `authorized` activates a first purchase through the state machine, never
 *    around it;
 *  - `paused` / `cancelled` only count for the preapproval the subscription
 *    is actually running on (an abandoned second checkout cannot cancel it);
 *  - a cancellation is honoured: `active` ends at the end of the paid period
 *    (`cancelled_at_period_end`), `past_due` / `reactivated` end now (`expired`).
 */
import { isValidTransition } from './subscription-state-machine';
import type { SubscriptionStatus } from './types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Statuses only an administrator moves a subscription out of. */
export const ADMIN_LIFECYCLE_STATUSES: readonly SubscriptionStatus[] = ['suspended', 'disputed', 'refunded', 'payment_under_review'];

/**
 * The checkout's `external_reference`: the learner the licence is for and the
 * user who started THIS checkout. The payer is bound to the subscription only
 * when the provider confirms the payment (never at checkout creation).
 */
export function encodeExternalReference(studentId: string, payerUserId: string): string {
  return `${studentId}:${payerUserId}`;
}

/** Accepts the current `student:payer` form and the earlier bare `student` form. Anything else is null. */
export function parseExternalReference(reference: unknown): { studentId: string; payerUserId: string | null } | null {
  if (typeof reference !== 'string') return null;
  const [studentId, payerUserId, ...rest] = reference.split(':');
  if (rest.length > 0 || !UUID_PATTERN.test(studentId ?? '')) return null;
  if (payerUserId === undefined) return { studentId, payerUserId: null };
  if (!UUID_PATTERN.test(payerUserId)) return null;
  return { studentId, payerUserId };
}

export interface ProviderSubscriptionView {
  /** '' when the learner has no subscription row yet. */
  id: string;
  status: SubscriptionStatus;
  manuallySetByAdmin: boolean;
  providerSubscriptionId: string | null;
  currentPeriodEnd: string | null;
}

export interface ProviderPreapproval {
  id: string;
  /** Mercado Pago preapproval status: pending | authorized | paused | cancelled. */
  status: string;
  nextPaymentDate: string | null;
}

export type ProviderEventSkip =
  | 'PAYMENT_NOT_CONFIRMED'
  | 'STALE_PAYMENT'
  | 'ADMIN_LIFECYCLE'
  | 'ADMIN_CONTROLLED'
  | 'NOT_CURRENT_PREAPPROVAL'
  | 'ALREADY_APPLIED'
  | 'INVALID_TRANSITION'
  | 'NO_STATUS_CHANGE';

export type ProviderEventDecision =
  | { action: 'NONE'; reason: ProviderEventSkip; adoptProviderId: boolean }
  | {
      action: 'TRANSITION';
      to: Extract<SubscriptionStatus, 'active' | 'past_due' | 'cancelled_at_period_end' | 'expired'>;
      /** New `current_period_end`, when the event defines one. */
      periodEnd: string | null;
      adoptProviderId: boolean;
    };

/**
 * An administrator-set row that still stands: anything but a grant that has
 * run out. `expired` on an administrator-set row is only ever reached by the
 * grant passing its own expiry (subscription.service.ts lazy reconciliation);
 * a revocation or suspension lands on `suspended`, which is handled before this.
 */
function isStandingAdminRow(sub: Pick<ProviderSubscriptionView, 'status' | 'manuallySetByAdmin'>): boolean {
  return sub.manuallySetByAdmin && sub.status !== 'expired';
}

const skip = (reason: ProviderEventSkip, adoptProviderId = false): ProviderEventDecision => ({ action: 'NONE', reason, adoptProviderId });

function futureIso(value: string | null | undefined, now: Date): string | null {
  if (!value) return null;
  const at = new Date(value).getTime();
  return Number.isFinite(at) && at > now.getTime() ? new Date(at).toISOString() : null;
}

export function decideProviderEvent(sub: ProviderSubscriptionView, preapproval: ProviderPreapproval, now: Date = new Date()): ProviderEventDecision {
  if (ADMIN_LIFECYCLE_STATUSES.includes(sub.status)) return skip('ADMIN_LIFECYCLE');
  if (isStandingAdminRow(sub)) return skip('ADMIN_CONTROLLED');

  if (preapproval.status === 'authorized') {
    // Renewal after expiry needs a confirmed payment; the preapproval is only remembered.
    if (sub.status === 'expired') return skip('PAYMENT_NOT_CONFIRMED', true);
    if (sub.status === 'active') return skip('ALREADY_APPLIED', true);
    if (!isValidTransition(sub.status, 'active')) return skip('INVALID_TRANSITION');
    return { action: 'TRANSITION', to: 'active', periodEnd: futureIso(preapproval.nextPaymentDate, now), adoptProviderId: true };
  }

  if (preapproval.status === 'paused' || preapproval.status === 'cancelled') {
    if (!sub.providerSubscriptionId || sub.providerSubscriptionId !== preapproval.id) return skip('NOT_CURRENT_PREAPPROVAL');

    if (preapproval.status === 'paused') {
      return isValidTransition(sub.status, 'past_due') ? { action: 'TRANSITION', to: 'past_due', periodEnd: null, adoptProviderId: false } : skip('NO_STATUS_CHANGE');
    }

    if (sub.status === 'active') {
      // Access runs to the end of what was already paid; with no known period it ends now.
      const periodEnd = futureIso(preapproval.nextPaymentDate, now) ?? futureIso(sub.currentPeriodEnd, now) ?? now.toISOString();
      return { action: 'TRANSITION', to: 'cancelled_at_period_end', periodEnd, adoptProviderId: false };
    }
    if (sub.status === 'past_due' || sub.status === 'reactivated') return { action: 'TRANSITION', to: 'expired', periodEnd: null, adoptProviderId: false };
    return skip('NO_STATUS_CHANGE');
  }

  return skip('NO_STATUS_CHANGE');
}

/**
 * May a checkout be started for this subscription at all? Only when a
 * confirmed payment could actually activate it -- otherwise the payer would
 * be charged for a subscription the webhook is not allowed to move.
 */
export function isPurchasable(sub: Pick<ProviderSubscriptionView, 'status' | 'manuallySetByAdmin'>): boolean {
  if (ADMIN_LIFECYCLE_STATUSES.includes(sub.status) || isStandingAdminRow(sub)) return false;
  return isValidTransition(sub.status, 'active');
}

export type ConfirmedPaymentDecision =
  | { action: 'NONE'; reason: ProviderEventSkip }
  | {
      action: 'ACTIVATE';
      /** True when the row is an expired administrative grant: it becomes a paid subscription. */
      fromExpiredGrant: boolean;
    };

/**
 * What a provider-CONFIRMED (approved) payment may do. This is the only
 * provider path that renews an expired entitlement or starts a paid period
 * after an expired grant.
 *
 * `entitlementEndedAt` is when the previous entitlement ended (grant expiry,
 * or the recorded expiry of the paid period). A payment approved before that
 * moment paid for the period that already ended and renews nothing.
 */
export function decideConfirmedPayment(
  sub: Pick<ProviderSubscriptionView, 'status' | 'manuallySetByAdmin'>,
  facts: { approvedAt: string | null; entitlementEndedAt: string | null }
): ConfirmedPaymentDecision {
  if (ADMIN_LIFECYCLE_STATUSES.includes(sub.status)) return { action: 'NONE', reason: 'ADMIN_LIFECYCLE' };
  if (isStandingAdminRow(sub)) return { action: 'NONE', reason: 'ADMIN_CONTROLLED' };
  if (sub.status === 'active') return { action: 'NONE', reason: 'ALREADY_APPLIED' };
  if (!isValidTransition(sub.status, 'active')) return { action: 'NONE', reason: 'INVALID_TRANSITION' };

  if (sub.status === 'expired') {
    const approved = facts.approvedAt ? new Date(facts.approvedAt).getTime() : NaN;
    if (!Number.isFinite(approved)) return { action: 'NONE', reason: 'PAYMENT_NOT_CONFIRMED' };
    const ended = facts.entitlementEndedAt ? new Date(facts.entitlementEndedAt).getTime() : NaN;
    if (Number.isFinite(ended) && approved <= ended) return { action: 'NONE', reason: 'STALE_PAYMENT' };
  }
  return { action: 'ACTIVATE', fromExpiredGrant: sub.manuallySetByAdmin };
}
