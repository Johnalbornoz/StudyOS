/**
 * F6 -- GET /api/admin/curriculum/coverage?structureVersionId=
 *
 * Minimal admin surface (task 41): inspect coverage. Returns mapping
 * coverage and content coverage as two separate result shapes -- never
 * combined with learner mastery (INV-F6-04), and fullyMapped/
 * partiallyMapped always reported separately (AC-F6-08).
 */
import { auth, currentUser } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { isAdminEmail } from '@/services/admin.service';
import { computeContentCoverage, computeMappingCoverage } from '@/lib/curriculum/coverage.service';

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? null;
  if (!isAdminEmail(email)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const structureVersionId = new URL(request.url).searchParams.get('structureVersionId');
  if (!structureVersionId) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });

  const [mapping, content] = await Promise.all([computeMappingCoverage(structureVersionId), computeContentCoverage(structureVersionId)]);
  return NextResponse.json({ success: true, data: { mapping, content } });
}
