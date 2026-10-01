/**
 * Track A -- the caller's own account inbox: persona + capabilities
 * (server-resolved, never a request parameter).
 * GET: list + unread count.  POST { ids?: uuid[] }: mark read (all when
 * omitted). Only rows inside the caller's own inbox scope can change.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser, resolveAvailableWorkspaces } from '@/lib/identity';
import { listAccountInbox, countAccountUnread, markAccountInboxRead } from '@/lib/notifications/role-notifications.service';

const ReadSchema = z.object({ ids: z.array(z.string().uuid()).max(200).optional() });

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
  const [notifications, unreadCount] = await Promise.all([listAccountInbox(ctx.user.id, ctx.workspaces), countAccountUnread(ctx.user.id, ctx.workspaces)]);
  return NextResponse.json({ success: true, data: { notifications, unreadCount } });
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
  const marked = await markAccountInboxRead(ctx.user.id, ctx.workspaces, parsed.data.ids);
  return NextResponse.json({ success: true, data: { marked } });
}
