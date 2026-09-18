/**
 * F7 -- GET/POST /api/admin/assessment/exam-definitions
 *
 * Minimal admin surface: inspect and create Exam Definitions. Gated by
 * the same isAdminEmail allowlist as every other /api/admin/* route.
 */
import { auth, currentUser } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isAdminEmail } from '@/services/admin.service';
import { createExamDefinition } from '@/lib/assessment/exam-definition.service';
import { db } from '@/lib/db';

async function requireAdmin() {
  const { userId } = await auth();
  if (!userId) return { ok: false as const, status: 401, error: 'UNAUTHORIZED' };
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? null;
  if (!isAdminEmail(email)) return { ok: false as const, status: 403, error: 'FORBIDDEN' };
  return { ok: true as const };
}

export async function GET() {
  const gate = await requireAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const result = await db.query(`SELECT * FROM exam_definitions ORDER BY name`);
  return NextResponse.json({ success: true, data: { examDefinitions: result.rows } });
}

const CreateSchema = z.object({
  academicProgrammeId: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  examFamily: z.string().min(1).max(100),
  purpose: z.string().max(500).optional(),
  domains: z.array(z.string()).optional(),
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

  const examDefinition = await createExamDefinition(validated);
  return NextResponse.json({ success: true, data: { examDefinition } });
}
