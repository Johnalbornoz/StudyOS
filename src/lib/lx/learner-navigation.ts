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

import { ADMIN_HOME } from '@/lib/admin/sections';

export type NavGroupKind = 'PRIMARY' | 'SECONDARY' | 'UTILITY';

export interface LearnerNavItem {
  key: string;
  href: string;
  /** i18n message key for the visible label. */
  labelKey: string;
  /** literal label, used instead of `labelKey` by surfaces that are not localized (the admin console). */
  label?: string;
  /** lucide icon name resolved by the shell. */
  iconKey: string;
  /** unread / pending count; falsy hides the badge. */
  badge?: number;
  /** set only where this destination is a documented stand-in for future-phase work. */
  temporaryMappingNote?: string;
  /** UX-2: shown as a tab in the compact (phone/tablet) bottom navigation. Presentation only. */
  mobileTab?: boolean;
  /** UX-5 closure: detail routes this destination owns (highlighted as the same place). Presentation only. */
  activePrefixes?: string[];
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
  /** F14 -- pending Teacher-assigned interventions, badge count only (never a domain decision). */
  assignmentCount?: number;
  /**
   * Student Exam Journey (entry UX): at least one Exam Target is in ACTIVE preparation, as
   * decided by the journey resolver (never by the mere existence of a target or a distant
   * milestone). Absent / false = the UX-5 structure, unchanged.
   */
  examPrepPrimary?: boolean;
}

/**
 * UX-5 closure information architecture -- the learner's mental model is
 * four places, not four overlapping maps:
 *
 *   PRIMARY   Inicio (¿qué hago ahora?) · Aprender (materias, temas,
 *             siguiente paso -- absorbs Mi ruta, Tu conocimiento and
 *             Materias, which stay as detail routes highlighted under
 *             Aprender) · Progreso (¿cómo voy?). These are also the
 *             phone/tablet bottom tabs, plus "Más".
 *             Mis tareas joins PRIMARY only while a teacher has assigned
 *             pending work (badge > 0); otherwise it lives under "Más".
 *   SECONDARY "Más": Tutor, Preparación de examen (also surfaced on
 *             Inicio when an exam goal is active), Mis tareas, Plan de
 *             estudio, Mejorar -- rendered collapsed.
 *   UTILITY   "Cuenta" -- rendered collapsed.
 *
 * Grouping is presentation only; routes, permissions and badge counts
 * are unchanged -- /dashboard/path, /dashboard/knowledge and
 * /dashboard/subjects all still resolve (deep links / detail views).
 */
export function buildLearnerNav(inputs: LearnerNavInputs): LearnerNavGroup[] {
  const hasPendingAssignments = (inputs.assignmentCount ?? 0) > 0;
  const examPrimary = inputs.examPrepPrimary === true;
  const examPrep: LearnerNavItem = { key: 'examPrep', href: '/dashboard/exam-prep', labelKey: 'nav.examPrep', iconKey: 'ClipboardCheck', ...(examPrimary ? { mobileTab: true } : {}) };
  const assignments: LearnerNavItem = {
    key: 'assignments',
    href: '/dashboard/assignments',
    labelKey: 'nav.assignments',
    iconKey: 'ClipboardList',
    badge: inputs.assignmentCount,
  };

  const primary: LearnerNavGroup = {
    kind: 'PRIMARY',
    items: [
      { key: 'today', href: '/dashboard/today', labelKey: 'nav.home', iconKey: 'CalendarDays', mobileTab: true },
      {
        key: 'learn',
        href: '/dashboard/learn',
        labelKey: 'nav.learn',
        iconKey: 'BookOpen',
        mobileTab: true,
        activePrefixes: ['/dashboard/path', '/dashboard/knowledge', '/dashboard/subjects'],
      },
      ...(examPrimary ? [{ ...examPrep, activePrefixes: ['/dashboard/exams'] }] : []),
      { key: 'progress', href: '/dashboard', labelKey: 'nav.progress', iconKey: 'LayoutDashboard', mobileTab: true },
      ...(hasPendingAssignments ? [assignments] : []),
    ],
  };

  const secondary: LearnerNavGroup = {
    kind: 'SECONDARY',
    titleKey: 'nav.groupMore',
    items: [
      { key: 'tutor', href: '/dashboard/tutor', labelKey: 'nav.tutor', iconKey: 'MessageCircle' },
      { key: 'myPlan', href: '/dashboard/plan', labelKey: 'nav.myPlan', iconKey: 'Map' },
      ...(examPrimary ? [] : [examPrep]),
      ...(hasPendingAssignments ? [] : [assignments]),
      { key: 'studyPlan', href: '/dashboard/study-plan', labelKey: 'nav.studyPlan', iconKey: 'ListChecks' },
      { key: 'debt', href: '/dashboard/learning-debt', labelKey: 'nav.debt', iconKey: 'RotateCcw', badge: inputs.debtCount },
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
        ? [{ key: 'admin', href: ADMIN_HOME, labelKey: 'nav.admin', iconKey: 'ShieldCheck' }]
        : []),
    ],
  };

  return [primary, secondary, utility];
}

/** Flat list of every href the shell renders -- for tests / redirect-loop checks. */
export function allNavHrefs(groups: LearnerNavGroup[]): string[] {
  return groups.flatMap((g) => g.items.map((i) => i.href));
}
