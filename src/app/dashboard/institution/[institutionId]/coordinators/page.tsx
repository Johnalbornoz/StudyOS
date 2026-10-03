import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { getInstitutionOverview, InstitutionIntelligenceAccessDeniedError } from '@/lib/institution-intelligence';
import { listCoordinators } from '@/services/institution-admin.service';
import { coordinatorsLabels, institutionSubNavLabels } from '@/lib/institution/admin-labels';
import { db } from '@/lib/db';
import { PageHeader } from '@/components/ui/PageHeader';
import { CoordinatorsPanel } from '@/components/institution/CoordinatorsPanel';
import { InstitutionSubNav } from '../InstitutionSubNav';

/** Track A -- the institution's coordinators, managed by its own coordinators (gated like every institution page: not-found for anyone else). */
export default async function InstitutionCoordinatorsPage({ params }: { params: Promise<{ institutionId: string }> }) {
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
  const [coordinators, mine] = await Promise.all([
    listCoordinators(institutionId),
    db.query(`SELECT id FROM institution_memberships WHERE institution_id = $1 AND user_id = $2 AND membership_role = 'INSTITUTION_ADMIN'`, [institutionId, actor.id]),
  ]);
  const myMembership = mine.rows[0]?.id;

  return (
    <div className="ta-stack">
      <div>
        <PageHeader title={overview.institutionName} subtitle={t['ia.nav.coordinators']} />
        <InstitutionSubNav institutionId={institutionId} active="coordinators" labels={institutionSubNavLabels(t)} />
      </div>
      <CoordinatorsPanel
        apiBase={`/api/institutions/${institutionId}`}
        coordinators={coordinators.map((c) => ({ ...c, isSelf: c.kind === 'MEMBER' && c.id === myMembership }))}
        locale={locale}
        labels={{ ...coordinatorsLabels(t, t['ia.coord.bodyCoordinator']), reactivate: t['iops.coord.reactivate'] }}
      />
    </div>
  );
}
