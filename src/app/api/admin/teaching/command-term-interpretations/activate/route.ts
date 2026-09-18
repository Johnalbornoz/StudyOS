/**
 * F8 -- POST /api/admin/teaching/command-term-interpretations/activate
 */
import { auth, currentUser } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isAdminEmail } from '@/services/admin.service';
import { activateCommandTermInterpretation } from '@/lib/teaching/command-term-teaching.service';

async function requireAdmin() {
  const { userId } = await auth();
  if (!userId) return { ok: false as const, status: 401, error: 'UNAUTHORIZED' };
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? null;
  if (!isAdminEmail(email)) return { ok: false as const, status: 403, error: 'FORBIDDEN' };
  return { ok: true as const };
}

const ActivateSchema = z.object({ interpretationId: z.string().uuid() });

export async function POST(request: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  let validated;
  try {
    validated = ActivateSchema.parse(await request.json());
  } catch (error: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.errors?.[0]?.message }, { status: 400 });
  }

  try {
    const interpretation = await activateCommandTermInterpretation(validated.interpretationId);
    return NextResponse.json({ success: true, data: { interpretation } });
  } catch (err) {
    return NextResponse.json({ error: 'CONFLICT', message: err instanceof Error ? err.message : 'activation failed' }, { status: 409 });
  }
}
