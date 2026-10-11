/**
 * L7 PA-1 -- client-side shapes and pure helpers for ParentAccessCard.
 * The routes they describe already exist and decide everything; nothing here
 * authorizes anything.
 */

export const PARENT_ACCESS_ROUTES = {
  parents: '/api/student/parents',
  invitations: '/api/student/parent-invitations',
  revoke: '/api/parent/relationships/revoke',
} as const;

export interface ParentWithAccess {
  parentId: string;
  name: string;
  since: string | null;
}

export interface SentInvitation {
  id: string;
  invitedEmail: string;
  status: 'pending' | 'accepted' | 'declined' | 'revoked';
}

/**
 * Invitations worth showing under "sent": pending and declined. An accepted
 * invitation is represented by the relationship itself (which may since have
 * been revoked), so listing it here would contradict the access list.
 */
export function openInvitations(invitations: SentInvitation[]): SentInvitation[] {
  return invitations.filter((i) => i.status === 'pending' || i.status === 'declined');
}

/** A cheap pre-check so an obvious typo never reaches the server; the route validates again. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function formatSince(since: string | null, locale: string): string | null {
  if (!since) return null;
  const date = new Date(since);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
}
