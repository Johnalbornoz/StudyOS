/**
 * F3 -- Subscription & Entitlement Foundation.
 *
 * `SubscriptionStatus` extends the 4 values already live in production
 * (unpaid/active/past_due/canceled) with the 4 the target state
 * machine adds. See F3_SUBSCRIPTION_STATE_MACHINE.md for the full
 * rationale and the exact allowed-transition table.
 */
export type SubscriptionStatus =
  | 'unpaid'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'suspended'
  | 'reactivated'
  | 'cancelled_at_period_end'
  | 'expired';

export type Plan = 'MONTHLY' | 'ANNUAL';

/**
 * The fixed capability vocabulary this phase introduces. Deliberately
 * small -- see F3_ENTITLEMENT_MODEL.md for what each one means and
 * who can satisfy it. Never merged with F2's LearnerPermission/
 * InstitutionPermission vocabulary -- Authorization and Entitlement
 * are answered by two independent services (INV-F3-13, §14 of the
 * task), composed with AND at the call site, never inside one shared
 * function.
 */
export type Capability = 'LEARNING_FULL_ACCESS' | 'LEARNING_HISTORY_VIEW' | 'BILLING_MANAGE' | 'SUBSCRIPTION_REACTIVATE';

export interface SubscriptionRecord {
  id: string;
  studentId: string;
  status: SubscriptionStatus;
  plan: Plan | null;
  payerUserId: string | null;
  currentPeriodEnd: string | null;
  manuallySetByAdmin: boolean;
}
