import type { Metadata } from 'next';
import Image from 'next/image';
import { currentUser } from '@clerk/nextjs/server';
import { UserButton } from '@clerk/nextjs';
import { CalendarDays, LayoutDashboard, BookOpen, RotateCcw, Bell, ListChecks, MessageCircle, Users, Flame, ShieldCheck, CreditCard } from 'lucide-react';
import { isAdminEmail } from '@/services/admin.service';
import { getUnreadNotifications } from '@/services/notifications.service';
import { getActiveDebts } from '@/services/learning-debt.service';
import { getStudentStreak } from '@/services/gamification.service';
import { getOrCreateStudentId } from '@/lib/auth';
import { auth } from '@clerk/nextjs/server';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import LanguageSwitcher from './LanguageSwitcher';
import SidebarNav from './SidebarNav';

// The whole authenticated app is student-specific and must never be
// indexed -- see also the matching Disallow in src/app/robots.ts.
export const metadata: Metadata = {
  title: { absolute: 'StudyUS' },
  robots: { index: false, follow: false },
};

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

  const displayName = user?.firstName || 'Student';
  const email = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses[0]?.emailAddress;
  const isAdmin = isAdminEmail(email);

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
          <Image src="/logo.png" alt="StudyUS" width={91} height={30} priority style={{ height: 30, width: 'auto' }} />
        </div>

        <SidebarNav
          items={[
            { href: '/dashboard/today', label: t['nav.today'], icon: <CalendarDays size={16} strokeWidth={2} aria-hidden /> },
            { href: '/dashboard', label: t['nav.dashboard'], icon: <LayoutDashboard size={16} strokeWidth={2} aria-hidden /> },
            { href: '/dashboard/subjects', label: t['nav.subjects'], icon: <BookOpen size={16} strokeWidth={2} aria-hidden /> },
            { href: '/dashboard/learning-debt', label: t['nav.debt'], icon: <RotateCcw size={16} strokeWidth={2} aria-hidden />, badge: debtCount },
            { href: '/dashboard/notifications', label: t['nav.notifications'], icon: <Bell size={16} strokeWidth={2} aria-hidden />, badge: notifCount },
            { href: '/dashboard/study-plan', label: t['nav.studyPlan'], icon: <ListChecks size={16} strokeWidth={2} aria-hidden /> },
            { href: '/dashboard/tutor', label: t['nav.tutor'], icon: <MessageCircle size={16} strokeWidth={2} aria-hidden /> },
            { href: '/dashboard/parent', label: t['nav.parent'], icon: <Users size={16} strokeWidth={2} aria-hidden /> },
            { href: '/dashboard/billing', label: t['billing.title'], icon: <CreditCard size={16} strokeWidth={2} aria-hidden /> },
            ...(isAdmin ? [{ href: '/dashboard/admin', label: t['nav.admin'], icon: <ShieldCheck size={16} strokeWidth={2} aria-hidden /> }] : []),
          ]}
        />

        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <LanguageSwitcher locale={locale} label={t['lang.switcherLabel']} />

          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
              padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-default)',
            }}
          >
            <UserButton appearance={{ elements: { avatarBox: { width: 30, height: 30 } } }} />
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
                <Flame size={14} strokeWidth={2.2} aria-hidden fill="currentColor" />
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
