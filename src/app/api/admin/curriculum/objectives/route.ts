/**
 * F6 -- GET /api/admin/curriculum/objectives?structureNodeId=
 *
 * Minimal admin surface (task 41): inspect the objective(s) on one
 * structure node, including their PUBLISHED concept/skill/competency
 * mappings.
 */
import { auth, currentUser } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { isAdminEmail } from '@/services/admin.service';
import { listObjectivesForNode } from '@/lib/curriculum/objective.service';
import { listMappingsForObjective } from '@/lib/curriculum/mapping.service';

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? null;
  if (!isAdminEmail(email)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const structureNodeId = new URL(request.url).searchParams.get('structureNodeId');
  if (!structureNodeId) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });

  const objectives = await listObjectivesForNode(structureNodeId);
  const withMappings = await Promise.all(
    objectives.map(async (objective) => ({
      objective,
      conceptMappings: await listMappingsForObjective('CONCEPT', objective.id),
      skillMappings: await listMappingsForObjective('SKILL', objective.id),
      competencyMappings: await listMappingsForObjective('COMPETENCY', objective.id),
    }))
  );

  return NextResponse.json({ success: true, data: { objectives: withMappings } });
}
