/**
 * Professional Admin Console -- membership/payment governance.
 *
 * Never writes `subscriptions.status` directly: every transition goes
 * through `transitionSubscriptionStatus` (`src/lib/entitlements/
 * subscription.service.ts`), F3's own certified single writer
 * (AC-F3-16) -- this file only adds grant metadata (reason/expiry/
 * granted-by/source) alongside a validated transition, and records
 * the real-money side (`payments`) and the timeline
 * (`subscription_events`). A manual approval never substitutes a real
 * payment provider's own webhook as the source of truth for
 * provider-processed payments -- this service is exclusively for
 * payments a human is manually reconciling (bank transfer, cash,
 * institutional agreement), never for MercadoPago-processed ones.
 */
import { db } from '@/lib/db';
import { transitionSubscriptionStatus, getSubscription } from '@/lib/entitlements/subscription.service';
import { isValidTransition } from '@/lib/entitlements/subscription-state-machine';
import type { SubscriptionStatus, SubscriptionSource } from '@/lib/entitlements/types';
import { recordAdminAction } from '@/lib/admin/audit';

export class MissingExpirationError extends Error {
  constructor() {
    super('MISSING_EXPIRATION');
  }
}
export class DuplicateReferenceError extends Error {
  constructor() {
    super('DUPLICATE_REFERENCE');
  }
}
export class InvalidMembershipTransitionError extends Error {
  constructor(public from: string, public to: string) {
    super('INVALID_MEMBERSHIP_TRANSITION');
  }
}
export class PayerLacksRelationshipError extends Error {
  constructor() {
    super('PAYER_LACKS_ACTIVE_RELATIONSHIP');
  }
}

export const STATUS_LABELS_ES: Record<SubscriptionStatus, string> = {
  unpaid: 'Pago pendiente',
  payment_under_review: 'Pago en revisión',
  active: 'Activa',
  past_due: 'Pago vencido',
  suspended: 'Suspendida',
  reactivated: 'Reactivada',
  canceled: 'Cancelada',
  cancelled_at_period_end: 'Cancelada (fin de periodo)',
  expired: 'Vencida',
  refunded: 'Reembolsada',
  disputed: 'En disputa',
};

/**
 * A STUDYUS_ADMIN IS allowed to administer their own membership --
 * create it, approve it, suspend/reactivate it, grant themselves a
 * license -- a second administrator is never required. What changes
 * when actor and beneficiary are the same canonical user is only the
 * audit trail: every recordAdminAction call below adds
 * `selfApproved: true` and the literal marker
 * `SELF_APPROVED_BY_SYSTEM_ADMIN` to `newState` whenever this resolves
 * true, so a review of the audit log can find every one of these at a
 * glance. The UI (BeneficiaryPicker-driven modals, membership detail
 * actions) shows a reinforced warning and requires an extra explicit
 * confirmation before submitting in this case -- but the SERVER never
 * trusts a client-provided flag for this: it is always recomputed here
 * from the real ownership of `studentId`.
 */
async function isSelfApproval(actorUserId: string, studentId: string): Promise<boolean> {
  const result = await db.query(`SELECT user_id FROM students WHERE id = $1`, [studentId]);
  return result.rows[0]?.user_id === actorUserId;
}

function withSelfApprovalMarker(newState: Record<string, unknown>, selfApproved: boolean): Record<string, unknown> {
  return selfApproved ? { ...newState, selfApproved: true, selfApprovalMarker: 'SELF_APPROVED_BY_SYSTEM_ADMIN' } : newState;
}

async function ensureSubscriptionRow(studentId: string): Promise<string> {
  const result = await db.query(
    `INSERT INTO subscriptions (student_id, status) VALUES ($1, 'unpaid') ON CONFLICT (student_id) DO UPDATE SET student_id = EXCLUDED.student_id RETURNING id`,
    [studentId]
  );
  return result.rows[0].id;
}

