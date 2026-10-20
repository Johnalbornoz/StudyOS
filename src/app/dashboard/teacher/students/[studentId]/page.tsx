import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { listTeacherClassIds } from '@/lib/teacher/class-assignment.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * F13 / Track A -- legacy Teacher student URL. A learner is always seen in
 * the context of a class the Teacher teaches (that class's subject scopes
 * what is shown), so this resolves the class -- the `classId` query when
 * the actor teaches it, otherwise the first taught class where the learner
 * is ACTIVE -- and redirects to the class-scoped learner view. Anything
 * else is the same not-found a real 404 would be.
 */
export default async function TeacherStudentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ studentId: string }>;
  searchParams: Promise<{ classId?: string }>;
}) {
  const { studentId } = await params;
  const { classId } = await searchParams;
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');
  if (!UUID_RE.test(studentId)) notFound();

  const actor = await getOrCreateCanonicalUser(clerkUserId, null);
  const taught = await listTeacherClassIds(actor.id);
  const candidates = classId && taught.includes(classId) ? [classId] : taught;
  const r = candidates.length
    ? await db.query(
        `SELECT class_id FROM class_enrollments WHERE student_id = $1 AND status = 'ACTIVE' AND class_id = ANY($2::uuid[]) ORDER BY created_at LIMIT 1`,
        [studentId, candidates]
      )
    : { rows: [] as any[] };
  if (r.rows.length === 0) notFound();
  redirect(`/dashboard/teacher/classes/${r.rows[0].class_id}/students/${studentId}`);
}
