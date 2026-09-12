/**
 * LX-2E -- LEARNER SHELL NAVIGATION CONFIGURATION.
 *
 * A pure, serialisable description of the authenticated navigation,
 * organised around learner INTENT rather than internal product
 * features:
 *
 *   PRIMARY   -- "what should I do / where am I going / how am I doing"
 *   SECONDARY -- useful, not primary
 *   UTILITY   -- account / profile / language / system
 *
 * TEMPORARY MAPPINGS (documented, replaced by later phases):
 *   - "Progress" maps to the existing dashboard Progress page.
 *   - "Today" maps to the existing Today surface (LX-6 redesigns its
 *     contents, not its position).
 *
 * No component / JSX here -- the shell resolves `labelKey` via i18n and
 * `iconKey` via its own icon map, so this stays a plain data module
 * that is trivially unit-testable.
 */

export type NavGroupKind = 'PRIMARY' | 'SECONDARY' | 'UTILITY';

export interface LearnerNavItem {
  key: string;
  href: string;
  /** i18n message key for the visible label. */
  labelKey: string;
  /** lucide icon name resolved by the shell. */
  iconKey: string;
  /** unread / pending count; falsy hides the badge. */
  badge?: number;
  /** set only where this destination is a documented stand-in for future-phase work. */
  temporaryMappingNote?: string;
}

export interface LearnerNavGroup {
  kind: NavGroupKind;
  /** i18n key for a small group heading; omitted for the primary group. */
  titleKey?: string;
  items: LearnerNavItem[];
}

export interface LearnerNavInputs {
  isAdmin: boolean;
  debtCount: number;
  notifCount: number;
}

export function buildLearnerNav(inputs: LearnerNavInputs): LearnerNavGroup[] {
  const primary: LearnerNavGroup = {
    kind: 'PRIMARY',
    items: [
      { key: 'today', href: '/dashboard/today', labelKey: 'nav.today', iconKey: 'CalendarDays' },
      {
        key: 'myPath',
        href: '/dashboard/path',
        labelKey: 'nav.myPath',
        iconKey: 'Route',
      },
      { key: 'progress', href: '/dashboard', labelKey: 'nav.progress', iconKey: 'LayoutDashboard' },
    ],
  };

  const secondary: LearnerNavGroup = {
    kind: 'SECONDARY',
    titleKey: 'nav.groupMore',
    items: [
      { key: 'studyPlan', href: '/dashboard/study-plan', labelKey: 'nav.studyPlan', iconKey: 'ListChecks' },
      { key: 'debt', href: '/dashboard/learning-debt', labelKey: 'nav.debt', iconKey: 'RotateCcw', badge: inputs.debtCount },
      { key: 'tutor', href: '/dashboard/tutor', labelKey: 'nav.tutor', iconKey: 'MessageCircle' },
    ],
  };

  const utility: LearnerNavGroup = {
    kind: 'UTILITY',
    titleKey: 'nav.groupAccount',
    items: [
      { key: 'notifications', href: '/dashboard/notifications', labelKey: 'nav.notifications', iconKey: 'Bell', badge: inputs.notifCount },
      { key: 'profile', href: '/dashboard/profile', labelKey: 'profile.navLabel', iconKey: 'GraduationCap' },
      { key: 'parent', href: '/dashboard/parent', labelKey: 'nav.parent', iconKey: 'Users' },
      { key: 'billing', href: '/dashboard/billing', labelKey: 'billing.title', iconKey: 'CreditCard' },
      ...(inputs.isAdmin
        ? [{ key: 'admin', href: '/dashboard/admin', labelKey: 'nav.admin', iconKey: 'ShieldCheck' }]
        : []),
    ],
  };

  return [primary, secondary, utility];
}

/** Flat list of every href the shell renders -- for tests / redirect-loop checks. */
export function allNavHrefs(groups: LearnerNavGroup[]): string[] {
  return groups.flatMap((g) => g.items.map((i) => i.href));
}
