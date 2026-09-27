/**
 * Onboarding/authorization rework (2026-09-21) -- the student's own
 * side of the parent-invitation flow (replaces the parent-initiated
 * `link-child` direction). `studentId` is always the caller's own
 * resolved identity (`requireStudentId`) -- never a request field.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import { requireStudentId } from '@/lib/auth';
import { inviteParentByEmail, listInvitationsSentByStudent, revokeInvitationByStudent } from '@/services/parent.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

const InviteSchema = z.object({ email: z.string().email() });
const RevokeSchema = z.object({ invitationId: z.string().uuid() });

async function handleGET() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const studentId = await requireStudentId(clerkUserId);
  if (!studentId) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const invitations = await listInvitationsSentByStudent(studentId);
  return NextResponse.json({ success: true, data: { invitations } });
}

async function handlePOST(request: NextRequest) {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const studentId = await requireStudentId(clerkUserId);
  if (!studentId) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  let validated;
  try {
    validated = InviteSchema.parse(await request.json());
  } catch (error: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.errors?.[0]?.message }, { status: 400 });
  }

  const invitation = await inviteParentByEmail(studentId, validated.email);
  return NextResponse.json({ success: true, data: { invitation } });
}

async function handleDELETE(request: NextRequest) {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const studentId = await requireStudentId(clerkUserId);
  if (!studentId) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  let validated;
  try {
    validated = RevokeSchema.parse(await request.json());
  } catch (error: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.errors?.[0]?.message }, { status: 400 });
  }

  const revoked = await revokeInvitationByStudent(studentId, validated.invitationId);
  if (!revoked) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  return NextResponse.json({ success: true });
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/student/parent-invitations', handleGET);
export const POST = withAiRequestMetrics('POST /api/student/parent-invitations', handlePOST);
export const DELETE = withAiRequestMetrics('DELETE /api/student/parent-invitations', handleDELETE);
