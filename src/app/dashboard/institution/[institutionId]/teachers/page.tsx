import Link from 'next/link';
import { PageHeader } from '@/components/ui/PageHeader';
import { institutionSubNavLabels } from '@/lib/institution/admin-labels';
import { institutionPageContext, opsLabels } from '@/lib/institution/page-context';
import { listTeachers } from '@/lib/institution/institution-operations.service';
import { listInstitutionClassesWithStaff } from '@/services/institution.service';
import { InstitutionSubNav } from '../InstitutionSubNav';
import { InviteTeacherForm, AssignClassForm, RowMenu, type MenuItem } from '../OpsActions';

const TONE: Record<string, string> = { APPROVED: 'chip chip-good', INVITED: 'chip chip-warn', PENDING: 'chip chip-warn', SUSPENDED: 'chip chip-critical', REJECTED: 'chip', REVOKED: 'chip' };

/**
 * Track A -- Teachers: invite an existing teacher account, approve / reject requests, assign to
 * classes, remove a class assignment, suspend / reactivate the institutional relation, see every
 * state (Invitado / Pendiente / Aprobado / Suspendido / Rechazado / Retirado). ⋯ menu per row.
 */
export default async function InstitutionTeachersPage({ params }: { params: Promise<{ institutionId: string }> }) {
  const { institutionId } = await params;
  const { t, tr, overview } = await institutionPageContext(institutionId);
  const [teachers, classes] = await Promise.all([listTeachers(institutionId), listInstitutionClassesWithStaff(institutionId)]);
  const l = opsLabels(tr);
  const base = `/dashboard/institution/${institutionId}`;
  const api = `/api/institutions/${institutionId}`;
  const activeClasses = classes.filter((c) => c.status === 'ACTIVE');

  return (
    <div className="ta-stack">
      <div>
        <PageHeader title={overview.institutionName} subtitle={t['institution.teachers.title']} />
        <InstitutionSubNav institutionId={institutionId} active="teachers" labels={institutionSubNavLabels(t)} />
      </div>

      <section className="card ta-card">
        <InviteTeacherForm institutionId={institutionId} l={l} />
      </section>

      {teachers.length === 0 ? (
        <section className="card ta-card" data-empty="teachers">
          <p>{l['iops.teachers.empty']}</p>
          <a className="btn btn-primary" href="#invite-teacher-title">
            {l['iops.teachers.invite']}
          </a>
        </section>
      ) : (
        <ul className="list-card card" aria-label={t['institution.teachers.title']}>
          {teachers.map((teacher) => {
            const who = teacher.name && teacher.email ? `${teacher.name} · ${teacher.email}` : teacher.name ?? teacher.email ?? teacher.userId;
            const assigned = new Set(teacher.classes.map((c) => c.classId));
            const items: MenuItem[] = [
              { label: l['iops.common.view'], href: `${base}/teachers/${teacher.membershipId}` },
              ...(teacher.status === 'PENDING'
                ? [
                    { label: l['iops.teachers.approve'], action: { url: `${api}/memberships/${teacher.membershipId}/decide`, body: { decision: 'APPROVED' } } },
                    { label: l['iops.teachers.reject'], danger: true, action: { url: `${api}/memberships/${teacher.membershipId}/decide`, body: { decision: 'REJECTED' }, confirm: l['iops.common.confirm'] } },
                  ]
                : []),
              ...(teacher.status === 'APPROVED'
                ? [
                    { label: l['iops.teachers.suspend'], action: { url: `${api}/teachers/${teacher.membershipId}/suspend`, confirm: l['iops.teachers.suspendHint'] } },
                    { label: tr['institution.teachers.revoke'], danger: true, action: { url: `${api}/memberships/${teacher.membershipId}/revoke`, confirm: `${tr['institution.teachers.revoke']}: ${who}?` } },
                  ]
                : []),
              ...(teacher.status === 'SUSPENDED' ? [{ label: l['iops.teachers.reactivate'], action: { url: `${api}/teachers/${teacher.membershipId}/reactivate` } }] : []),
              ...(['REJECTED', 'REVOKED'].includes(teacher.status) && teacher.email ? [{ label: l['iops.teachers.invite'], action: { url: `${api}/teachers`, body: { email: teacher.email } } }] : []),
            ];
            return (
              <li key={teacher.membershipId} className="list-row ta-entity-row" data-teacher={teacher.membershipId} data-status={teacher.status}>
                <div className="ta-entity-main">
                  <Link href={`${base}/teachers/${teacher.membershipId}`} className="row-title" style={{ color: 'inherit', overflowWrap: 'anywhere' }}>
                    {who}
                  </Link>
                  <span className="row-sub">
                    {l['iops.teachers.classes']}:{' '}
                    {teacher.classes.length ? teacher.classes.map((c) => c.className ?? c.gradeName).join(', ') : l['iops.teachers.noClasses']}
                  </span>
                  {teacher.status === 'APPROVED' && teacher.classes.length > 0 && (
                    <span className="ta-row">
                      {teacher.classes.map((c) => (
                        <RowMenu
                          key={c.assignmentId}
                          label={`${l['iops.teachers.unassign']}: ${c.className ?? c.gradeName ?? ''}`}
                          l={l}
                          items={[{ label: `${l['iops.teachers.unassign']}: ${c.className ?? c.gradeName ?? ''}`, action: { url: `/api/institutions/assignments/${c.assignmentId}/end` } }]}
                        />
                      ))}
                    </span>
                  )}
                  {teacher.status === 'APPROVED' && (
                    <AssignClassForm institutionId={institutionId} membershipId={teacher.membershipId} classes={activeClasses.filter((c) => !assigned.has(c.id)).map((c) => ({ id: c.id, label: [c.name, c.gradeName].filter(Boolean).join(' · ') }))} l={l} />
                  )}
                </div>
                <div className="ta-entity-actions">
                  <span className={TONE[teacher.status] ?? 'chip'}>{l[`iops.teachers.status.${teacher.status}`]}</span>
                  <RowMenu items={items} label={who} l={l} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