async function recordEvent(
  subscriptionId: string,
  actorUserId: string | null,
  eventType: string,
  previousStatus: string | null,
  newStatus: string | null,
  reason: string | null,
  source: string | null,
  metadata?: unknown
): Promise<void> {
  await db.query(
    `INSERT INTO subscription_events (subscription_id, actor_user_id, event_type, previous_status, new_status, reason, source, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [subscriptionId, actorUserId, eventType, previousStatus, newStatus, reason, source, metadata ? JSON.stringify(metadata) : null]
  );
}

// ---------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------

export interface MembershipListFilters {
  status?: SubscriptionStatus;
  plan?: string;
  source?: SubscriptionSource;
  query?: string;
}

export interface MembershipListItem {
  subscriptionId: string;
  studentId: string;
  studentLabel: string;
  plan: string | null;
  status: SubscriptionStatus;
  statusLabel: string;
  source: string | null;
  payerUserId: string | null;
  currentPeriodEnd: string | null;
  grantExpiresAt: string | null;
  createdAt: string;
}

export async function listMemberships(filters: MembershipListFilters, page: number, pageSize: number): Promise<{ items: MembershipListItem[]; totalCount: number }> {
  const conditions: string[] = [];
  const params: any[] = [];
  let i = 1;

  if (filters.status) {
    conditions.push(`s.status = $${i}`);
    params.push(filters.status);
    i++;
  }
  if (filters.plan) {
    conditions.push(`s.plan = $${i}`);
    params.push(filters.plan);
    i++;
  }
  if (filters.source) {
    conditions.push(`s.source = $${i}`);
    params.push(filters.source);
    i++;
  }
  if (filters.query) {
    conditions.push(`st.email ILIKE $${i}`);
    params.push(`%${filters.query}%`);
    i++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (page - 1) * pageSize;

  const countResult = await db.query(`SELECT COUNT(*)::int AS c FROM subscriptions s JOIN students st ON st.id = s.student_id ${whereClause}`, params);
  const rowsResult = await db.query(
    `SELECT s.id, s.student_id, st.email AS student_email, s.plan, s.status, s.source, s.payer_user_id, s.current_period_end, s.grant_expires_at, s.created_at
     FROM subscriptions s JOIN students st ON st.id = s.student_id
     ${whereClause} ORDER BY s.created_at DESC LIMIT $${i} OFFSET $${i + 1}`,
    [...params, pageSize, offset]
  );

  const items: MembershipListItem[] = rowsResult.rows.map((r: any) => ({
    subscriptionId: r.id,
    studentId: r.student_id,
    studentLabel: maskEmail(r.student_email),
    plan: r.plan,
    status: r.status,
    statusLabel: STATUS_LABELS_ES[r.status as SubscriptionStatus] ?? r.status,
    source: r.source,
    payerUserId: r.payer_user_id,
    currentPeriodEnd: r.current_period_end ? new Date(r.current_period_end).toISOString() : null,
    grantExpiresAt: r.grant_expires_at ? new Date(r.grant_expires_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString(),
  }));

  return { items, totalCount: countResult.rows[0]?.c ?? 0 };
}

function maskEmail(email: string | null): string {
  if (!email) return '(sin correo)';
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  return `${local.slice(0, 2)}${'*'.repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

export interface MembershipTimelineEntry {
  eventType: string;
  previousStatus: string | null;
  newStatus: string | null;
  reason: string | null;
  source: string | null;
  occurredAt: string;
}

export interface MembershipDetail extends MembershipListItem {
  manuallySetByAdmin: boolean;
  grantReason: string | null;
  timeline: MembershipTimelineEntry[];
  payments: Array<{ id: string; amountCents: number; currency: string; provider: string; status: string; occurredAt: string; approvalMethod: string | null }>;
  /** True when the viewing STUDYUS_ADMIN is themself the beneficiary of this membership -- server-computed, drives the UI's reinforced self-approval warning. */
  isSelfApproval: boolean;
}

export async function getMembershipDetail(subscriptionId: string, viewerUserId?: string): Promise<MembershipDetail | null> {
  const subResult = await db.query(
    `SELECT s.id, s.student_id, st.email AS student_email, s.plan, s.status, s.source, s.payer_user_id, s.current_period_end,
            s.grant_expires_at, s.grant_reason, s.manually_set_by_admin, s.created_at
     FROM subscriptions s JOIN students st ON st.id = s.student_id WHERE s.id = $1`,
    [subscriptionId]
  );
  if (subResult.rows.length === 0) return null;
  const r = subResult.rows[0];

  const [timeline, payments] = await Promise.all([
    db.query(
      `SELECT event_type, previous_status, new_status, reason, source, occurred_at FROM subscription_events WHERE subscription_id = $1 ORDER BY occurred_at DESC LIMIT 100`,
      [subscriptionId]
    ),
    db.query(
      `SELECT id, amount_cents, currency, provider, status, occurred_at, approval_method FROM payments WHERE subscription_id = $1 ORDER BY occurred_at DESC LIMIT 50`,
      [subscriptionId]
    ),
  ]);

  return {
    subscriptionId: r.id,
    studentId: r.student_id,
    studentLabel: maskEmail(r.student_email),
    plan: r.plan,
    status: r.status,
    statusLabel: STATUS_LABELS_ES[r.status as SubscriptionStatus] ?? r.status,
    source: r.source,
    payerUserId: r.payer_user_id,
    currentPeriodEnd: r.current_period_end ? new Date(r.current_period_end).toISOString() : null,
    grantExpiresAt: r.grant_expires_at ? new Date(r.grant_expires_at).toISOString() : null,
    grantReason: r.grant_reason,
    manuallySetByAdmin: r.manually_set_by_admin,
    createdAt: new Date(r.created_at).toISOString(),
    timeline: timeline.rows.map((t: any) => ({
      eventType: t.event_type,
      previousStatus: t.previous_status,
      newStatus: t.new_status,
      reason: t.reason,
      source: t.source,
      occurredAt: new Date(t.occurred_at).toISOString(),
    })),
    payments: payments.rows.map((p: any) => ({
      id: p.id,
      amountCents: p.amount_cents,
      currency: p.currency,
      provider: p.provider,
      status: p.status,
      occurredAt: new Date(p.occurred_at).toISOString(),
      approvalMethod: p.approval_method,
    })),
    isSelfApproval: viewerUserId ? await isSelfApproval(viewerUserId, r.student_id) : false,
  };
}

// ---------------------------------------------------------------------
// Manual payment approval
// ---------------------------------------------------------------------

export interface ApproveManualPaymentParams {
  studentId: string;
  plan: string;
  amountCents: number;
  currency: string;
  occurredAt: string;
  reference: string;
  method: string;
  evidenceReference?: string;
  notes?: string;
  validUntil: string;
  payerUserId?: string | null;
}

/** Never for provider-processed payments (MercadoPago's own webhook remains the sole source of truth for those) -- exclusively for a human reconciling a bank transfer, cash, or institutional agreement. */
export async function approveManualPayment(actorUserId: string, params: ApproveManualPaymentParams): Promise<{ subscriptionId: string }> {
  const subscriptionId = await ensureSubscriptionRow(params.studentId);
  const before = await getSubscription(params.studentId);

  try {
    await db.query(
      `INSERT INTO payments (subscription_id, payer_user_id, amount_cents, currency, provider, provider_reference, status, occurred_at, approved_by_user_id, approval_method, approval_evidence_reference, approval_notes)
       VALUES ($1, $2, $3, $4, 'manual', $5, 'SUCCEEDED', $6, $7, $8, $9, $10)`,
      [subscriptionId, params.payerUserId ?? null, params.amountCents, params.currency, params.reference, params.occurredAt, actorUserId, params.method, params.evidenceReference ?? null, params.notes ?? null]
    );
  } catch (error: any) {
    if (error?.code === '23505') throw new DuplicateReferenceError();
    throw error;
  }

  const targetStatus: SubscriptionStatus = 'active';
  if (isValidTransition(before.status, targetStatus)) {
    await transitionSubscriptionStatus(params.studentId, targetStatus);
  } else if (before.status !== targetStatus) {
    throw new InvalidMembershipTransitionError(before.status, targetStatus);
  }

  await db.query(
    `UPDATE subscriptions SET plan = $1, source = $2, current_period_end = $3, granted_by_user_id = $4 WHERE id = $5`,
    [params.plan, 'INDIVIDUAL_PAYMENT', params.validUntil, actorUserId, subscriptionId]
  );

  await recordEvent(subscriptionId, actorUserId, 'PAYMENT_CONFIRMED', before.status, targetStatus, params.notes ?? null, 'INDIVIDUAL_PAYMENT', { reference: params.reference, amountCents: params.amountCents });
  const selfApproved = await isSelfApproval(actorUserId, params.studentId);
  await recordAdminAction({
    actorUserId,
    action: 'PAYMENT_APPROVED',
    targetType: 'USER',
    targetId: params.studentId,
    previousState: { status: before.status },
    newState: withSelfApprovalMarker({ plan: params.plan, amountCents: params.amountCents, currency: params.currency, newStatus: targetStatus }, selfApproved),
  });

  return { subscriptionId };
}

// ---------------------------------------------------------------------
// Administrative grants -- expiration always mandatory
// ---------------------------------------------------------------------

export interface GrantLicenseParams {
  studentId: string;
  reason: string;
  expiresAt: string;
  source?: SubscriptionSource;
}

export async function grantAdminLicense(actorUserId: string, params: GrantLicenseParams): Promise<{ subscriptionId: string }> {
  if (!params.expiresAt) throw new MissingExpirationError();

  const subscriptionId = await ensureSubscriptionRow(params.studentId);
  const before = await getSubscription(params.studentId);

  const targetStatus: SubscriptionStatus = 'active';
  if (isValidTransition(before.status, targetStatus)) {
    await transitionSubscriptionStatus(params.studentId, targetStatus);
  } else if (before.status !== targetStatus) {
    throw new InvalidMembershipTransitionError(before.status, targetStatus);
  }

  await db.query(
    `UPDATE subscriptions SET manually_set_by_admin = true, grant_reason = $1, grant_expires_at = $2, granted_by_user_id = $3, source = $4 WHERE id = $5`,
    [params.reason, params.expiresAt, actorUserId, params.source ?? 'ADMIN_PROMOTION', subscriptionId]
  );

  await recordEvent(subscriptionId, actorUserId, 'LICENSE_ACTIVATED', before.status, targetStatus, params.reason, params.source ?? 'ADMIN_PROMOTION', { expiresAt: params.expiresAt });
  const selfApproved = await isSelfApproval(actorUserId, params.studentId);
  await recordAdminAction({
    actorUserId,
    action: 'LICENSE_GRANTED',
    targetType: 'USER',
    targetId: params.studentId,
    reason: params.reason,
    previousState: { status: before.status },
    newState: withSelfApprovalMarker({ expiresAt: params.expiresAt, newStatus: targetStatus }, selfApproved),
  });

  return { subscriptionId };
}

export async function revokeLicenseGrant(actorUserId: string, studentId: string, reason: string): Promise<void> {
  const before = await getSubscription(studentId);
  if (!isValidTransition(before.status, 'suspended')) throw new InvalidMembershipTransitionError(before.status, 'suspended');

  await transitionSubscriptionStatus(studentId, 'suspended');
  const subscriptionId = (await db.query(`SELECT id FROM subscriptions WHERE student_id = $1`, [studentId])).rows[0].id;
  await recordEvent(subscriptionId, actorUserId, 'SUSPENDED', before.status, 'suspended', reason, null);
  const selfApproved = await isSelfApproval(actorUserId, studentId);
  await recordAdminAction({
    actorUserId,
    action: 'LICENSE_REVOKED',
    targetType: 'USER',
    targetId: studentId,
    reason,
    previousState: { status: before.status },
    newState: withSelfApprovalMarker({ newStatus: 'suspended' }, selfApproved),
  });
}

// ---------------------------------------------------------------------
// Membership status (distinct from user account status)
// ---------------------------------------------------------------------

export async function suspendMembership(actorUserId: string, studentId: string, reason: string): Promise<void> {
  const before = await getSubscription(studentId);
  if (!isValidTransition(before.status, 'suspended')) throw new InvalidMembershipTransitionError(before.status, 'suspended');

  await transitionSubscriptionStatus(studentId, 'suspended');
  const subscriptionId = (await db.query(`SELECT id FROM subscriptions WHERE student_id = $1`, [studentId])).rows[0].id;
  await recordEvent(subscriptionId, actorUserId, 'SUSPENDED', before.status, 'suspended', reason, null);
  const selfApproved = await isSelfApproval(actorUserId, studentId);
  await recordAdminAction({
    actorUserId,
    action: 'MEMBERSHIP_SUSPENDED',
    targetType: 'USER',
    targetId: studentId,
    reason,
    previousState: { status: before.status },
    newState: withSelfApprovalMarker({ newStatus: 'suspended' }, selfApproved),
  });
}

/** Chains suspended -> reactivated -> active, the existing certified state machine's own two-step path -- never a new direct edge. */
export async function reactivateMembership(actorUserId: string, studentId: string, reason: string): Promise<void> {
  const before = await getSubscription(studentId);
  if (before.status !== 'suspended') throw new InvalidMembershipTransitionError(before.status, 'active');

  await transitionSubscriptionStatus(studentId, 'reactivated');
  await transitionSubscriptionStatus(studentId, 'active');
  const subscriptionId = (await db.query(`SELECT id FROM subscriptions WHERE student_id = $1`, [studentId])).rows[0].id;
  await recordEvent(subscriptionId, actorUserId, 'REACTIVATED', before.status, 'active', reason, null);
  const selfApproved = await isSelfApproval(actorUserId, studentId);
  await recordAdminAction({
    actorUserId,
    action: 'MEMBERSHIP_REACTIVATED',
    targetType: 'USER',
    targetId: studentId,
    reason,
    previousState: { status: before.status },
    newState: withSelfApprovalMarker({ newStatus: 'active' }, selfApproved),
  });
}

export async function cancelMembership(actorUserId: string, studentId: string, reason: string): Promise<void> {
  const before = await getSubscription(studentId);
  if (!isValidTransition(before.status, 'cancelled_at_period_end')) throw new InvalidMembershipTransitionError(before.status, 'cancelled_at_period_end');

  await transitionSubscriptionStatus(studentId, 'cancelled_at_period_end');
  const subscriptionId = (await db.query(`SELECT id FROM subscriptions WHERE student_id = $1`, [studentId])).rows[0].id;
  await recordEvent(subscriptionId, actorUserId, 'CANCELLED', before.status, 'cancelled_at_period_end', reason, null);
  const selfApproved = await isSelfApproval(actorUserId, studentId);
  await recordAdminAction({
    actorUserId,
    action: 'MEMBERSHIP_CANCELLED',
    targetType: 'USER',
    targetId: studentId,
    reason,
    previousState: { status: before.status },
    newState: withSelfApprovalMarker({ newStatus: 'cancelled_at_period_end' }, selfApproved),
  });
}

// ---------------------------------------------------------------------
// Refunds / disputes -- record and reconcile only. Never calls a real
// payment provider (no MercadoPago credential exists in this
// environment) -- the UI must show "Acción requerida en el proveedor
// de pagos" alongside this, never imply the refund was actually issued.
// ---------------------------------------------------------------------

export async function recordRefundOrDispute(
  actorUserId: string,
  studentId: string,
  type: 'REFUND' | 'DISPUTE',
  notes: string
): Promise<void> {
  const before = await getSubscription(studentId);
  const targetStatus: SubscriptionStatus = type === 'REFUND' ? 'refunded' : 'disputed';
  if (!isValidTransition(before.status, targetStatus)) throw new InvalidMembershipTransitionError(before.status, targetStatus);

  await transitionSubscriptionStatus(studentId, targetStatus);
  const subscriptionId = (await db.query(`SELECT id FROM subscriptions WHERE student_id = $1`, [studentId])).rows[0].id;
  await db.query(`UPDATE payments SET status = $1 WHERE subscription_id = $2 AND status = 'SUCCEEDED'`, [type === 'REFUND' ? 'REFUNDED' : 'DISPUTED', subscriptionId]);
  await recordEvent(subscriptionId, actorUserId, targetStatus === 'refunded' ? 'REFUNDED' : 'DISPUTED', before.status, targetStatus, notes, null);
  const selfApproved = await isSelfApproval(actorUserId, studentId);
  await recordAdminAction({
    actorUserId,
    action: 'REFUND_DISPUTE_RECORDED',
    targetType: 'USER',
    targetId: studentId,
    reason: notes,
    previousState: { status: before.status },
    newState: withSelfApprovalMarker({ type, newStatus: targetStatus }, selfApproved),
  });
}

// ---------------------------------------------------------------------
// Consistency detection -- a real, bounded subset, never fabricating a
// repair. Each finding names the exact rows involved by id only.
// ---------------------------------------------------------------------

export interface MembershipInconsistency {
  type: string;
  label: string;
  subscriptionId: string;
  studentId: string;
}

export async function detectMembershipInconsistencies(): Promise<MembershipInconsistency[]> {
  const findings: MembershipInconsistency[] = [];

  const staleParentGrants = await db.query(`
    SELECT s.id, s.student_id FROM subscriptions s
    WHERE s.status = 'active' AND s.source = 'PARENT_PAYMENT' AND s.payer_user_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM parent_student_relationships psr
        WHERE psr.student_id = s.student_id AND psr.status = 'accepted'
          AND psr.parent_id IN (SELECT id FROM profiles WHERE user_id = s.payer_user_id)
      )
  `);
  for (const r of staleParentGrants.rows) {
    findings.push({ type: 'PARENT_PAYER_WITHOUT_ACTIVE_RELATIONSHIP', label: 'Licencia activa pagada por un padre sin relación vigente', subscriptionId: r.id, studentId: r.student_id });
  }

  const expiredButActive = await db.query(`
    SELECT id, student_id FROM subscriptions WHERE status = 'active' AND grant_expires_at IS NOT NULL AND grant_expires_at < NOW()
  `);
  for (const r of expiredButActive.rows) {
    findings.push({ type: 'GRANT_EXPIRED_STILL_ACTIVE', label: 'Concesión administrativa vencida pero la licencia sigue activa', subscriptionId: r.id, studentId: r.student_id });
  }

  const activeWithoutSource = await db.query(`SELECT id, student_id FROM subscriptions WHERE status = 'active' AND source IS NULL`);
  for (const r of activeWithoutSource.rows) {
    findings.push({ type: 'ACTIVE_WITHOUT_SOURCE', label: 'Licencia activa sin fuente registrada', subscriptionId: r.id, studentId: r.student_id });
  }

  const refundedButActive = await db.query(`
    SELECT s.id, s.student_id FROM subscriptions s
    WHERE s.status = 'active' AND EXISTS (SELECT 1 FROM payments p WHERE p.subscription_id = s.id AND p.status = 'REFUNDED')
  `);
  for (const r of refundedButActive.rows) {
    findings.push({ type: 'REFUNDED_PAYMENT_STILL_ACTIVE', label: 'Pago reembolsado pero la licencia sigue activa', subscriptionId: r.id, studentId: r.student_id });
  }

  return findings;
}

// ---------------------------------------------------------------------
// Beneficiary search -- used only to pick the correct student when
// approving a payment or granting a license. Shows the full email
// (unlike the masked `studentLabel` in listings) because the admin
// must be certain of the exact beneficiary before committing money or
// access to their account.
// ---------------------------------------------------------------------

export interface StudentBeneficiaryOption {
  studentId: string;
  email: string;
  /** The canonical users.id owning this student profile -- lets the client compare it to its own signed-in admin id and show the self-approval warning BEFORE submitting. The server never trusts this comparison; it always recomputes `isSelfApproval` itself. */
  ownerUserId: string | null;
}

export async function searchStudentBeneficiaries(query: string): Promise<StudentBeneficiaryOption[]> {
  if (!query || query.trim().length < 2) return [];
  const result = await db.query(`SELECT id, email, user_id FROM students WHERE email ILIKE $1 ORDER BY email LIMIT 20`, [`%${query.trim()}%`]);
  return result.rows.map((r: any) => ({ studentId: r.id, email: r.email, ownerUserId: r.user_id ?? null }));
}

export async function getStudentIdForSubscription(subscriptionId: string): Promise<string | null> {
  const result = await db.query(`SELECT student_id FROM subscriptions WHERE id = $1`, [subscriptionId]);
  return result.rows[0]?.student_id ?? null;
}

export async function reconcileMembership(actorUserId: string, subscriptionId: string): Promise<void> {
  await recordAdminAction({ actorUserId, action: 'MEMBERSHIP_RECONCILED', targetType: 'USER', targetId: subscriptionId, reason: 'Manual review completed; no automatic repair performed' });
}
