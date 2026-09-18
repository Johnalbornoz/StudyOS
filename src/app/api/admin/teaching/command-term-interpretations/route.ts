/**
 * F8 -- GET/POST /api/admin/teaching/command-term-interpretations
 *
 * GET ?commandTermId= lists interpretations for one command term
 * (across all programmes + the default). POST creates a new DRAFT.
 */
import { auth, currentUser } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isAdminEmail } from '@/services/admin.service';
import { db } from '@/lib/db';
import { createCommandTermInterpretation } from '@/lib/teaching/command-term-teaching.service';

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
  const commandTermId = searchParams.get('commandTermId');
  if (!commandTermId) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });

  const result = await db.query(
    `SELECT * FROM command_term_interpretations WHERE command_term_id = $1 ORDER BY academic_programme_id NULLS FIRST, created_at DESC`,
    [commandTermId]
  );
  return NextResponse.json({ success: true, data: { interpretations: result.rows } });
}

const CreateSchema = z.object({
  commandTermId: z.string().uuid(),
  academicProgrammeId: z.string().uuid().optional(),
  expectedStructure: z.string().min(1).max(2000),
  rubricNotes: z.string().max(2000).optional(),
  commonFailurePatterns: z.array(z.string()).optional(),
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

  const interpretation = await createCommandTermInterpretation(validated);
  return NextResponse.json({ success: true, data: { interpretation } });
}
