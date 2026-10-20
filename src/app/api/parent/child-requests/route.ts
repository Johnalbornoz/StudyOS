/**
 * Track A -- POST /api/parent/child-requests
 *
 * A Parent asks to be linked to a Student by the Student's email. The
 * response is IDENTICAL whether or not the email belongs to a StudyUs
 * student (and whether a request already existed), so this can never be
 * used to discover accounts. A match only creates a PENDING relationship
 * that grants nothing until the Student accepts it
 * (`requestChildLink`, parent.service.ts).
 *
 * Requires an ACTIVE PARENT role (`requireParentProfileId`, 403 otherwise).
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import { requireParentProfileId } from '@/lib/auth';
import { requestChildLink } from '@/services/parent.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

const Schema = z.object({ email: z.string().trim().email().max(320) });

async function handlePOST(request: NextRequest) {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const parentId = await requireParentProfileId(clerkUserId);
  if (!parentId) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  let validated;
  try {
    validated = Schema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  }

  const outcome = await requestChildLink(parentId, validated.email);
  if (outcome === 'RATE_LIMITED') return NextResponse.json({ error: 'TOO_MANY_PENDING_REQUESTS' }, { status: 429 });
  return NextResponse.json({ success: true, data: { status: 'SUBMITTED' } }, { status: 202 });
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const POST = withAiRequestMetrics('POST /api/parent/child-requests', handlePOST);
