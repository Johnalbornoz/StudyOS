import type { Metadata } from 'next';
import { currentUser } from '@clerk/nextjs/server';
import { auth } from '@clerk/nextjs/server';
import { isAdminEmail } from '@/services/admin.service';
import { getUnreadNotifications } from '@/services/notifications.service';
import { getActiveDebts } from '@/services/learning-debt.service';
import { getStudentStreak } from '@/services/gamification.service';
import { getOrCreateStudentId } from '@/lib/auth';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { buildLearnerNav } from '@/lib/lx/learner-navigation';
import LanguageSwitcher from './LanguageSwitcher';
import LearnerShell, { type ResolvedNavGroup } from './LearnerShell';

// The whole authenticated app is student-specific and must never be
// indexed -- see also the matching Disallow in src/app/robots.ts.
export const metadata: Metadata = {
  title: { absolute: 'StudyUS' },
  robots: { index: false, follow: false },
};

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
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

  // LX-2E: navigation organised around learner intent
  // (Today / My Path / Progress), resolved to plain strings for the
  // client shell.
  const navGroups: ResolvedNavGroup[] = buildLearnerNav({ isAdmin, debtCount, notifCount }).map((g) => ({
    kind: g.kind,
    title: g.titleKey ? t[g.titleKey as keyof typeof t] : undefined,
    items: g.items.map((i) => ({
      key: i.key,
      href: i.href,
      label: t[i.labelKey as keyof typeof t] ?? i.key,
      iconKey: i.iconKey,
      badge: i.badge,
    })),
  }));

  return (
    <LearnerShell
      groups={navGroups}
      displayName={displayName}
      streak={streak}
      streakLabel={`${streak} ${t['streak.days']} ${t['streak.label']}`}
      menuLabel={t['nav.menu']}
      closeLabel={t['nav.closeMenu']}
      localeSwitcher={<LanguageSwitcher locale={locale} label={t['lang.switcherLabel']} />}
    >
      {children}
    </LearnerShell>
  );
}
