import type { Metadata } from 'next';
import { currentUser } from '@clerk/nextjs/server';
import { auth } from '@clerk/nextjs/server';
import { isAdminEmail } from '@/services/admin.service';
import { getUnreadNotifications } from '@/services/notifications.service';
import { getActiveDebts } from '@/services/learning-debt.service';
import { getLearningDaysThisWeek } from '@/services/gamification.service';
import { getOrCreateStudentId } from '@/lib/auth';
import { getOrCreateCanonicalUser, resolveAvailableWorkspaces, resolveDefaultWorkspace, getActiveWorkspace, type Workspace } from '@/lib/identity';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { buildLearnerNav } from '@/lib/lx/learner-navigation';
import { buildParentNav, buildTeacherNav, buildInstitutionNav } from '@/lib/lx/workspace-navigation';
import LanguageSwitcher from './LanguageSwitcher';
import LearnerShell, { type ResolvedNavGroup } from './LearnerShell';
import WorkspaceSwitcher, { type WorkspaceOption } from './WorkspaceSwitcher';

// The whole authenticated app is student-specific and must never be
// indexed -- see also the matching Disallow in src/app/robots.ts.
export const metadata: Metadata = {
  title: { absolute: 'StudyUS' },
  robots: { index: false, follow: false },
};

/**
 * F13 -- one shell, resolved per-request from F1's own, unchanged
 * workspace model (`resolveAvailableWorkspaces`/`getActiveWorkspace`,
 * task section 6). Every value here is fetched fresh on every render
 * (a Next.js Server Component, never client-cached) -- this is what
 * makes workspace switching, Parent child switching, and any
 * authorization revoke show up on the very next navigation rather than
 * a stale prior value (task section 36/INV-F13-... cache-safety
 * requirements).
 *
 * STUDENT workspace preserves the EXACT prior behavior byte-for-byte
 * (same student-id resolution, same notification/debt/streak reads,
 * same interface-language key) -- F13 must not risk regressing the one
 * fully-built, certified-by-usage experience while consolidating the
 * others (task's own "do not remove a legacy route that could break an
 * existing production flow").
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { userId: clerkUserId } = await auth();
  const user = await currentUser();

  let notifCount = 0;
  let debtCount = 0;
  // LX-9 A5: renamed from a raw consecutive-day "streak" to a bounded,
  // non-punitive "learning days this week" count -- see
  // gamification.service.ts::getLearningDaysThisWeek's own doc comment.
  let learningDaysThisWeek = 0;
  let locale: Awaited<ReturnType<typeof getInterfaceLanguage>> = 'es';
  let activeWorkspace: Workspace = 'STUDENT';
  let availableWorkspaces: Workspace[] = ['STUDENT'];

  if (clerkUserId) {
    const email = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses[0]?.emailAddress ?? null;
    const canonicalUser = await getOrCreateCanonicalUser(clerkUserId, email);

    const [available, storedActive] = await Promise.all([
      resolveAvailableWorkspaces(canonicalUser.id),
      getActiveWorkspace(canonicalUser.id),
    ]);
    // A user with zero F1 role rows (a pre-F1 legacy account, or one
    // whose only "role" today is the implicit Student one created below)
    // resolves to an empty `available` list -- STUDENT remains the
    // default so this exact pre-F13 login flow never regresses.
    availableWorkspaces = available.length > 0 ? available : ['STUDENT'];
    activeWorkspace = (storedActive && availableWorkspaces.includes(storedActive) ? storedActive : null)
      ?? (await resolveDefaultWorkspace(canonicalUser.id))
      ?? 'STUDENT';

    if (activeWorkspace === 'STUDENT') {
      const studentId = await getOrCreateStudentId(clerkUserId);
      const [notifications, debts, lang, daysThisWeek] = await Promise.all([
        getUnreadNotifications(studentId).catch(() => []),
        getActiveDebts(studentId).catch(() => []),
        getInterfaceLanguage(studentId).catch(() => 'es' as const),
        getLearningDaysThisWeek(studentId).catch(() => 0),
      ]);
      notifCount = notifications.length;
      debtCount = debts.length;
      locale = lang;
      learningDaysThisWeek = daysThisWeek;
    } else {
      // `getUnreadNotifications`/`getActiveDebts` are Student-domain
      // concepts (queried by `students.id`) that have not been
      // generalized to Teacher/Institution/Parent actors -- calling
      // them with a canonical user id here would silently match zero
      // rows (harmless) but is semantically wrong, so this phase simply
      // does not show a notification/debt badge for non-Student
      // workspaces rather than pretend a real read happened (documented
      // residual, see F13_NEXT_PHASE_HANDOFF.md).
      locale = await getInterfaceLanguage(canonicalUser.id).catch(() => 'es' as const);
      // Non-Student workspaces key their interface-language preference
      // by the F1 canonical user id, never by a fabricated Student
      // identity -- see F13_ROLE_WORKSPACE_MODEL.md for why this
      // deliberately does NOT share the Student row's own key (a
      // pre-existing Student's saved preference must never appear to
      // "reset" merely because this phase touched the lookup).
    }
  }

  const t = getMessages(locale);
  const displayName = user?.firstName || 'Student';
  const email = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses[0]?.emailAddress;
  const isAdmin = isAdminEmail(email);

  const rawGroups =
    activeWorkspace === 'PARENT' ? buildParentNav()
    : activeWorkspace === 'TEACHER' ? buildTeacherNav()
    : activeWorkspace === 'INSTITUTION' ? buildInstitutionNav()
    // ADMIN and the STUDENT default both currently render the Student
    // shell's own nav (ADMIN's console link already lives inside it,
    // gated by isAdminEmail exactly as before F13) -- a dedicated Admin
    // nav group set is deferred (see F13_NEXT_PHASE_HANDOFF.md).
    : buildLearnerNav({ isAdmin, debtCount, notifCount });

  // LX-2E: navigation organised around learner intent
  // (Today / My Path / Progress), resolved to plain strings for the
  // client shell.
  const navGroups: ResolvedNavGroup[] = rawGroups.map((g) => ({
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

  const workspaceLabels: Record<WorkspaceOption, string> = {
    STUDENT: t['workspace.student'],
    PARENT: t['workspace.parent'],
    TEACHER: t['workspace.teacher'],
    INSTITUTION: t['workspace.institution'],
    ADMIN: t['workspace.admin'],
  };

  return (
    <LearnerShell
      groups={navGroups}
      displayName={displayName}
      streak={learningDaysThisWeek}
      streakLabel={`${learningDaysThisWeek} ${t['streak.thisWeekLabel']}`}
      menuLabel={t['nav.menu']}
      closeLabel={t['nav.closeMenu']}
      navLabel={t['nav.primary']}
      exitLabel={t['nav.exitActivity']}
      localeSwitcher={<LanguageSwitcher locale={locale} label={t['lang.switcherLabel']} />}
      workspaceSwitcher={
        <WorkspaceSwitcher
          available={availableWorkspaces as WorkspaceOption[]}
          active={activeWorkspace as WorkspaceOption}
          labels={workspaceLabels}
          switcherLabel={t['workspace.switcherLabel']}
          errorLabel={t['error.generic']}
        />
      }
    >
      {children}
    </LearnerShell>
  );
}
