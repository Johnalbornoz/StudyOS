/**
 * F7 -- GET/POST /api/admin/assessment/institution-policies
 *
 * Inspect and create Institution Exam Policies (task 20/22). A new
 * policy always starts POLICY_PENDING -- verification is a separate,
 * explicit action (see the verify sub-route).
 */
import { auth, currentUser } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isAdminEmail } from '@/services/admin.service';
import { createInstitutionExamPolicy, listPoliciesForExamVersion } from '@/lib/assessment/institution-policy.service';

async function requireAdmin() {
  const { userId } = await auth();
  if (!userId) return { ok: false as const, status: 401, error: 'UNAUTHORIZED' };
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? null;
  if (!isAdminEmail(email)) return { ok: false as const, status: 403, error: 'FORBIDDEN' };
  return { ok: true as const };
}

export async function GET(request: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const examVersionId = new URL(request.url).searchParams.get('examVersionId');
  if (!examVersionId) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });

  const policies = await listPoliciesForExamVersion(examVersionId);
  return NextResponse.json({ success: true, data: { policies } });
}

const CreateSchema = z.object({
  institutionId: z.string().uuid(),
  examDefinitionId: z.string().uuid(),
  examVersionId: z.string().uuid().optional(),
  admissionContext: z.string().max(500).optional(),
  sourceLocator: z.string().max(500).optional(),
});

export async function POST(request: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  let validated;
  try {
    validated = CreateSchema.parse(await request.json());
  } catch (error: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.errors?.[0]?.message }, { status: 400 });
  }

  const policy = await createInstitutionExamPolicy(validated);
  return NextResponse.json({ success: true, data: { policy } });
}
