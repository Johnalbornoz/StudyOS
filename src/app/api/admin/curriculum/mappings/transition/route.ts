/**
 * F6 -- POST /api/admin/curriculum/mappings/transition
 *
 * Minimal admin surface (task 41): review/publish mapping. One route for
 * every workflow transition -- each delegates to the real
 * segregation-of-duties/grant checks in mapping.service.ts
 * (SelfApprovalError -> 403, EditorialPermissionError -> 403,
 * InvalidMappingTransitionError -> 409). isAdminEmail is only the outer
 * admin-surface gate.
 */
import { auth, currentUser } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isAdminEmail } from '@/services/admin.service';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import {
  approveMapping,
  beginReview,
  EditorialPermissionError,
  InvalidMappingTransitionError,
  proposeMapping,
  publishMapping,
  rejectMapping,
  retireMapping,
  SelfApprovalError,
} from '@/lib/curriculum/mapping.service';

const Schema = z.object({
  kind: z.enum(['CONCEPT', 'SKILL', 'COMPETENCY']),
  mappingId: z.string().uuid(),
  action: z.enum(['PROPOSE', 'BEGIN_REVIEW', 'APPROVE', 'REJECT', 'PUBLISH', 'RETIRE']),
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
  const { kind, mappingId } = validated;

  try {
    let mapping;
    switch (validated.action) {
      case 'PROPOSE':
        mapping = await proposeMapping(kind, actor.id, mappingId);
        break;
      case 'BEGIN_REVIEW':
        mapping = await beginReview(kind, actor.id, mappingId);
        break;
      case 'APPROVE':
        mapping = await approveMapping(kind, actor.id, mappingId);
        break;
      case 'REJECT':
        mapping = await rejectMapping(kind, actor.id, mappingId);
        break;
      case 'PUBLISH':
        mapping = await publishMapping(kind, actor.id, mappingId);
        break;
      case 'RETIRE':
        mapping = await retireMapping(kind, actor.id, mappingId);
        break;
    }
    return NextResponse.json({ success: true, data: { mapping } });
  } catch (err) {
    if (err instanceof SelfApprovalError) return NextResponse.json({ error: 'FORBIDDEN', message: err.message }, { status: 403 });
    if (err instanceof EditorialPermissionError) return NextResponse.json({ error: 'FORBIDDEN', message: err.message }, { status: 403 });
    if (err instanceof InvalidMappingTransitionError) return NextResponse.json({ error: 'INVALID_TRANSITION', message: err.message }, { status: 409 });
    throw err;
  }
}
