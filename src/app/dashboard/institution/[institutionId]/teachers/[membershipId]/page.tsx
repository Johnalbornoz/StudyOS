import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/PageHeader';
import { institutionSubNavLabels } from '@/lib/institution/admin-labels';
import { institutionPageContext, opsLabels } from '@/lib/institution/page-context';
import { listTeachers } from '@/lib/institution/institution-operations.service';
import { listInstitutionClassesWithStaff } from '@/services/institution.service';
import { InstitutionSubNav } from '../../InstitutionSubNav';
import { AssignClassForm } from '../../OpsActions';

/** Track A -- Teacher detail: classes and state in THIS institution (another institution's teacher -> 404). */
export default async function TeacherDetailPage({ params }: { params: Promise<{ institutionId: string; membershipId: string }> }) {
  const { institutionId, membershipId } = await params;
  const { t, tr, overview } = await institutionPageContext(institutionId);
  const [teachers, classes] = await Promise.all([listTeachers(institutionId), listInstitutionClassesWithStaff(institutionId)]);
  const teacher = teachers.find((x) => x.membershipId === membershipId);
  if (!teacher) notFound();
  const l = opsLabels(tr);
  const base = `/dashboard/institution/${institutionId}`;
  const assigned = new Set(teacher.classes.map((c) => c.classId));
  return (
    <div className="ta-stack">
      <div>
        <PageHeader title={teacher.name ?? teacher.email ?? l['iops.detail.teacher']} subtitle={[overview.institutionName, teacher.email].filter(Boolean).join(' · ')} breadcrumb={<Link href={`${base}/teachers`}>{t['institution.teachers.title']}</Link>} />
        <InstitutionSubNav institutionId={institutionId} active="teachers" labels={institutionSubNavLabels(t)} />
      </div>
      <section className="card ta-card">
        <h2>{l['iops.detail.status']}</h2>
        <p><span className="chip">{l[`iops.teachers.status.${teacher.status}`]}</span></p>
      </section>
      <section className="card ta-card">
        <h2>{l['iops.teachers.classes']}</h2>
        {teacher.classes.length === 0 ? <p className="ta-msg">{l['iops.teachers.noClasses']}</p> : <ul className="role-list">{teacher.classes.map((c) => <li key={c.assignmentId}>{c.classId ? <Link href={`${base}/classes/${c.classId}`}>{c.className}</Link> : c.gradeName}</li>)}</ul>}
        {teacher.status === 'APPROVED' && <AssignClassForm institutionId={institutionId} membershipId={membershipId} classes={classes.filter((c) => c.status === 'ACTIVE' && !assigned.has(c.id)).map((c) => ({ id: c.id, label: [c.name, c.gradeName].filter(Boolean).join(' · ') }))} l={l} />}
      </section>
    </div>
  );
}
