/**
 * F7 -- POST /api/admin/assessment/institution-policies/verify
 *
 * The ONLY path that may set threshold_rules on a policy -- also the
 * only path that moves it from POLICY_PENDING to VERIFIED (task 20/22,
 * AC-F7-07). Never computes an admission verdict itself.
 */
import { auth, currentUser } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isAdminEmail } from '@/services/admin.service';
import { verifyPolicy } from '@/lib/assessment/institution-policy.service';

const Schema = z.object({
  policyId: z.string().uuid(),
  thresholdRules: z.record(z.string(), z.unknown()),
  sectionsConsidered: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? null;
  if (!isAdminEmail(email)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  let validated;
  try {
    validated = Schema.parse(await request.json());
  } catch (error: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.errors?.[0]?.message }, { status: 400 });
  }

  const policy = await verifyPolicy(validated.policyId, validated.thresholdRules, validated.sectionsConsidered);
  return NextResponse.json({ success: true, data: { policy } });
}
