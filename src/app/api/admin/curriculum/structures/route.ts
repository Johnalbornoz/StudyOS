/**
 * F6 -- GET /api/admin/curriculum/structures?academicSubjectId=
 *
 * Minimal admin surface (task 41): browse structure versions for a
 * subject. Gated by the same isAdminEmail allowlist as every other
 * /api/admin/* route.
 */
import { auth, currentUser } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { isAdminEmail } from '@/services/admin.service';
import { getPublishedStructureVersion } from '@/lib/curriculum/structure.service';
import { db } from '@/lib/db';

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? null;
  if (!isAdminEmail(email)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const academicSubjectId = new URL(request.url).searchParams.get('academicSubjectId');
  if (!academicSubjectId) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });

  const [all, published] = await Promise.all([
    db.query(
      `SELECT id, academic_subject_id, version_label, effective_from, effective_to, status, source_locator
       FROM structure_versions WHERE academic_subject_id = $1 ORDER BY created_at DESC`,
      [academicSubjectId]
    ),
    getPublishedStructureVersion(academicSubjectId),
  ]);

  return NextResponse.json({ success: true, data: { versions: all.rows, published } });
}
