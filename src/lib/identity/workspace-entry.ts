/**
 * A01-LOGIC-03 -- which experience a Student-entry route may render.
 *
 * `/`, `/dashboard` and `/dashboard/onboarding` are Student surfaces that
 * provision a `students` row (`getOrCreateStudentId`) as soon as they
 * render. Next.js renders a page in parallel with its layout, so a
 * layout-level redirect cannot stop that side effect: each entry page
 * must decide BEFORE touching any Student data. This module is that
 * decision, shared by all of them.
 *
 * Rules: an account with no active role goes to role selection; the
 * active workspace is the stored one when still available, otherwise the
 * default (STUDENT first). Only the STUDENT workspace renders the Student
 * experience -- every other workspace is sent to its own home, so an
 * admin-only account never gets a Student profile, while a multi-role
 * account keeps the Student experience whenever Student is active.
 */
import { currentUser } from '@clerk/nextjs/server';
import { bootstrapStudyUSAdminIfEligible } from '@/lib/admin/authorization';
import { ADMIN_HOME } from '@/lib/admin/sections';
import { getOrCreateCanonicalUser } from './canonical-user.service';
import { getActiveWorkspace, resolveAvailableWorkspaces, resolveDefaultWorkspace } from './workspace.service';
import type { Workspace } from './types';

export const ROLE_SELECT_PATH = '/role-select';

export const WORKSPACE_HOME: Record<Workspace, string> = {
  STUDENT: '/dashboard/today',
  PARENT: '/dashboard/parent',
  TEACHER: '/dashboard/teacher',
  INSTITUTION: '/dashboard/institution',
  ADMIN: ADMIN_HOME,
};

export type WorkspaceEntry = { kind: 'STUDENT' } | { kind: 'REDIRECT'; to: string };

export interface WorkspaceEntryInput {
  available: Workspace[];
  stored: Workspace | null;
  defaultWorkspace: Workspace | null;
}

/** Pure decision -- see module comment. */
export function decideWorkspaceEntry({ available, stored, defaultWorkspace }: WorkspaceEntryInput): WorkspaceEntry {
  if (available.length === 0) return { kind: 'REDIRECT', to: ROLE_SELECT_PATH };
  const active = (stored && available.includes(stored) ? stored : null) ?? defaultWorkspace ?? available[0];
  if (active === 'STUDENT') return { kind: 'STUDENT' };
  return { kind: 'REDIRECT', to: WORKSPACE_HOME[active] };
}

/**
 * Resolves the caller's entry decision. Creates the canonical `users` row
 * (and the allowlisted STUDYUS_ADMIN grant) if needed -- never a Student.
 */
export async function resolveWorkspaceEntry(clerkUserId: string): Promise<WorkspaceEntry> {
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses?.[0]?.emailAddress ?? null;
  const canonical = await getOrCreateCanonicalUser(clerkUserId, email);
  await bootstrapStudyUSAdminIfEligible(canonical, email);

  const [available, stored, defaultWorkspace] = await Promise.all([
    resolveAvailableWorkspaces(canonical.id),
    getActiveWorkspace(canonical.id),
    resolveDefaultWorkspace(canonical.id),
  ]);
  return decideWorkspaceEntry({ available, stored, defaultWorkspace });
}
