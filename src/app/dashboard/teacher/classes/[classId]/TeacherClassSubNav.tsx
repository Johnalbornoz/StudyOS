import Link from 'next/link';

/**
 * Track A -- class sub-navigation for its Teacher: Resumen | Plan de
 * aprendizaje | Estudiantes | Tareas | Progreso | Exámenes (L8 TE-2). In-page links (the global
 * shell keeps owning "Mis clases"); wraps at phone widths (.ta-subnav).
 */
export type TeacherClassTab = 'overview' | 'plan' | 'students' | 'assignments' | 'progress' | 'exams';

export function TeacherClassSubNav({ classId, active, labels }: { classId: string; active: TeacherClassTab; labels: Record<TeacherClassTab, string> }) {
  const base = `/dashboard/teacher/classes/${classId}`;
  const items: Array<{ key: TeacherClassTab; href: string }> = [
    { key: 'overview', href: base },
    { key: 'plan', href: `${base}/plan` },
    { key: 'students', href: `${base}/students` },
    { key: 'assignments', href: `${base}/assignments` },
    { key: 'progress', href: `${base}/progress` },
    { key: 'exams', href: `${base}/exam-insights` },
  ];
  return (
    <nav aria-label={labels.overview} className="ta-subnav">
      {items.map((item) => (
        <Link key={item.key} href={item.href} aria-current={item.key === active ? 'page' : undefined}>
          {labels[item.key]}
        </Link>
      ))}
    </nav>
  );
}
