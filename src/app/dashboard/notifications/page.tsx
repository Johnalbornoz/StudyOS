import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getOrCreateCanonicalUser, resolveAvailableWorkspaces, personaWorkspaceOf } from '@/lib/identity';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages, type MessageKey } from '@/lib/i18n/messages';
import { fillMessage } from '@/lib/i18n/roles-messages';
import { listAccountInbox, countAccountUnread } from '@/lib/notifications/role-notifications.service';
import { listPendingActions, isNotificationActionPending } from '@/lib/notifications/pending-actions.service';
import ParentRequestsPanel from './ParentRequestsPanel';
import ClassInvitationsPanel from './ClassInvitationsPanel';
import { InboxReadControls, MarkUnreadButton } from './InboxReadState';

/**
 * Track A -- one notifications page for every account: the inbox of the
 * account's ONE persona plus its capabilities (institution / StudyUs
 * administration), server-resolved.
 *
 * READ state and BUSINESS state are separate: opening this page marks the
 * notifications it shows as read (the unread badge drops), while an
 * action that is still pending (a class invitation, a parent request, a
 * teacher membership request) keeps its Accept / Decline / Review action
 * and an "Acción pendiente" marker -- never the unread badge.
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
  const [notifications, unreadCount, pending] = await Promise.all([
    listAccountInbox(user.id, workspaces).catch(() => []),
    countAccountUnread(user.id, workspaces).catch(() => 0),
    listPendingActions(user.id, workspaces).catch(() => []),
  ]);
  const displayedUnreadIds = notifications.filter((n) => !n.readAt).map((n) => n.id);
  const institutionPending = pending.filter((p) => p.kind === 'TEACHER_REQUEST');

  return (
    <div>
      <div style={{ marginBottom: 'var(--space-6)', display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <h1>{t['notifications.title']}</h1>
          <p style={{ color: 'var(--text-secondary)', margin: '8px 0 0', fontSize: 15 }}>
            {workspace === 'STUDENT' ? t['notifications.subtitle'] : t['notifications.subtitleRoles']}
          </p>
        </div>
        <InboxReadControls displayedUnreadIds={displayedUnreadIds} initialUnread={unreadCount} label={t['notifications.markAllRead']} />
      </div>

      {pending.length > 0 && (
        <section id="pending" aria-labelledby="pending-title" className="ta-stack" style={{ gap: 'var(--space-3)', marginBottom: 'var(--space-6)' }}>
          <h2 id="pending-title" style={{ fontSize: 18 }}>
            {t['nux.pending.title']} <span className="chip chip-warn">{pending.length}</span>
          </h2>
          <p className="ta-msg">{t['nux.pending.body']}</p>
          {institutionPending.length > 0 && (
            <ul className="card list-card" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {institutionPending.map((p) => (
                <li key={p.id} className="list-row" style={{ flexWrap: 'wrap' }} data-pending={p.kind}>
                  <div className="row-main" style={{ flexBasis: 220 }}>
                    <div className="row-title">{fillMessage(t['nux.pending.TEACHER_REQUEST'], { teacherEmail: p.teacherEmail ?? '', institutionName: p.institutionName ?? '' })}</div>
                    <div className="row-sub">{new Date(p.createdAt).toLocaleString(locale)}</div>
                  </div>
                  <span className="chip chip-warn">{t['nux.pending.chip']}</span>
                  {p.href && (
                    <Link href={p.href} className="btn btn-secondary">
                      {t['nux.pending.review']}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {workspace === 'STUDENT' && (
        <div id="student-pending">
          <ParentRequestsPanel locale={locale} />
          <ClassInvitationsPanel locale={locale} />
        </div>
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
            const actionPending = isNotificationActionPending(n, pending);
            const respondHere = actionPending && (n.type === 'CLASS_ENROLLMENT_INVITE' || n.type === 'PARENT_LINK_REQUEST');
            return (
              <li key={n.id} className={`list-row${n.readAt ? '' : ' ta-notif-unread'}`} style={{ flexWrap: 'wrap' }} data-read={n.readAt ? 'READ' : 'UNREAD'} data-action-pending={actionPending ? 'true' : 'false'}>
                <div className="row-main" style={{ flexBasis: 220 }}>
                  <div className="row-title">
                    {text}
                    {!n.readAt && (
                      <span className="chip" style={{ marginLeft: 8 }}>
                        {t['notifications.new']}
                      </span>
                    )}
                    {actionPending && (
                      <span className="chip chip-warn" style={{ marginLeft: 8 }}>
                        {t['nux.pending.chip']}
                      </span>
                    )}
                  </div>
                  <div className="row-sub">{new Date(n.deliveredAt).toLocaleString(locale)}</div>
                </div>
                <span className="ta-actions">
                  {respondHere && (
                    <a href="#student-pending" className="btn btn-secondary">
                      {t['nux.pending.respond']}
                    </a>
                  )}
                  {n.actionHref && n.actionHref.startsWith('/dashboard') && n.actionHref !== '/dashboard/notifications' && (
                    <Link href={n.actionHref} className="btn btn-ghost">
                      {t['notifications.open']}
                    </Link>
                  )}
                  {n.readAt && <MarkUnreadButton id={n.id} label={t['nux.markUnread']} />}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
