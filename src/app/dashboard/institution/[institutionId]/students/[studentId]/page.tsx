import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/PageHeader';
import { institutionSubNavLabels } from '@/lib/institution/admin-labels';
import { institutionPageContext, opsLabels } from '@/lib/institution/page-context';
import { getInstitutionStudentDetail, InstitutionOpsError } from '@/lib/institution/institution-operations.service';
import { listInstitutionClassesWithStaff } from '@/services/institution.service';
import { fillMessage } from '@/lib/i18n/roles-messages';
import { InstitutionSubNav } from '../../InstitutionSubNav';
import { StudentClassAction, RowMenu } from '../../OpsActions';

/** Track A -- Student detail (institution scope): classes (enroll / move / remove), academic profile, permitted summary. */
export default async function StudentDetailPage({ params }: { params: Promise<{ institutionId: string; studentId: string }> }) {
  const { institutionId, studentId } = await params;
  const { t, tr, overview } = await institutionPageContext(institutionId);
  let detail;
  try {
    detail = await getInstitutionStudentDetail(institutionId, studentId);
  } catch (error) {
    if (error instanceof InstitutionOpsError) notFound();
    throw error;
  }
  const classes = await listInstitutionClassesWithStaff(institutionId);
  const l = opsLabels(tr);
  const base = `/dashboard/institution/${institutionId}`;
  const activeEnrollments = detail.enrollments.filter((e) => e.status === 'ACTIVE');
  const enrolledIds = new Set(detail.enrollments.map((e) => e.classId));
  const others = classes.filter((c) => c.status === 'ACTIVE' && !enrolledIds.has(c.id)).map((c) => ({ id: c.id, label: [c.name, c.gradeName].filter(Boolean).join(' · ') }));
  return (
    <div className="ta-stack">
      <div>
        <PageHeader title={detail.name ?? detail.email ?? l['iops.detail.student']} subtitle={[overview.institutionName, detail.email].filter(Boolean).join(' · ')} breadcrumb={<Link href={`${base}/students`}>{l['iops.students.title']}</Link>} />
        <InstitutionSubNav institutionId={institutionId} active="students" labels={institutionSubNavLabels(t)} />
      </div>
      <section className="card ta-card" id="student-classes">
        <h2>{l['iops.student.classes']}</h2>
        <ul className="role-list">
          {detail.enrollments.map((e) => (
            <li key={e.enrollmentId} className="ta-entity-row">
              <span>
                <Link href={`${base}/classes/${e.classId}`}>{e.className}</Link>
                {e.gradeName ? ` · ${e.gradeName}` : ''} · <span className={e.status === 'ACTIVE' ? 'chip chip-good' : 'chip chip-warn'}>{l[`iops.students.status.${e.status}`]}</span>
              </span>
              <RowMenu label={e.className} l={l} items={[{ label: l['iops.students.remove'], danger: true, action: { url: `/api/institutions/${institutionId}/classes/${e.classId}/enrollments/${e.enrollmentId}/end`, confirm: l['iops.students.historyNote'] } }]} />
            </li>
          ))}
        </ul>
        {activeEnrollments.length > 0 && (
          <>
            <StudentClassAction institutionId={institutionId} studentId={studentId} mode="enroll" fromOptions={[]} toOptions={others} l={l} />
            <StudentClassAction institutionId={institutionId} studentId={studentId} mode="move" fromOptions={activeEnrollments.map((e) => ({ id: e.classId, label: e.className }))} toOptions={others} l={l} />
          </>
        )}
        <p className="ta-msg">{l['iops.students.historyNote']}</p>
      </section>
      <section className="card ta-card">
        <h2>{l['iops.student.profile']}</h2>
        {detail.profile ? <p className="ta-msg">{[detail.profile.country, detail.profile.schoolYear, detail.profile.curriculumType, detail.profile.academicYear].filter(Boolean).join(' · ')}</p> : <p className="ta-msg">{l['iops.detail.none']}</p>}
      </section>
      <section className="card ta-card">
        <h2>{l['iops.student.progress']}</h2>
        <p>{fillMessage(l['iops.student.concepts'], { n: detail.institutionConcepts })}</p>
        <p className="ta-msg">{l['iops.student.progressNote']}</p>
      </section>
    </div>
  );
}
