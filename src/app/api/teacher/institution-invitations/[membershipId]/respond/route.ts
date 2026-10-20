/**
 * Track A -- POST /api/teacher/institution-invitations/[membershipId]/respond { accept }
 * The teacher accepts (-> APPROVED) or declines (-> REJECTED) an invitation to THEIR OWN membership.
 * Another user's membership -> 404. Idempotent. Audited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { respondTeacherInvitation } from '@/lib/institution/institution-operations.service';
import { allUuids, readJson } from '@/lib/institution/route-guard';
import { governedError } from '@/lib/institution/route-errors';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

const Schema = z.strictObject({ accept: z.boolean() });

async function handlePOST(request: NextRequest, { params }: { params: Promise<{ membershipId: string }> }) {
  const { membershipId } = await params;
  if (!allUuids(membershipId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);
  const parsed = Schema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  try {
    return NextResponse.json({ success: true, data: await respondTeacherInvitation(actor.id, membershipId, parsed.data.accept) });
  } catch (error) {
    return governedError(error);
  }
}

export const POST = withAiRequestMetrics('POST /api/teacher/institution-invitations/[membershipId]/respond', handlePOST);
