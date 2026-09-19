/**
 * F9 -- admin CRUD for score_conversion_models (task §29). Deliberately
 * empty by default in this environment -- see F9_SCORE_PROJECTION_POLICY.md.
 */
import { auth, currentUser } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isAdminEmail } from '@/services/admin.service';
import { db } from '@/lib/db';
import { createScoreConversionModel } from '@/lib/readiness/score-projection.service';

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

  const { searchParams } = new URL(request.url);
  const examVersionId = searchParams.get('examVersionId');
  if (!examVersionId) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });

  const result = await db.query(`SELECT * FROM score_conversion_models WHERE exam_version_id = $1 ORDER BY created_at DESC`, [examVersionId]);
  return NextResponse.json({ success: true, data: { models: result.rows } });
}

const CreateSchema = z.object({
  examVersionId: z.string().uuid(),
  conversionTable: z.record(z.string(), z.unknown()),
  minimumEvidenceCount: z.number().int().min(0),
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

  const model = await createScoreConversionModel(validated);
  return NextResponse.json({ success: true, data: { model } });
}
