/**
 * F13 -- navigation configuration for the non-Student workspaces
 * (PARENT/TEACHER/INSTITUTION/ADMIN), in the exact same pure,
 * serialisable shape `learner-navigation.ts` already established for
 * Student (`LearnerNavGroup[]`) -- one shell (`LearnerShell`) renders
 * whichever group set the active workspace resolves to; this is not a
 * second navigation system (task section 6/33).
 *
 * Role-specific navigation items ONLY -- no authorization decision is
 * made here. Which groups a given actor is OFFERED is decided by
 * `resolveAvailableWorkspaces` (F1, unchanged); what each destination
 * ACTUALLY renders is independently re-authorized server-side by the
 * page/route itself (INV-F13-01/03).
 */
import type { LearnerNavGroup } from './learner-navigation';

export function buildParentNav(): LearnerNavGroup[] {
  return [
    {
      kind: 'PRIMARY',
      items: [{ key: 'parentHome', href: '/dashboard/parent', labelKey: 'nav.parent', iconKey: 'Users' }],
    },
    {
      kind: 'UTILITY',
      titleKey: 'nav.groupAccount',
      items: [
        { key: 'notifications', href: '/dashboard/notifications', labelKey: 'nav.notifications', iconKey: 'Bell' },
      ],
    },
  ];
}

export function buildTeacherNav(): LearnerNavGroup[] {
  return [
    {
      kind: 'PRIMARY',
      items: [{ key: 'teacherClasses', href: '/dashboard/teacher', labelKey: 'nav.teacherClasses', iconKey: 'School' }],
    },
    {
      kind: 'UTILITY',
      titleKey: 'nav.groupAccount',
      items: [
        { key: 'notifications', href: '/dashboard/notifications', labelKey: 'nav.notifications', iconKey: 'Bell' },
      ],
    },
  ];
}

export function buildInstitutionNav(): LearnerNavGroup[] {
  return [
    {
      kind: 'PRIMARY',
      items: [{ key: 'institutionOverview', href: '/dashboard/institution', labelKey: 'nav.institutionOverview', iconKey: 'Building2' }],
    },
    {
      kind: 'UTILITY',
      titleKey: 'nav.groupAccount',
      items: [
        { key: 'notifications', href: '/dashboard/notifications', labelKey: 'nav.notifications', iconKey: 'Bell' },
      ],
    },
  ];
}
