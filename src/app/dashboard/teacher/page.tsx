import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { getTeacherAssignedClasses } from '@/lib/teacher/read-model.service';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';

/**
 * F13 -- Teacher workspace home (task section 17). Calls F11-A's own
 * `getTeacherAssignedClasses` directly (no HTTP self-call) -- this
 * page owns presentation only; the read model itself independently
 * derives the list from the actor's own resolved identity (never a
 * client-supplied teacher id).
 */
export default async function TeacherHomePage() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');

  const actor = await getOrCreateCanonicalUser(clerkUserId, null);
  const locale = await getInterfaceLanguage(actor.id).catch(() => 'es' as const);
  const t = getMessages(locale);

  const classes = await getTeacherAssignedClasses(actor.id);

  return (
    <div>
      <PageHeader title={t['teacher.classes.title']} subtitle={t['teacher.classes.subtitle']} />
      {classes.length === 0 ? (
        <EmptyState title={t['teacher.classes.empty']} />
      ) : (
        <ul className="list-card card">
          {classes.map((c) => (
            <li key={c.classId} className="list-row">
              <div className="row-main">
                <Link href={`/dashboard/teacher/classes/${c.classId}`} className="row-title">
                  {c.name}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
