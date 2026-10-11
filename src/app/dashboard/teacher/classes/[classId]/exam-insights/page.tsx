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
import { ClassChrome } from '../class-chrome';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FAMILY_RE = /^[A-Z]{2,12}$/;
const TOP = 10;

/**
 * L8 TE-2 -- Teacher › class › Exámenes: which exams the class's Students
 * prepare and where their latest scored attempts show gaps (by area,
 * objective and topic), then per Student. Read-only, for the class's Teacher
 * only: anyone else -- another class's Teacher, an institution admin -- gets
 * the same not-found a real 404 would. Individual answers and scores are
 * never read here.
 */
export default async function TeacherClassExamInsightsPage({ params, searchParams }: { params: Promise<{ classId: string }>; searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const { classId } = await params;
  const sp = await searchParams;
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');
  if (!UUID_RE.test(classId)) notFound();
  const requested = Array.isArray(sp.family) ? sp.family[0] : sp.family;
  const family = requested && FAMILY_RE.test(requested) ? requested : null;

  const actor = await getOrCreateCanonicalUser(clerkUserId, null);
  let insights;
  try {
    // Unfiltered read first: it also tells which exam families the filter can offer.
    insights = await getTeacherClassExamInsights(actor.id, classId);
  } catch (error) {
    if (error instanceof TeacherExamInsightsAccessDeniedError) notFound();
    throw error;
  }
  const families = [...new Set(insights.gaps.byDomain.map((d) => d.family))].sort();
  const active = family && families.includes(family) ? family : null;
  const view = active ? await getTeacherClassExamInsights(actor.id, classId, { family: active }) : insights;

  const locale = await getUserInterfaceLanguage(actor.id).catch(() => 'es' as const);
  const t = getMessages(locale);
  const m = getTeacherL8Messages(locale);
  const { klass, students, gaps, goals } = view;
  const rows = examInsightsByStudent(view);
  const base = `/dashboard/teacher/classes/${classId}`;
  const count = (n: number) => fillMessage(m['l8.exams.learnerCount'], { n });
  const fmt = (day: string) => new Date(`${day}T00:00:00`).toLocaleDateString(locale);
  const hasGaps = gaps.byDomain.length > 0 || gaps.byObjective.length > 0 || gaps.byConcept.length > 0;

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
        <div className="ta-grid">
          {(
            [
              ['learners', m['l8.exams.summary.learners'], students.length],
              ['preparing', m['l8.exams.summary.preparing'], goals.studentsPreparing],
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

      {goals.studentsPreparing === 0 && !hasGaps && !active ? (
        <EmptyState title={m['l8.exams.noData']} body={m['l8.exams.noData.body']} />
      ) : (
        <>
          <section className="card ta-card" aria-labelledby="goals-title">
            <h2 id="goals-title">{m['l8.exams.goals.title']}</h2>
            {goals.byObjective.length === 0 ? (
              <p className="ta-msg">{m['l8.exams.goals.empty']}</p>
            ) : (
              <ul className="role-list ta-compact">
                {goals.byObjective.map((g) => (
                  <li key={g.objectiveKey} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', justifyContent: 'space-between' }}>
                    <span>{g.label}</span>
                    <span className="ta-msg">{count(g.students)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {families.length > 1 && (
            <nav aria-label={m['l8.exams.filter']} className="ta-subnav" style={{ marginBottom: 0 }}>
              <Link href={`${base}/exam-insights`} aria-current={active ? undefined : 'page'}>
                {m['l8.exams.filter.all']}
              </Link>
              {families.map((f) => (
                <Link key={f} href={`${base}/exam-insights?family=${f}`} aria-current={active === f ? 'page' : undefined}>
                  {f}
                </Link>
              ))}
            </nav>
          )}

          {!hasGaps ? (
            <p className="ta-msg">{m['l8.exams.gaps.empty']}</p>
          ) : (
            <>
              <section className="card ta-card" aria-labelledby="domains-title">
                <h2 id="domains-title">{m['l8.exams.domains.title']}</h2>
                <ul className="role-list ta-compact">
                  {gaps.byDomain.slice(0, TOP).map((d, i) => (
                    <li key={i} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', justifyContent: 'space-between' }}>
                      <span>{[d.exam, d.domain].filter(Boolean).join(' · ')}</span>
                      <span className="ta-msg">{count(d.students)}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="card ta-card" aria-labelledby="objectives-title">
                <h2 id="objectives-title">{m['l8.exams.objectives.title']}</h2>
                <ul className="role-list ta-compact">
                  {gaps.byObjective.slice(0, TOP).map((o, i) => (
                    <li key={i} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', justifyContent: 'space-between' }}>
                      <span style={{ flex: '1 1 240px', minWidth: 0, overflowWrap: 'anywhere' }}>
                        {o.code ? <strong>{o.code} </strong> : null}
                        {o.description}
                        <span className="ta-msg"> · {o.exam}</span>
                      </span>
                      <span className="ta-msg">{count(o.students)}</span>
                    </li>
                  ))}
                </ul>
              </section>

              {gaps.byConcept.length > 0 && (
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
              )}
            </>
          )}

          <section aria-labelledby="students-title" className="ta-stack" style={{ gap: 'var(--space-3)' }}>
            <h2 id="students-title" style={{ fontSize: 18 }}>{m['l8.exams.students.title']}</h2>
            <ul className="list-card card" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {rows.map((r) => (
                <li key={r.studentId} className="list-row" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
                  <div className="row-main" style={{ flexBasis: 240 }}>
                    <Link href={`${base}/students/${r.studentId}`} className="row-title">
                      {r.name}
                    </Link>
                    <div className="row-sub">
                      {r.goals.length === 0
                        ? m['l8.exams.students.noGoals']
                        : `${m['l8.exams.students.goals']}: ${r.goals.map((g) => (g.examDate ? `${g.label} (${fillMessage(m['l8.exams.students.examDate'], { date: fmt(g.examDate) })})` : g.label)).join(', ')}`}
                    </div>
                    <div className="row-sub">{r.gaps > 0 ? fillMessage(m['l8.exams.students.gaps'], { n: r.gaps }) : m['l8.exams.students.noGaps']}</div>
                    {r.concepts.length > 0 && (
                      <div className="row-sub" style={{ overflowWrap: 'anywhere' }}>
                        {m['l8.exams.students.concepts']}: {r.concepts.map((c) => c.name).join(', ')}
                      </div>
                    )}
                    {r.aice.length > 0 && (
                      <div className="row-sub">
                        {m['l8.exams.students.aice']}: {r.aice.map((a) => [a.syllabusCode, a.level, a.series].filter(Boolean).join(' ')).join(', ')}
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
