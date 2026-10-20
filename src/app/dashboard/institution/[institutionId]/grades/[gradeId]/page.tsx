import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/PageHeader';
import { institutionSubNavLabels } from '@/lib/institution/admin-labels';
import { institutionPageContext, opsLabels } from '@/lib/institution/page-context';
import { listGrades, listProgrammeOptions, listInstitutionStudents } from '@/lib/institution/institution-operations.service';
import { listInstitutionClassesWithStaff } from '@/services/institution.service';
import { listInstitutionCurriculumSubjects } from '@/lib/institution/curriculum-management.service';
import { curriculumContextLabel } from '@/lib/institution/curriculum-identity';
import { InstitutionSubNav } from '../../InstitutionSubNav';
import { GradeForm } from '../../OpsActions';

/** Track A -- Grade detail: its classes, curriculum and students; edit. Another institution's grade -> 404. */
export default async function GradeDetailPage({ params }: { params: Promise<{ institutionId: string; gradeId: string }> }) {
  const { institutionId, gradeId } = await params;
  const { t, tr, overview } = await institutionPageContext(institutionId);
  const [grades, programmes, classes, curricula, students] = await Promise.all([
    listGrades(institutionId, { includeArchived: true }),
    listProgrammeOptions(),
    listInstitutionClassesWithStaff(institutionId),
    listInstitutionCurriculumSubjects(institutionId),
    listInstitutionStudents(institutionId),
  ]);
  const g = grades.find((x) => x.id === gradeId);
  if (!g) notFound();
  const l = opsLabels(tr);
  const base = `/dashboard/institution/${institutionId}`;
  const mine = classes.filter((c) => c.gradeId === gradeId);
  const classIds = new Set(mine.map((c) => c.id));
  const gradeStudents = students.filter((s) => s.enrollments.some((e) => classIds.has(e.classId)));
  const gradeCurricula = curricula.filter((c) => c.gradeId === gradeId || c.gradeId === null);

  return (
    <div className="ta-stack">
      <div>
        <PageHeader title={g.name} subtitle={[overview.institutionName, l['iops.detail.grade'], l[`iops.common.status.${g.status}`]].join(' · ')} breadcrumb={<Link href={`${base}/grades`}>{t['institution.grades.title']}</Link>} />
        <InstitutionSubNav institutionId={institutionId} active="grades" labels={institutionSubNavLabels(t)} />
      </div>
      <section className="card ta-card" aria-labelledby="g-classes">
        <h2 id="g-classes">{t['institution.classes.title']}</h2>
        {mine.length === 0 ? (
          <p className="ta-msg">{l['iops.detail.none']} <Link href={`${base}/classes#class-form`}>{l['iops.quick.class']}</Link></p>
        ) : (
          <ul className="role-list">{mine.map((c) => <li key={c.id}><Link href={`${base}/classes/${c.id}`}>{c.name}</Link> · {l[`iops.common.status.${c.status}`]}</li>)}</ul>
        )}
      </section>
      <section className="card ta-card" aria-labelledby="g-cur">
        <h2 id="g-cur">{tr['cur2.config.title']}</h2>
        {gradeCurricula.length === 0 ? <p className="ta-msg">{l['iops.detail.none']} <Link href={`${base}/curriculum`}>{l['iops.quick.curriculum']}</Link></p> : <ul className="role-list">{gradeCurricula.map((c) => <li key={c.curriculumId}>{curriculumContextLabel(c, tr['cur2.wizard.allGrades'])}</li>)}</ul>}
      </section>
      <section className="card ta-card" aria-labelledby="g-students">
        <h2 id="g-students">{l['iops.students.title']}</h2>
        {gradeStudents.length === 0 ? <p className="ta-msg">{l['iops.detail.none']}</p> : <ul className="role-list">{gradeStudents.map((s) => <li key={s.studentId}><Link href={`${base}/students/${s.studentId}`}>{s.name ?? s.email}</Link></li>)}</ul>}
      </section>
      <section className="card ta-card" id="grade-edit">
        <GradeForm id="grade-edit-form" institutionId={institutionId} programmes={programmes} gradeId={g.id} initial={{ name: g.name, academicLevel: g.academicLevel, programmeLabel: g.programmeLabel, academicProgrammeId: g.academicProgrammeId, academicYear: g.academicYear }} l={l} />
        <p className="ta-msg">{l['iops.grades.archiveHint']} {l['iops.grades.deleteHint']}</p>
      </section>
    </div>
  );
}
