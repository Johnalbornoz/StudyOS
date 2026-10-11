import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { fillMessage } from '@/lib/i18n/roles-messages';
import { getTeacherL8Messages } from '@/lib/i18n/teacher-l8-messages';
import { getTeacherClassExamInsights, examInsightsByStudent, TeacherExamInsightsAccessDeniedError } from '@/lib/teacher/exam-insights.service';
import { EmptyState } from '@/components/ui/EmptyState';
import { InlineAlert } from '@/components/ui/InlineAlert';
import { ClassChrome } from '../class-chrome';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOP = 10;

/**
 * L8 TE-2 -- Teacher › class › Exámenes: where the latest scored exam
 * attempts of the class's Students show gaps, by topic and per Student,
 * within the class's own subject. Read-only, for the class's Teacher only:
 * anyone else -- another class's Teacher, an institution admin -- gets the
 * same not-found a real 404 would. Everything comes from the shared Teacher
 * entry point (through the L8 service); what it withholds (area / objective
 * totals, exam goals, AICE plans) is not shown and the page says so.
 * Individual answers and scores are never read here.
 */
export default async function TeacherClassExamInsightsPage({ params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');
  if (!UUID_RE.test(classId)) notFound();

  const actor = await getOrCreateCanonicalUser(clerkUserId, null);
  let view;
  try {
    view = await getTeacherClassExamInsights(actor.id, classId);
  } catch (error) {
    if (error instanceof TeacherExamInsightsAccessDeniedError) notFound();
    throw error;
  }

  const locale = await getUserInterfaceLanguage(actor.id).catch(() => 'es' as const);
  const t = getMessages(locale);
  const m = getTeacherL8Messages(locale);
  const { klass, students, gaps, withheld } = view;
  const rows = examInsightsByStudent(view);
  const base = `/dashboard/teacher/classes/${classId}`;
  const count = (n: number) => fillMessage(m['l8.exams.learnerCount'], { n });

  if (!klass.subjectId) {
    return (
      <div className="ta-stack">
        <ClassChrome klass={klass} active="exams" t={t} locale={locale} />
        <InlineAlert tone="info" title={t['tc.noSubject.title']} body={t['tc.noSubject.body']} />
      </div>
    );
  }
  if (students.length === 0) {
    return (
      <div className="ta-stack">
        <ClassChrome klass={klass} active="exams" t={t} locale={locale} />
        <EmptyState title={m['l8.exams.noLearners']} body={m['l8.exams.noLearners.body']} />
      </div>
    );
  }

  return (
    <div className="ta-stack">
      <ClassChrome klass={klass} active="exams" t={t} locale={locale} />

      <section aria-labelledby="exams-title" className="ta-stack" style={{ gap: 'var(--space-3)' }}>
        <h2 id="exams-title" style={{ fontSize: 18 }}>{m['l8.exams.title']}</h2>
        <p className="ta-msg">{m['l8.exams.scope']}</p>
        {withheld.length > 0 && <p className="ta-msg">{m['l8.exams.withheld']}</p>}
        <div className="ta-grid">
          {(
            [
              ['learners', m['l8.exams.summary.learners'], students.length],
              ['with-gaps', m['l8.exams.summary.withGaps'], gaps.studentsWithResults],
            ] as const
          ).map(([id, label, value]) => (
            <div key={id} className="card ta-metric" data-metric={id}>
              <span className="ta-metric-label">{label}</span>
              <span className="ta-metric-value">{value}</span>
            </div>
          ))}
        </div>
      </section>

      {gaps.byConcept.length === 0 ? (
        <EmptyState title={m['l8.exams.noData']} body={m['l8.exams.noData.body']} />
      ) : (
        <>
          <section className="card ta-card" aria-labelledby="concepts-title">
            <h2 id="concepts-title">{m['l8.exams.concepts.title']}</h2>
            <ul className="role-list ta-compact">
              {gaps.byConcept.slice(0, TOP).map((c) => (
                <li key={c.canonicalConceptId} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', justifyContent: 'space-between' }}>
                  <span>{c.name}</span>
                  <span className="ta-msg">{count(c.students)}</span>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="students-title" className="ta-stack" style={{ gap: 'var(--space-3)' }}>
            <h2 id="students-title" style={{ fontSize: 18 }}>{m['l8.exams.students.title']}</h2>
            <ul className="list-card card" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {rows.map((r) => (
                <li key={r.studentId} className="list-row" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
                  <div className="row-main" style={{ flexBasis: 240 }}>
                    <Link href={`${base}/students/${r.studentId}`} className="row-title">
                      {r.name}
                    </Link>
                    <div className="row-sub">{r.gaps > 0 ? fillMessage(m['l8.exams.students.gaps'], { n: r.gaps }) : m['l8.exams.students.noGaps']}</div>
                    {r.concepts.length > 0 && (
                      <div className="row-sub" style={{ overflowWrap: 'anywhere' }}>
                        {m['l8.exams.students.concepts']}: {r.concepts.map((c) => c.name).join(', ')}
                      </div>
                    )}
                  </div>
                  {r.gaps > 0 && (
                    <Link href={`${base}/students/${r.studentId}#assign`} className="btn btn-secondary">
                      {m['l8.exams.students.assign']}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
