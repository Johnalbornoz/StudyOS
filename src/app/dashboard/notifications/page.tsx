import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { getOrCreateStudentId } from '@/lib/auth';
import { getUnreadNotifications } from '@/services/notifications.service';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import ParentRequestsPanel from './ParentRequestsPanel';

export default async function NotificationsPage() {
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
  const notifications = await getUnreadNotifications(studentId).catch(() => []);

  return (
    <div>
      <div style={{ marginBottom: 'var(--space-8)' }}>
        <h1>{t['notifications.title']}</h1>
        <p style={{ color: 'var(--text-secondary)', margin: '8px 0 0', fontSize: 15 }}>
          {t['notifications.subtitle']}
        </p>
      </div>

      <ParentRequestsPanel locale={locale} />

      {notifications.length === 0 ? (
        <div className="card empty-state">
          <strong>{t['notifications.emptyTitle']}</strong>
          {t['notifications.emptyBody']}
        </div>
      ) : (
        <div className="card list-card">
          {notifications.map((n: any) => (
            <div key={n.id} className="list-row">
              <div className="row-main">
                <div className="row-title">{n.title}</div>
                <div className="row-sub">{n.message}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
