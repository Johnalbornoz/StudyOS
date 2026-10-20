/**
 * Track A -- GET /api/teacher/institution-invitations
 * The caller's OWN pending institution invitations (INVITED teacher memberships). No ids from the client.
 */
import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { listMyTeacherInvitations } from '@/lib/institution/institution-operations.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

async function handleGET() {
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);
  return NextResponse.json({ success: true, data: { invitations: await listMyTeacherInvitations(actor.id) } });
}

export const GET = withAiRequestMetrics('GET /api/teacher/institution-invitations', handleGET);
