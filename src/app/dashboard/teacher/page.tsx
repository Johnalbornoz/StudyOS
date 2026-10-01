import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { fillMessage } from '@/lib/i18n/roles-messages';
import { listTeacherClasses } from '@/lib/teacher/class-assignment.service';
import { getMyTeacherMemberships, listActiveInstitutions } from '@/services/institution.service';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { InlineAlert } from '@/components/ui/InlineAlert';
import { TeacherMembershipPanel } from './TeacherMembershipPanel';

/**
 * F13 / Track A (A3) -- Teacher workspace home. Everything is derived from
 * the actor's own resolved identity (never a client-supplied teacher id):
 * membership status per institution (PENDING teachers see an explicit
 * pending state and no class data), the classes an approved + assigned
 * teacher actually teaches, and the request form.
 */
export default async function TeacherHomePage() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');

  const actor = await getOrCreateCanonicalUser(clerkUserId, null);
  const locale = await getUserInterfaceLanguage(actor.id).catch(() => 'es' as const);
  const t = getMessages(locale);

  const [classes, memberships, institutions] = await Promise.all([
    listTeacherClasses(actor.id),
    getMyTeacherMemberships(actor.id),
    listActiveInstitutions(),
  ]);
  const pending = memberships.filter((m) => m.status === 'PENDING');
  const approved = memberships.some((m) => m.status === 'APPROVED');

  return (
    <div className="ta-stack">
      <PageHeader title={t['teacherHome.title']} subtitle={t['teacherHome.subtitle']} />

      {pending.length > 0 && classes.length === 0 && (
        <InlineAlert
          tone="info"
          title={t['teacherHome.pending.title']}
          body={fillMessage(t['teacherHome.pending.body'], { institution: pending.map((p) => p.institutionName).join(', ') })}
        />
      )}

      <section aria-labelledby="my-classes" className="ta-stack" style={{ gap: 'var(--space-3)' }}>
        <h2 id="my-classes" style={{ fontSize: 18 }}>{t['teacherHome.classesTitle']}</h2>
        {classes.length === 0 ? (
          // Track A: an APPROVED teacher with no class yet gets a normal,
          // usable workspace and this explicit empty state (never blocked).
          <EmptyState title={t['teacherHome.noClasses']} body={approved ? t['teacherHome.noClassesApproved'] : undefined} />
        ) : (
          <ul className="list-card card" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {classes.map((c) => (
              <li key={c.id} className="list-row" style={{ flexWrap: 'wrap' }}>
                <div className="row-main" style={{ flexBasis: 220 }}>
                  <Link href={`/dashboard/teacher/classes/${c.id}`} className="row-title">
                    {c.subjectName ? `${c.name} · ${c.subjectName}` : c.name}
                  </Link>
                  <div className="row-sub">{[c.institutionName, c.gradeName].filter(Boolean).join(' · ')}</div>
                  <div className="row-sub">
                    {fillMessage(t['teacherHome.studentsCount'], { n: c.activeLearners })}
                    {c.pendingInvitations > 0 ? ` · ${fillMessage(t['tc.pendingInvitations'], { n: c.pendingInvitations })}` : ''}
                  </div>
                </div>
                <Link href={`/dashboard/teacher/classes/${c.id}`} className="btn btn-secondary">
                  {t['tc.openClass']}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <TeacherMembershipPanel
        memberships={memberships.map((m) => ({ id: m.id, institutionId: m.institutionId, institutionName: m.institutionName, status: m.status }))}
        institutions={institutions.map((i) => ({ id: i.id, name: i.name }))}
        labels={{
          title: t['teacherHome.institutionsTitle'],
          requestTitle: t['teacherHome.request.title'],
          requestBody: t['teacherHome.request.body'],
          select: t['teacherHome.request.select'],
          submit: t['teacherHome.request.submit'],
          sent: t['teacherHome.request.sent'],
          again: t['teacherHome.request.again'],
          none: t['teacherHome.request.none'],
          error: t['teacherHome.request.error'],
          status: {
            PENDING: t['teacherHome.membership.PENDING'],
            APPROVED: t['teacherHome.membership.APPROVED'],
            REJECTED: t['teacherHome.membership.REJECTED'],
            REVOKED: t['teacherHome.membership.REVOKED'],
          },
        }}
      />
    </div>
  );
}
