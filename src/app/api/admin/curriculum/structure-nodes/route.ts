/**
 * F6 -- GET /api/admin/curriculum/structure-nodes?structureVersionId=
 *
 * Minimal admin surface (task 41): browse the node tree of one structure
 * version.
 */
import { auth, currentUser } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { isAdminEmail } from '@/services/admin.service';
import { getStructureNodesForVersion } from '@/lib/curriculum/structure.service';

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? null;
  if (!isAdminEmail(email)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const structureVersionId = new URL(request.url).searchParams.get('structureVersionId');
  if (!structureVersionId) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });

  const nodes = await getStructureNodesForVersion(structureVersionId);
  return NextResponse.json({ success: true, data: { nodes } });
}
