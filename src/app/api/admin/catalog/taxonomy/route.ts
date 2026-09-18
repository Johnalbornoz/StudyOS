/**
 * F4 -- GET /api/admin/catalog/taxonomy
 *
 * Minimal admin surface (task 19): inspect the small, reviewed skill/
 * competency/context taxonomy fixtures. Read-only -- editing the taxonomy
 * is a direct database/migration change in this phase, not an API
 * surface (task explicitly scopes F4's admin tooling to inspection +
 * mapping review, not a full editorial CRUD workflow).
 */
import { auth, currentUser } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { isAdminEmail } from '@/services/admin.service';
import { listCompetencies, listContexts, listSkills } from '@/lib/catalog/canonical-catalog.service';

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? null;
  if (!isAdminEmail(email)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const [skills, competencies, contexts] = await Promise.all([listSkills(), listCompetencies(), listContexts()]);
  return NextResponse.json({ success: true, data: { skills, competencies, contexts } });
}
