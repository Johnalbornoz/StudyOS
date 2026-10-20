import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { fillMessage } from '@/lib/i18n/roles-messages';
import { getInstitutionOverview, InstitutionIntelligenceAccessDeniedError } from '@/lib/institution-intelligence';
import { listInstitutionClassesWithStaff } from '@/services/institution.service';
import { institutionSubNavLabels } from '@/lib/institution/admin-labels';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { InstitutionSubNav } from '../InstitutionSubNav';

/** Track A -- which catalog subjects the institution's classes use (linking happens on each class page). */
export default async function InstitutionSubjectsPage({ params }: { params: Promise<{ institutionId: string }> }) {
  const { institutionId } = await params;
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');
  const actor = await getOrCreateCanonicalUser(clerkUserId, null);
  const locale = await getUserInterfaceLanguage(actor.id).catch(() => 'es' as const);
  const t = getMessages(locale);

  let overview;
  try {
    overview = await getInstitutionOverview(actor.id, institutionId);
  } catch (error) {
    if (error instanceof InstitutionIntelligenceAccessDeniedError) notFound();
    throw error;
  }
  const classes = await listInstitutionClassesWithStaff(institutionId);
  const bySubject = new Map<string, string[]>();
  for (const c of classes) if (c.subjectName) bySubject.set(c.subjectName, [...(bySubject.get(c.subjectName) ?? []), c.name]);
  const unlinked = classes.filter((c) => !c.subjectName).map((c) => c.name);

  return (
    <div className="ta-stack">
      <div>
        <PageHeader title={overview.institutionName} subtitle={t['ia.subjects.subtitle']} />
        <InstitutionSubNav institutionId={institutionId} active="subjects" labels={institutionSubNavLabels(t)} />
      </div>
      {bySubject.size === 0 ? (
        <EmptyState title={t['ia.subjects.empty']} />
      ) : (
        <ul className="list-card card" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {[...bySubject.entries()].map(([subject, names]) => (
            <li key={subject} className="list-row">
              <div className="row-main">
                <div className="row-title">{subject}</div>
                <div className="row-sub">{fillMessage(t['ia.subjects.classes'], { n: names.length, list: names.join(', ') })}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {unlinked.length > 0 && <p className="ta-msg">{fillMessage(t['ia.subjects.unlinked'], { list: unlinked.join(', ') })}</p>}
    </div>
  );
}
