import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { requireStudyUSAdmin } from '@/lib/admin/authorization';
import { listInstitutionsForPlatformAdmin } from '@/services/institution-admin.service';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages, type MessageKey } from '@/lib/i18n/messages';
import { fillMessage } from '@/lib/i18n/roles-messages';
import { institutionProfileLabels } from '@/lib/institution/admin-labels';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { InstitutionProfileForm } from '@/components/institution/InstitutionProfileForm';
import { AdminSubNav } from '../AdminSubNav';

/**
 * Platform Admin -- institutions. Track A: create an institution with its
 * profile, then open it to manage its coordinators. Only a StudyUs admin
 * (canonical role + allowlist) reaches this page or its routes.
 */
export default async function AdminInstitutionsPage() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');

  const admin = await requireStudyUSAdmin(clerkUserId);
  if (!admin) redirect('/dashboard');

  const locale = await getUserInterfaceLanguage(admin.actor.id).catch(() => 'es' as const);
  const t = getMessages(locale);
  const institutions = await listInstitutionsForPlatformAdmin();
  const countryName = (code: string | null) => {
    if (!code) return null;
    try {
      return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
    } catch {
      return code;
    }
  };

  return (
    <div className="ta-stack">
      <div>
        <PageHeader title={t['ia.list.title']} subtitle={t['ia.list.subtitle']} />
        <AdminSubNav active="institutions" />
      </div>

      <InstitutionProfileForm
        mode="create"
        endpoint="/api/admin/institutions"
        statusOptions={['ACTIVE', 'DRAFT']}
        onCreatedHref="/dashboard/admin/institutions"
        labels={institutionProfileLabels(t, t['ia.create.title'], t['ia.create.submit'])}
      />

      {institutions.length === 0 ? (
        <EmptyState title={t['ia.list.empty']} />
      ) : (
        <ul className="list-card card" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {institutions.map((inst) => (
            <li key={inst.id} className="list-row" style={{ flexWrap: 'wrap' }}>
              <div className="row-main" style={{ flexBasis: 240 }}>
                <Link href={`/dashboard/admin/institutions/${inst.id}`} className="row-title">
                  {inst.displayName || inst.name}
                </Link>
                <div className="row-sub">{[inst.displayName ? inst.name : null, [inst.region, countryName(inst.country)].filter(Boolean).join(', ') || null].filter(Boolean).join(' · ')}</div>
                <div className="row-sub">
                  {fillMessage(t['ia.list.coordinators'], { n: inst.activeCoordinators })}
                  {inst.pendingInvitations > 0 ? ` · ${fillMessage(t['ia.list.pending'], { n: inst.pendingInvitations })}` : ''}
                </div>
              </div>
              <span className={inst.status === 'ACTIVE' ? 'chip chip-good' : 'chip chip-warn'}>{t[`ia.status.${inst.status}` as MessageKey]}</span>
              <Link href={`/dashboard/admin/institutions/${inst.id}`} className="btn btn-secondary">
                {t['ia.list.open']}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
