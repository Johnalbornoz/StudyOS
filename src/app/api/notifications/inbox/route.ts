/**
 * Track A -- the caller's own account inbox: persona + capabilities
 * (server-resolved, never a request parameter).
 * GET: list + unread count + pending business actions (separate from read state).
 * POST { ids?: uuid[], unread?: boolean }: mark read (all when ids omitted)
 * or, with unread: true, mark those ids unread again. Returns the new unread
 * count (the badge). Only rows inside the caller's own inbox scope can change.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser, resolveAvailableWorkspaces } from '@/lib/identity';
import { listAccountInbox, countAccountUnread, markAccountInboxRead, markAccountInboxUnread } from '@/lib/notifications/role-notifications.service';
import { listPendingActions } from '@/lib/notifications/pending-actions.service';

const ReadSchema = z.object({ ids: z.array(z.string().uuid()).max(200).optional(), unread: z.boolean().optional() }).refine((v) => !v.unread || (v.ids?.length ?? 0) > 0);

async function context() {
  const authContext = await verifyAuth();
  if (!authContext) return null;
  const user = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);
  // Track A: one account inbox (persona + capabilities), server-resolved.
  const workspaces = await resolveAvailableWorkspaces(user.id);
  return workspaces.length > 0 ? { user, workspaces } : null;
}

export async function GET() {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const [notifications, unreadCount, pendingActions] = await Promise.all([listAccountInbox(ctx.user.id, ctx.workspaces), countAccountUnread(ctx.user.id, ctx.workspaces), listPendingActions(ctx.user.id, ctx.workspaces)]);
  return NextResponse.json({ success: true, data: { notifications, unreadCount, pendingActions } });
}

export async function POST(request: NextRequest) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const parsed = ReadSchema.safeParse(body ?? {});
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  const marked = parsed.data.unread
    ? await markAccountInboxUnread(ctx.user.id, ctx.workspaces, parsed.data.ids!)
    : await markAccountInboxRead(ctx.user.id, ctx.workspaces, parsed.data.ids);
  const unreadCount = await countAccountUnread(ctx.user.id, ctx.workspaces);
  return NextResponse.json({ success: true, data: { marked, unreadCount } });
}
