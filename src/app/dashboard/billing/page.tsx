import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { getOrCreateStudentId } from '@/lib/auth';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { getSubscriptionStatus } from '@/services/payment.service';
import SubscribeButton from './SubscribeButton';

const STATUS_MESSAGE_KEY = {
  active: 'billing.statusActive',
  unpaid: 'billing.statusUnpaid',
  past_due: 'billing.statusPastDue',
  canceled: 'billing.statusCanceled',
} as const;

const STATUS_CHIP_CLASS = {
  active: 'chip-good',
  unpaid: 'chip-warn',
  past_due: 'chip-critical',
  canceled: 'chip-critical',
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
