import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { getTeacherClassRoster, TeacherAccessDeniedError } from '@/lib/teacher/read-model.service';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';

/**
 * F13 -- Teacher class roster (task section 17/29/30). `classId` is a
 * client-controllable URL param -- authorization is re-verified
 * server-side INSIDE `getTeacherClassRoster` (via `requireClassAccess`)
 * on every request; a wrong/foreign class id renders the SAME "not
 * found" outcome a real 404 would (task section 40: never leak the
 * existence of an inaccessible resource by rendering a different,
 * more specific error for "exists but not yours" vs "doesn't exist").
 */
export default async function TeacherClassRosterPage({ params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');

  const actor = await getOrCreateCanonicalUser(clerkUserId, null);
  const locale = await getInterfaceLanguage(actor.id).catch(() => 'es' as const);
  const t = getMessages(locale);

  let roster;
  try {
    roster = await getTeacherClassRoster(actor.id, classId);
  } catch (error) {
    if (error instanceof TeacherAccessDeniedError) notFound();
    throw error;
  }

  return (
    <div>
      <PageHeader
        title={t['teacher.roster.title']}
        breadcrumb={<Link href="/dashboard/teacher">{t['nav.teacherClasses']}</Link>}
      />
      {roster.length === 0 ? (
        <EmptyState title={t['teacher.roster.empty']} />
      ) : (
        <ul className="list-card card">
          {roster.map((s) => (
            <li key={s.studentId} className="list-row">
              <div className="row-main">
                {/* classId is routing context only (task section 30's breadcrumb pattern
                    + the Assign form's own required field) -- it grants nothing; the
                    student detail page and the assign endpoint both independently
                    re-verify this exact (classId, studentId) pairing server-side. */}
                <Link href={`/dashboard/teacher/students/${s.studentId}?classId=${classId}`} className="row-title">
                  {s.name}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
