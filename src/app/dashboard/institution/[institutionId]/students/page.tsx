import Link from 'next/link';
import { PageHeader } from '@/components/ui/PageHeader';
import { institutionSubNavLabels } from '@/lib/institution/admin-labels';
import { institutionPageContext, opsLabels } from '@/lib/institution/page-context';
import { listInstitutionStudents } from '@/lib/institution/institution-operations.service';
import { listInstitutionClassesWithStaff } from '@/services/institution.service';
import { InstitutionSubNav } from '../InstitutionSubNav';
import { AddStudentForm, RowMenu, type MenuItem } from '../OpsActions';

/**
 * Track A -- Students: the institution roster (enrolled or invited in a class of THIS
 * institution), "Añadir estudiante" (institution students enrolled directly, anyone else invited;
 * never a new account), and per row a ⋯ menu (view / enroll in another class / move / remove).
 * Learner history is never touched by any of these actions.
 */
export default async function InstitutionStudentsPage({ params }: { params: Promise<{ institutionId: string }> }) {
  const { institutionId } = await params;
  const { t, tr, overview } = await institutionPageContext(institutionId);
  const [students, classes] = await Promise.all([listInstitutionStudents(institutionId), listInstitutionClassesWithStaff(institutionId)]);
  const l = opsLabels(tr);
  const base = `/dashboard/institution/${institutionId}`;
  const classOptions = classes.filter((c) => c.status === 'ACTIVE').map((c) => ({ id: c.id, label: [c.name, c.gradeName].filter(Boolean).join(' · ') }));

  return (
    <div className="ta-stack">
      <div>
        <PageHeader title={overview.institutionName} subtitle={l['iops.students.title']} />
        <InstitutionSubNav institutionId={institutionId} active="students" labels={institutionSubNavLabels(t)} />
      </div>

      <section className="card ta-card">
        <AddStudentForm institutionId={institutionId} classes={classOptions} l={l} />
      </section>
      <p className="ta-msg">{l['iops.students.historyNote']}</p>

      {students.length === 0 ? (
        <section className="card ta-card" data-empty="students">
          <p>{l['iops.students.empty']}</p>
          {classOptions.length ? (
            <a className="btn btn-primary" href="#add-student-title">
              {l['iops.students.add']}
            </a>
          ) : (
            <Link className="btn btn-primary" href={`${base}/classes#class-form`}>
              {l['iops.classes.emptyCta']}
            </Link>
          )}
        </section>
      ) : (
        <ul className="list-card card" aria-label={l['iops.students.title']}>
          {students.map((s) => {
            const who = s.name && s.email && s.name !== s.email ? `${s.name} · ${s.email}` : s.name ?? s.email ?? s.studentId;
            const items: MenuItem[] = [
              { label: l['iops.common.view'], href: `${base}/students/${s.studentId}` },
              ...(s.status === 'ACTIVE' ? [{ label: l['iops.students.enrollIn'], href: `${base}/students/${s.studentId}#student-classes` }, { label: l['iops.students.move'], href: `${base}/students/${s.studentId}#student-classes` }] : []),
              ...s.enrollments.map((e) => ({ label: `${l['iops.students.remove']}: ${e.className}`, danger: true, action: { url: `/api/institutions/${institutionId}/classes/${e.classId}/enrollments/${e.enrollmentId}/end`, confirm: l['iops.students.historyNote'] } })),
            ];
            return (
              <li key={s.studentId} className="list-row ta-entity-row" data-student={s.studentId}>
                <div className="ta-entity-main">
                  <Link href={`${base}/students/${s.studentId}`} className="row-title" style={{ color: 'inherit', overflowWrap: 'anywhere' }}>
                    {who}
                  </Link>
                  <span className="row-sub">{s.enrollments.map((e) => `${e.className}${e.status === 'PENDING' ? ` (${l['iops.students.status.PENDING']})` : ''}`).join(' · ')}</span>
                </div>
                <div className="ta-entity-actions">
                  <span className={s.status === 'ACTIVE' ? 'chip chip-good' : 'chip chip-warn'}>{l[`iops.students.status.${s.status}`]}</span>
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
