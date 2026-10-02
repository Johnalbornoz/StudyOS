import Link from 'next/link';
import type { getMessages } from '@/lib/i18n/messages';
import type { TeacherClassContext } from '@/lib/teacher/class-assignment.service';
import { PageHeader } from '@/components/ui/PageHeader';
import { TeacherClassSubNav, type TeacherClassTab } from './TeacherClassSubNav';

/** Track A -- the shared header + tabs of every class page of the Teacher. */
export function ClassChrome({ klass, active, t }: { klass: TeacherClassContext; active: TeacherClassTab; t: ReturnType<typeof getMessages> }) {
  return (
    <>
      <PageHeader
        title={klass.subjectName ? `${klass.name} · ${klass.subjectName}` : klass.name}
        subtitle={[klass.institutionName, klass.gradeName].filter(Boolean).join(' · ')}
        breadcrumb={<Link href="/dashboard/teacher">{t['nav.teacherClasses']}</Link>}
      />
      <TeacherClassSubNav
        classId={klass.id}
        active={active}
        labels={{ overview: t['tcp.nav.overview'], plan: t['tcp.nav.plan'], students: t['tcp.nav.students'], assignments: t['tcp.nav.assignments'], progress: t['tcp.nav.progress'] }}
      />
    </>
  );
}
