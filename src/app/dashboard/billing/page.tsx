import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { getOrCreateStudentId } from '@/lib/auth';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { getSubscriptionStatus } from '@/services/payment.service';
import SubscribeButton from './SubscribeButton';

// F3: extended with the 4 new subscription statuses -- see
// F3_SUBSCRIPTION_STATE_MACHINE.md. Existing 4 keys/values untouched.
const STATUS_MESSAGE_KEY = {
  active: 'billing.statusActive',
  unpaid: 'billing.statusUnpaid',
  past_due: 'billing.statusPastDue',
  canceled: 'billing.statusCanceled',
  suspended: 'billing.statusSuspended',
  reactivated: 'billing.statusReactivated',
  cancelled_at_period_end: 'billing.statusCancelledAtPeriodEnd',
  expired: 'billing.statusExpired',
  // Admin Console (2026-09-21) -- 3 new statuses, same pattern as F3's own extension above.
  disputed: 'billing.statusDisputed',
  refunded: 'billing.statusRefunded',
  payment_under_review: 'billing.statusPaymentUnderReview',
} as const;

const STATUS_CHIP_CLASS = {
  active: 'chip-good',
  unpaid: 'chip-warn',
  past_due: 'chip-critical',
  canceled: 'chip-critical',
  suspended: 'chip-critical',
  reactivated: 'chip-warn',
  cancelled_at_period_end: 'chip-warn',
  expired: 'chip-critical',
  disputed: 'chip-critical',
  refunded: 'chip-warn',
  payment_under_review: 'chip-warn',
} as const;

export default async function BillingPage() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return (
      <div>
        <h1>Not authenticated</h1>
        <Link href="/sign-in">Sign in</Link>
      </div>
    );
  }

  const studentId = await getOrCreateStudentId(clerkUserId);
  const locale = await getInterfaceLanguage(studentId);
  const t = getMessages(locale);

  const subscription = await getSubscriptionStatus(studentId);

  return (
    <div>
      <div style={{ marginBottom: 'var(--space-8)' }}>
        <h1>{t['billing.title']}</h1>
        <p style={{ color: 'var(--text-secondary)', margin: '8px 0 0', fontSize: 15 }}>{t['billing.subtitle']}</p>
      </div>

      <div className="card" style={{ maxWidth: 480 }}>
        <span className={`chip ${STATUS_CHIP_CLASS[subscription.status]}`}>{t[`payment.status.${subscription.status}`]}</span>
        <p style={{ margin: 'var(--space-4) 0 var(--space-6)', fontSize: 15, color: 'var(--text-secondary)' }}>
          {t[STATUS_MESSAGE_KEY[subscription.status]]}
        </p>

        {subscription.status !== 'active' && (
          <SubscribeButton
            label={t['billing.subscribeButton']}
            notConfiguredMessage={t['billing.notConfigured']}
            errorMessage={t['billing.checkoutError']}
          />
        )}
      </div>
    </div>
  );
}
