/**
 * F7 -- GET/POST /api/admin/assessment/exam-versions
 *
 * Minimal admin surface: inspect versions for an exam definition, and
 * create a new DRAFT version.
 */
import { auth, currentUser } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isAdminEmail } from '@/services/admin.service';
import { createExamVersion } from '@/lib/assessment/exam-definition.service';
import { db } from '@/lib/db';

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

  const examDefinitionId = new URL(request.url).searchParams.get('examDefinitionId');
  if (!examDefinitionId) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });

  const result = await db.query(`SELECT * FROM exam_versions WHERE exam_definition_id = $1 ORDER BY created_at DESC`, [examDefinitionId]);
  return NextResponse.json({ success: true, data: { examVersions: result.rows } });
}

const CreateSchema = z.object({
  examDefinitionId: z.string().uuid(),
  versionLabel: z.string().min(1).max(100),
  effectiveFrom: z.string().optional(),
  scoringModelId: z.string().uuid().optional(),
  supportedModalities: z.array(z.string()).optional(),
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

  const examVersion = await createExamVersion(validated);
  return NextResponse.json({ success: true, data: { examVersion } });
}
