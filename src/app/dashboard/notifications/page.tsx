import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getOrCreateCanonicalUser, resolveAvailableWorkspaces, personaWorkspaceOf } from '@/lib/identity';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages, type MessageKey } from '@/lib/i18n/messages';
import { fillMessage } from '@/lib/i18n/roles-messages';
import { listAccountInbox } from '@/lib/notifications/role-notifications.service';
import ParentRequestsPanel from './ParentRequestsPanel';
import ClassInvitationsPanel from './ClassInvitationsPanel';
import { MarkAllReadButton } from './MarkAllReadButton';

/**
 * Track A -- one notifications page for every account: the inbox of the
 * account's ONE persona plus its capabilities (institution / StudyUS
 * administration), server-resolved. Previously this page provisioned a
 * Student identity unconditionally and crashed for Parent / Teacher /
 * Institution accounts.
 */
export default async function NotificationsPage() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');

  const user = await getOrCreateCanonicalUser(clerkUserId, null);
  const workspaces = await resolveAvailableWorkspaces(user.id);
  if (workspaces.length === 0) redirect('/role-select');
  const workspace = personaWorkspaceOf(workspaces) ?? workspaces[0];

  const locale = await getUserInterfaceLanguage(user.id).catch(() => 'es' as const);
  const t = getMessages(locale);
  const notifications = await listAccountInbox(user.id, workspaces).catch(() => []);
  const hasUnread = notifications.some((n) => !n.readAt);

  return (
    <div>
      <div style={{ marginBottom: 'var(--space-6)', display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <h1>{t['notifications.title']}</h1>
          <p style={{ color: 'var(--text-secondary)', margin: '8px 0 0', fontSize: 15 }}>
            {workspace === 'STUDENT' ? t['notifications.subtitle'] : t['notifications.subtitleRoles']}
          </p>
        </div>
        {hasUnread && <MarkAllReadButton label={t['notifications.markAllRead']} />}
      </div>

      {workspace === 'STUDENT' && (
        <>
          <ParentRequestsPanel locale={locale} />
          <ClassInvitationsPanel locale={locale} />
        </>
      )}

      {notifications.length === 0 ? (
        <div className="card empty-state">
          <strong>{t['notifications.emptyTitle']}</strong>
          {workspace === 'STUDENT' ? t['notifications.emptyBody'] : null}
        </div>
      ) : (
        <ul className="card list-card" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {notifications.map((n) => {
            const key = `notif.${n.type}` as MessageKey;
            const text = n.payload && key in t ? fillMessage(t[key], n.payload) : n.message;
            return (
              <li key={n.id} className={`list-row${n.readAt ? '' : ' ta-notif-unread'}`} style={{ flexWrap: 'wrap' }}>
                <div className="row-main" style={{ flexBasis: 220 }}>
                  <div className="row-title">
                    {text}
                    {!n.readAt && (
                      <span className="chip" style={{ marginLeft: 8 }}>
                        {t['notifications.new']}
                      </span>
                    )}
                  </div>
                  <div className="row-sub">{new Date(n.deliveredAt).toLocaleString(locale)}</div>
                </div>
                {n.actionHref && n.actionHref.startsWith('/dashboard') && n.actionHref !== '/dashboard/notifications' && (
                  <Link href={n.actionHref} className="btn btn-ghost">
                    {t['notifications.open']}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
