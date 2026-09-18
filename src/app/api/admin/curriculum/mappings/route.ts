/**
 * F6 -- POST /api/admin/curriculum/mappings
 *
 * Creates a DRAFT mapping (task 41 "propose mapping"). Requires an
 * ACTIVE EDITOR grant -- enforced inside createMapping itself, not
 * re-implemented here. isAdminEmail is only the outer "is this an admin
 * surface caller" gate; the real segregation-of-duties enforcement lives
 * in src/lib/curriculum/mapping.service.ts.
 */
import { auth, currentUser } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isAdminEmail } from '@/services/admin.service';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { createMapping, EditorialPermissionError } from '@/lib/curriculum/mapping.service';

const Schema = z.object({
  kind: z.enum(['CONCEPT', 'SKILL', 'COMPETENCY']),
  learningObjectiveId: z.string().uuid(),
  targetId: z.string().uuid(),
  relationType: z.enum(['FULL', 'PARTIAL', 'PREREQUISITE', 'SUPPORTING']),
  scope: z.string().optional(),
  level: z.string().optional(),
  rationale: z.string().optional(),
  provenance: z.enum(['MANUAL', 'AI_SUGGESTED']).optional(),
  confidence: z.number().min(0).max(1).optional(),
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

  const actor = await getOrCreateCanonicalUser(userId, email);
  try {
    const mapping = await createMapping(validated.kind, actor.id, validated);
    return NextResponse.json({ success: true, data: { mapping } });
  } catch (err) {
    if (err instanceof EditorialPermissionError) return NextResponse.json({ error: 'FORBIDDEN', message: err.message }, { status: 403 });
    throw err;
  }
}
