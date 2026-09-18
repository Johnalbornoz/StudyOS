/**
 * F4 -- GET/POST /api/admin/catalog/subjects
 *
 * Minimal admin surface (task 19): inspect and create canonical subjects.
 * Gated by the same isAdminEmail allowlist as every other /api/admin/*
 * route -- not a new admin mechanism. Full editorial workflow (structure
 * versions, review/publish states) is explicitly F6 scope.
 */
import { auth, currentUser } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isAdminEmail } from '@/services/admin.service';
import { createCanonicalSubject, listCanonicalSubjects } from '@/lib/catalog/canonical-catalog.service';

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

  const subjects = await listCanonicalSubjects();
  return NextResponse.json({ success: true, data: { subjects } });
}

const CreateSchema = z.object({ name: z.string().min(1).max(200) });

export async function POST(request: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  let validated;
  try {
    validated = CreateSchema.parse(await request.json());
  } catch (error: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.errors?.[0]?.message }, { status: 400 });
  }

  const subject = await createCanonicalSubject(validated.name);
  return NextResponse.json({ success: true, data: { subject } });
}
