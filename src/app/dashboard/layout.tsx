import Link from 'next/link';
import { currentUser } from '@clerk/nextjs/server';
import { getUnreadNotifications } from '@/services/notifications.service';
import { getActiveDebts } from '@/services/learning-debt.service';
import { getStudentStreak } from '@/services/gamification.service';
import { getOrCreateStudentId } from '@/lib/auth';
import { auth } from '@clerk/nextjs/server';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import LanguageSwitcher from './LanguageSwitcher';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId: clerkUserId } = await auth();
  const user = await currentUser();

  let notifCount = 0;
  let debtCount = 0;
  let streak = 0;
  let locale: Awaited<ReturnType<typeof getInterfaceLanguage>> = 'es';

  if (clerkUserId) {
    const studentId = await getOrCreateStudentId(clerkUserId);
    const [notifications, debts, lang, streakCount] = await Promise.all([
      getUnreadNotifications(studentId).catch(() => []),
      getActiveDebts(studentId).catch(() => []),
      getInterfaceLanguage(studentId).catch(() => 'es' as const),
      getStudentStreak(studentId).catch(() => 0),
    ]);
    notifCount = notifications.length;
    debtCount = debts.length;
    locale = lang;
    streak = streakCount;
  }

  const t = getMessages(locale);

  const initials = user
    ? `${(user.firstName || '?')[0]}${(user.lastName || '')[0] || ''}`.toUpperCase()
    : '?';
  const displayName = user?.firstName || 'Student';

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '248px 1fr', minHeight: '100vh' }}>
      <aside
        style={{
          background: 'var(--bg-base)',
          borderRight: '1px solid var(--border-default)',
          padding: 'var(--space-6) var(--space-4)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-8)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', padding: '0 var(--space-2)' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="StudyUS" style={{ height: 30, width: 'auto' }} />
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <NavLink href="/dashboard/today" label={t['nav.today']} />
          <NavLink href="/dashboard" label={t['nav.dashboard']} />
          <NavLink href="/dashboard/subjects" label={t['nav.subjects']} />
          <NavLink href="/dashboard/learning-debt" label={t['nav.debt']} badge={debtCount} />
          <NavLink href="/dashboard/notifications" label={t['nav.notifications']} badge={notifCount} />
          <NavLink href="/dashboard/study-plan" label={t['nav.studyPlan']} />
          <NavLink href="/dashboard/tutor" label={t['nav.tutor']} />
          <NavLink href="/dashboard/parent" label={t['nav.parent']} />
        </nav>

        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <LanguageSwitcher locale={locale} label={t['lang.switcherLabel']} />

          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
              padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-default)',
            }}
          >
            <div
              style={{
                width: 30, height: 30, borderRadius: '50%', background: 'var(--bg-subtle)',
                border: '1px solid var(--border-default)', display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontSize: 12, fontWeight: 650, color: 'var(--text-secondary)', flexShrink: 0,
              }}
            >
              {initials}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {displayName}
              </div>
            </div>
            {streak > 0 && (
              <div
                title={`${streak} ${t['streak.days']} ${t['streak.label']}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0,
                  fontSize: 12.5, fontWeight: 700, color: 'var(--warning)',
                }}
              >
                <span aria-hidden>🔥</span>
                <span className="tabular">{streak}</span>
              </div>
            )}
          </div>
        </div>
      </aside>

      <main style={{ padding: 'var(--space-8) var(--space-16) var(--space-16)', maxWidth: 1120 }}>
        {children}
      </main>
    </div>
  );
}

function NavLink({ href, label, badge }: { href: string; label: string; badge?: number }) {
  return (
    <Link
      href={href}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)',
        padding: '8px var(--space-3)', borderRadius: 'var(--radius-sm)',
        color: 'var(--text-secondary)', fontSize: 14, fontWeight: 500,
      }}
    >
      <span>{label}</span>
      {!!badge && (
        <span
          style={{
            fontSize: 11, fontWeight: 650, background: 'var(--error-subtle)', color: 'var(--error)',
            padding: '1px 7px', borderRadius: 'var(--radius-full)',
          }}
        >
          {badge}
        </span>
      )}
    </Link>
  );
}
