/**
 * F4 -- GET/POST /api/admin/catalog/concepts
 *
 * Minimal admin surface (task 19): inspect canonical concepts within a
 * canonical subject, and create new ones. Same isAdminEmail gate as the
 * rest of /api/admin/*.
 */
import { auth, currentUser } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isAdminEmail } from '@/services/admin.service';
import { createCanonicalConcept, listCanonicalConcepts } from '@/lib/catalog/canonical-catalog.service';

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

  const canonicalSubjectId = new URL(request.url).searchParams.get('canonicalSubjectId');
  if (!canonicalSubjectId) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });

  const concepts = await listCanonicalConcepts(canonicalSubjectId);
  return NextResponse.json({ success: true, data: { concepts } });
}

const CreateSchema = z.object({
  canonicalSubjectId: z.string().uuid(),
  name: z.string().min(1).max(300),
  description: z.string().max(2000).optional(),
  level: z.string().max(50).optional(),
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

  // No name-uniqueness check on purpose: two canonical concepts may
  // legitimately share a name with a different definition/level/scope
  // (INV-F4-04) -- the admin is trusted to have already checked
  // findCanonicalConceptsByExactName if they wanted to avoid a near-dup.
  const concept = await createCanonicalConcept(validated);
  return NextResponse.json({ success: true, data: { concept } });
}
