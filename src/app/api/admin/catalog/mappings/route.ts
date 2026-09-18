/**
 * F4 -- GET /api/admin/catalog/mappings?status=AMBIGUOUS|UNRESOLVED|PROPOSED
 *
 * Minimal admin surface (task 19): inspect mapping candidates awaiting
 * review. Never returns MATCHED rows here -- those need no review action;
 * use the canonical-concepts endpoint to see confirmed mappings.
 */
import { auth, currentUser } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { isAdminEmail } from '@/services/admin.service';
import { getCandidatesForMapping, listMappingsByStatus } from '@/lib/catalog/mapping.service';

const VALID_STATUSES = ['AMBIGUOUS', 'UNRESOLVED', 'PROPOSED'] as const;

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? null;
  if (!isAdminEmail(email)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const status = new URL(request.url).searchParams.get('status');
  if (!status || !(VALID_STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: 'status must be one of AMBIGUOUS, UNRESOLVED, PROPOSED' }, { status: 400 });
  }

  const mappings = await listMappingsByStatus(status as (typeof VALID_STATUSES)[number]);
  const withCandidates = await Promise.all(
    mappings.map(async (mapping) => ({ mapping, candidates: await getCandidatesForMapping(mapping.id) }))
  );

  return NextResponse.json({ success: true, data: { mappings: withCandidates } });
}
