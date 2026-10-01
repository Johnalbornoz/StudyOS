/**
 * Exam V2 -- POST /api/admin/assessment/structure  { write?: boolean }
 * Applies the assessment structure catalogue (sources + nodes + bindings to
 * configured verticals). Dry run by default. StudyUS admin only.
 */
import { auth, currentUser } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isAdminEmail } from '@/services/admin.service';
import { applyAssessmentStructure } from '@/lib/exam-core/catalog/structure.service';

async function requireAdmin() {
  const { userId } = await auth();
  if (!userId) return { ok: false as const, status: 401, error: 'UNAUTHORIZED' };
  const user = await currentUser();
  if (!isAdminEmail(user?.emailAddresses?.[0]?.emailAddress ?? null)) return { ok: false as const, status: 403, error: 'FORBIDDEN' };
  return { ok: true as const };
}

export async function POST(request: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const parsed = z.strictObject({ write: z.boolean().default(false) }).safeParse((await request.json().catch(() => ({}))) ?? {});
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  return NextResponse.json({ success: true, data: await applyAssessmentStructure({ write: parsed.data.write }) });
}
