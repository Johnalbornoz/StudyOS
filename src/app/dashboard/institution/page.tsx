import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { getAdministeredInstitutions } from '@/services/institution.service';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';

/**
 * F13 -- Institution workspace entry (task section 19). Single-
 * institution admin (the common case) is taken straight to their
 * overview -- multi-institution admin sees a picker. `institutionId`
 * on the next page is always resolved from THIS list (the actor's own
 * real, APPROVED memberships), never accepted as a bare client claim
 * elsewhere in the flow.
 */
export default async function InstitutionHomePage() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');

  const actor = await getOrCreateCanonicalUser(clerkUserId, null);
  const locale = await getInterfaceLanguage(actor.id).catch(() => 'es' as const);
  const t = getMessages(locale);

  const institutions = await getAdministeredInstitutions(actor.id);

  if (institutions.length === 1) {
    redirect(`/dashboard/institution/${institutions[0].id}`);
  }

  return (
    <div>
      <PageHeader title={t['nav.institutionOverview']} />
      {institutions.length === 0 ? (
        <EmptyState title={t['institution.mine.empty']} />
      ) : (
        <ul className="list-card card">
          {institutions.map((inst) => (
            <li key={inst.id} className="list-row">
              <div className="row-main">
                <Link href={`/dashboard/institution/${inst.id}`} className="row-title">
                  {inst.name}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
