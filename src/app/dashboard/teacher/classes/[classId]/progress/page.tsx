import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages, type MessageKey } from '@/lib/i18n/messages';
import { fillMessage } from '@/lib/i18n/roles-messages';
import { getTeacherClass } from '@/lib/teacher/class-assignment.service';
import { getClassProgress, parseProgressFilters, type ClassProgressView } from '@/lib/teacher/class-progress.service';
import { PHASES, BUCKETS, RULES, type Quadrant } from '@/lib/teacher/class-progress.compute';
import { EmptyState } from '@/components/ui/EmptyState';
import { InlineAlert } from '@/components/ui/InlineAlert';
import { ClassChrome } from '../class-chrome';
import { ProgressFilters, ReinforceButton } from './ProgressClient';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QUADRANTS: Quadrant[] = ['ADVANCED_SOLID', 'CONSOLIDATING', 'ADVANCING_WITH_GAPS', 'NEEDS_SUPPORT'];
const SORTS = ['name', 'progress', 'gaps', 'retention', 'last'] as const;
const SHOWS = ['all', 'gaps', 'retention', 'inactive'] as const;
type T = ReturnType<typeof getMessages>;

/**
 * Track A -- Teacher › class › Progreso: Class Progress Intelligence.
 * Read-only aggregation of governed facts (canonical decision, evidence,
 * memory, exam gaps, assignments, plan dates) for the class's Teacher only.
 * One filter set (URL) feeds every component. Mobile order: summary →
 * recommendations → students → visual analytics (the concept × phase
 * matrix is desktop-only).
 */
export default async function TeacherClassProgressPage({ params, searchParams }: { params: Promise<{ classId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { classId } = await params;
  const sp = await searchParams;
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');
  if (!UUID_RE.test(classId)) notFound();
  const actor = await getOrCreateCanonicalUser(clerkUserId, null);
  const klass = await getTeacherClass(actor.id, classId);
  if (!klass) notFound();
  const locale = await getUserInterfaceLanguage(actor.id).catch(() => 'es' as const);
  const t = getMessages(locale);
  if (!klass.subjectId) {
    return (
      <div className="ta-stack">
        <ClassChrome klass={klass} active="progress" t={t} />
        <InlineAlert tone="info" title={t['tc.noSubject.title']} body={t['tcp.plan.noSubject']} />
      </div>
    );
  }
  const view = await getClassProgress(actor.id, classId, parseProgressFilters(sp), locale);
  const one = (k: string) => (Array.isArray(sp[k]) ? (sp[k] as string[])[0] : (sp[k] as string | undefined));
  const sort = (SORTS as readonly string[]).includes(one('sort') ?? '') ? (one('sort') as (typeof SORTS)[number]) : 'name';
  const show = (SHOWS as readonly string[]).includes(one('show') ?? '') ? (one('show') as (typeof SHOWS)[number]) : 'all';
  const tt = (k: string) => t[k as MessageKey] ?? k;
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(locale) : '—');
  const label = new Map(view.options.concepts.map((c) => [c.id, c.label]));
  const studentHref = (id: string) => `/dashboard/teacher/classes/${classId}/students/${id}`;
  const baseQs = Object.fromEntries(Object.entries(sp).flatMap(([k, v]) => (v === undefined || k === 'sort' || k === 'show' ? [] : [[k, Array.isArray(v) ? v.join(',') : v]])));
  const tableHref = (next: Record<string, string>) => `?${new URLSearchParams({ ...baseQs, sort, show, ...next })}#students`;
  const reinforceLabels = (n: number) => ({ action: t['cpi.action.reinforce'], busy: t['cpi.action.assigning'], done: fillMessage(t['cpi.action.assigned'], { n }), error: t['inst.common.error'] });
  const names = (refs: Array<{ name: string }>) => refs.map((r) => r.name).join(', ');

  if (view.options.concepts.length === 0) {
    return (
      <div className="ta-stack">
        <ClassChrome klass={klass} active="progress" t={t} />
        <EmptyState
          title={t['cpi.noConcepts']}
          action={
            <Link href={`/dashboard/teacher/classes/${classId}/plan`} className="btn btn-primary">
              {t['cpi.goPlan']}
            </Link>
          }
        />
      </div>
    );
  }

  const s = view.summary;
  const students = view.students
    .filter((r) => (show === 'gaps' ? r.activeGaps > 0 : show === 'retention' ? r.retentionDue > 0 : show === 'inactive' ? !r.lastActivity : true))
    .sort((a, b) =>
      sort === 'progress'
        ? b.progress - a.progress
        : sort === 'gaps'
          ? b.activeGaps - a.activeGaps
          : sort === 'retention'
            ? b.retentionDue - a.retentionDue
            : sort === 'last'
              ? (b.lastActivity ?? '').localeCompare(a.lastActivity ?? '')
              : a.name.localeCompare(b.name)
    );
  const studentState = (phases: Record<string, number>) =>
    BUCKETS.filter((b) => phases[b] > 0)
      .map((b) => `${phases[b]} ${t[`cpi.phase.${b}` as MessageKey]}`)
      .join(' · ');
  const nextText = (n: (typeof view.students)[number]['nextAction']) => fillMessage(t[`cpi.next.${n.kind}` as MessageKey], { concept: n.conceptId ? label.get(n.conceptId) ?? '' : '', date: fmt(n.until ?? null) });

  const Drill = ({ refs }: { refs: Array<{ studentId: string; name: string }> }) =>
    refs.length === 0 ? null : (
      <details>
        <summary>{t['cpi.view']}</summary>
        <ul className="role-list ta-compact">
          {refs.map((r) => (
            <li key={r.studentId}>
              <Link href={studentHref(r.studentId)}>{r.name}</Link>
            </li>
          ))}
        </ul>
      </details>
    );
  const Metric = ({ id, title, value, refs, extra }: { id: string; title: string; value: string; refs?: Array<{ studentId: string; name: string }>; extra?: React.ReactNode }) => (
    <div className="card ta-metric" data-metric={id}>
      <span className="ta-metric-label">{title}</span>
      <span className="ta-metric-value">{value}</span>
      {refs && <Drill refs={refs} />}
      {extra}
    </div>
  );

  // Concept × phase matrix from the same filtered phase data (no extra reads).
  const matrix = view.concepts.map((c) => ({ concept: c, cells: BUCKETS.map((b) => view.phases.find((p) => p.bucket === b)!.items.filter((x) => x.conceptId === c.id)) }));

  return (
    <div className="ta-stack">
      <ClassChrome klass={klass} active="progress" t={t} />
      <div>
        <h2 style={{ fontSize: 18 }}>{t['cpi.title']}</h2>
        <p className="ta-msg">{t['cpi.subtitle']}</p>
      </div>

      <section className="card ta-card" aria-label={t['cpi.filters']}>
        <ProgressFilters
          current={{ period: view.filters.period, periodLabel: view.filters.periodLabel, topic: view.filters.topic ?? null, concept: view.filters.concept ?? null, assignment: view.filters.assignment ?? null, students: view.filters.students ?? [] }}
          options={view.options}
          labels={{
            filters: t['cpi.filters'],
            period: t['cpi.filter.period'],
            'period.7d': t['cpi.period.7d'],
            'period.30d': t['cpi.period.30d'],
            'period.period': t['cpi.period.period'],
            'period.all': t['cpi.period.all'],
            periodLabel: t['cpi.filter.periodLabel'],
            topic: t['cpi.filter.topic'],
            concept: t['cpi.filter.concept'],
            assignment: t['cpi.filter.assignment'],
            students: t['cpi.filter.students'],
            all: t['cpi.filter.all'],
            apply: t['cpi.filter.apply'],
            clear: t['cpi.filter.clear'],
            selected: t['cpi.selected'],
          }}
        />
        {view.filters.period === 'period' && <p className="ta-msg">{view.filters.periodLabel ? fillMessage(t['cpi.filter.periodNote'], { label: view.filters.periodLabel }) : t['cpi.filter.noPeriods']}</p>}
        <p className="ta-msg">{view.topicSource === 'NONE' ? t['cpi.filter.topicNone'] : tt(`cpi.filter.topicSource.${view.topicSource}`)}</p>
      </section>

      <div className="cpi-layout">
        <section aria-labelledby="cpi-summary" className="cpi-summary ta-stack" style={{ gap: 'var(--space-3)' }}>
          <h3 id="cpi-summary" style={{ fontSize: 16 }}>{t['cpi.summary.title']}</h3>
          <div className="ta-grid">
            <Metric id="students" title={t['cpi.summary.students']} value={String(s.activeStudents.length)} refs={s.activeStudents} />
            <Metric
              id="concepts"
              title={t['cpi.summary.concepts']}
              value={fillMessage(t['cpi.summary.ofTotal'], { done: s.conceptsWorked.length, total: view.concepts.length })}
              extra={
                s.conceptsWorked.length > 0 ? (
                  <details>
                    <summary>{t['cpi.view']}</summary>
                    <ul className="role-list ta-compact">
                      {s.conceptsWorked.map((c) => (
                        <li key={c.conceptId}>{c.label}</li>
                      ))}
                    </ul>
                  </details>
                ) : null
              }
            />
            <Metric
              id="assignments"
              title={t['cpi.summary.assignments']}
              value={s.assignments.total === 0 ? t['cpi.summary.none'] : `${s.assignments.percent} % (${fillMessage(t['cpi.summary.ofTotal'], { done: s.assignments.completed, total: s.assignments.total })})`}
              refs={s.assignments.pending}
            />
            <Metric id="gaps" title={t['cpi.summary.gaps']} value={String(s.studentsWithGaps.length)} refs={s.studentsWithGaps} />
            <Metric id="retention" title={t['cpi.summary.retention']} value={String(s.retentionDue.length)} refs={s.retentionDue} />
            <Metric id="advanced" title={t['cpi.summary.advanced']} value={String(s.advancedBeyondPlan.length)} refs={s.advancedBeyondPlan} />
            <Metric id="exams" title={t['cpi.summary.exams']} value={String(s.recentExamGaps.students.length)} refs={s.recentExamGaps.students} />
          </div>
        </section>

        <section aria-labelledby="cpi-recs" className="cpi-recs card ta-card">
          <h3 id="cpi-recs" style={{ fontSize: 16 }}>{t['cpi.recs.title']}</h3>
          {view.recommendations.length === 0 ? (
            <p className="ta-msg">{t['cpi.recs.empty']}</p>
          ) : (
            <ul className="role-list">
              {view.recommendations.map((r, i) => (
                <li key={i} className="ta-stack" style={{ gap: 'var(--space-1)' }} data-rec={r.kind}>
                  <strong>{fillMessage(t[`cpi.rec.${r.kind}` as MessageKey], { n: r.students.length, concept: r.label ?? '' })}</strong>
                  <span className="ta-msg">
                    {r.kind === 'REINFORCE' ? fillMessage(t['cpi.rec.reason.REINFORCE'], { reasons: r.reasons.map((x) => t[`cpi.gapReason.${x}` as MessageKey]).join(', ') }) : t[`cpi.rec.reason.${r.kind}` as MessageKey]}
                  </span>
                  <span className="ta-msg">{names(r.students)}</span>
                  <span className="ta-actions">
                    {(r.kind === 'REINFORCE' || r.kind === 'TARGET_RISK') && r.conceptId && (
                      <ReinforceButton classId={classId} conceptId={r.conceptId} studentIds={r.students.map((x) => x.studentId)} title={fillMessage(t['cpi.reinforceTitle'], { concept: r.label ?? '' })} labels={reinforceLabels(r.students.length)} />
                    )}
                    {r.kind === 'RETENTION' && (
                      <Link className="btn btn-secondary" href={tableHref({ show: 'retention' })}>
                        {t['cpi.action.viewStudents']}
                      </Link>
                    )}
                    {r.kind === 'ADVANCED' && (
                      <Link className="btn btn-secondary" href={`/dashboard/teacher/classes/${classId}/plan`}>
                        {t['cpi.action.exploreNext']}
                      </Link>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section id="students" aria-labelledby="cpi-table" className="cpi-table card ta-card">
          <h3 id="cpi-table" style={{ fontSize: 16 }}>{t['cpi.table.title']}</h3>
          <nav className="ta-row" aria-label={t['cpi.table.sort']}>
            {SHOWS.map((x) => (
              <Link key={x} href={tableHref({ show: x })} className={show === x ? 'chip chip-good' : 'chip'} aria-current={show === x ? 'true' : undefined}>
                {x === 'all' ? t['cpi.filter.all'] : x === 'gaps' ? t['cpi.table.gaps'] : x === 'retention' ? t['cpi.table.retention'] : t['cpi.table.never']}
              </Link>
            ))}
          </nav>
          {students.length === 0 ? (
            <p className="ta-msg">{t['tcp.students.empty']}</p>
          ) : (
            <div className="cpi-table-scroll">
              <table className="cpi-grid">
                <thead>
                  <tr>
                    {(
                      [
                        ['name', t['cpi.table.student']],
                        ['progress', t['cpi.table.progress']],
                        [null, t['cpi.table.state']],
                        ['gaps', t['cpi.table.gaps']],
                        ['retention', t['cpi.table.retention']],
                        ['last', t['cpi.table.last']],
                        [null, t['cpi.table.next']],
                      ] as Array<[string | null, string]>
                    ).map(([k, text]) => (
                      <th key={text} scope="col" aria-sort={k && k === sort ? (k === 'name' ? 'ascending' : 'descending') : undefined}>
                        {k ? (
                          <Link href={tableHref({ sort: k })}>
                            {text}
                            {k === sort ? ' ▾' : ''}
                          </Link>
                        ) : (
                          text
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {students.map((r) => (
                    <tr key={r.studentId} data-student={r.studentId}>
                      <th scope="row">
                        <Link href={studentHref(r.studentId)}>{r.name}</Link>
                      </th>
                      <td data-label={t['cpi.table.progress']}>{r.progress} %</td>
                      <td data-label={t['cpi.table.state']}>{studentState(r.phases)}</td>
                      <td data-label={t['cpi.table.gaps']}>{r.activeGaps > 0 ? `${r.activeGaps} · ${r.gapConcepts.map((c) => label.get(c)).join(', ')}` : '0'}</td>
                      <td data-label={t['cpi.table.retention']}>{r.retentionDue}</td>
                      <td data-label={t['cpi.table.last']}>{r.lastActivity ? fmt(r.lastActivity) : t['cpi.table.never']}</td>
                      <td data-label={t['cpi.table.next']}>{nextText(r.nextAction)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="cpi-visuals">
          <section aria-labelledby="cpi-trend" className="card ta-card">
            <h3 id="cpi-trend" style={{ fontSize: 16 }}>{t['cpi.trend.title']}</h3>
            <p className="ta-msg">{t['cpi.trend.subtitle']}</p>
            {view.trend.totalEvidence === 0 ? <p className="ta-msg">{t['cpi.notEnough']}</p> : <Trend view={view} t={t} locale={locale} />}
          </section>

          <section aria-labelledby="cpi-pareto" className="card ta-card">
            <h3 id="cpi-pareto" style={{ fontSize: 16 }}>{t['cpi.pareto.title']}</h3>
            <p className="ta-msg">{t['cpi.pareto.subtitle']}</p>
            {view.pareto.length === 0 ? (
              <p className="ta-msg">{t['cpi.pareto.empty']}</p>
            ) : (
              <ol className="cpi-bars">
                {view.pareto.map((row) => (
                  <li key={row.conceptId} data-concept={row.conceptId}>
                    <details>
                      <summary>
                        <span className="cpi-bar-label">{row.label}</span>
                        <span className="cpi-bar-track">
                          <span className="cpi-bar" style={{ width: `${Math.max(4, (row.count / view.pareto[0].count) * 100)}%` }} />
                        </span>
                        <span className="cpi-bar-value">
                          {fillMessage(t['cpi.pareto.students'], { n: row.count })} · {fillMessage(t['cpi.pareto.cumulative'], { p: row.cumulativePercent })}
                        </span>
                      </summary>
                      <ul className="role-list ta-compact">
                        {row.items.map((g) => (
                          <li key={g.studentId}>
                            <Link href={studentHref(g.studentId)}>{g.name}</Link>:{' '}
                            {g.reasons
                              .map((x) =>
                                x.type === 'EXAM_GAP'
                                  ? `${t['cpi.gapReason.EXAM_GAP']} ${x.examName} · ${fillMessage(t['cpi.exams.evidence'], { code: x.objectiveCode ?? '—', pct: Math.round((x.fraction ?? 0) * 100) })} · ${fmt(x.at ?? null)}`
                                  : t[`cpi.gapReason.${x.type}` as MessageKey]
                              )
                              .join(' · ')}
                          </li>
                        ))}
                      </ul>
                      <ReinforceButton classId={classId} conceptId={row.conceptId} studentIds={[...new Set(row.items.map((g) => g.studentId))]} title={fillMessage(t['cpi.reinforceTitle'], { concept: row.label })} labels={reinforceLabels(row.count)} />
                    </details>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section aria-labelledby="cpi-quadrant" className="card ta-card">
            <h3 id="cpi-quadrant" style={{ fontSize: 16 }}>{t['cpi.quadrant.title']}</h3>
            <p className="ta-msg">{t['cpi.quadrant.subtitle']}</p>
            {view.quadrant.every((p) => p.y === null) ? <p className="ta-msg">{t['cpi.notEnough']}</p> : <QuadrantChart view={view} t={t} />}
            {view.quadrant.some((p) => p.y === null) && <p className="ta-msg">{fillMessage(t['cpi.quadrant.noDemos'], { names: names(view.quadrant.filter((p) => p.y === null)) })}</p>}
            <div className="cpi-quadrant-lists">
              {QUADRANTS.map((q) => {
                const members = view.students.filter((r) => r.quadrant === q);
                return (
                  <details key={q} data-quadrant={q}>
                    <summary>
                      {t[`cpi.quadrant.${q}` as MessageKey]} ({members.length})
                    </summary>
                    <ul className="role-list ta-compact">
                      {members.map((r) => (
                        <li key={r.studentId} id={`q-${r.studentId}`} className="ta-stack" style={{ gap: 'var(--space-1)' }}>
                          <strong>{r.name}</strong>
                          <span className="ta-msg">
                            {t['cpi.quadrant.x']}: {r.progress} % · {t['cpi.quadrant.y']}: {r.solidity} % · {studentState(r.phases)}
                          </span>
                          <span className="ta-msg">
                            {t['cpi.table.gaps']}: {r.activeGaps} · {t['cpi.table.retention']}: {r.retentionDue} · {t['cpi.table.last']}: {r.lastActivity ? fmt(r.lastActivity) : t['cpi.table.never']}
                          </span>
                          <span className="ta-actions">
                            <Link className="btn btn-ghost" href={studentHref(r.studentId)}>
                              {t['cpi.action.viewStudent']}
                            </Link>
                            {r.gapConcepts[0] && (
                              <ReinforceButton classId={classId} conceptId={r.gapConcepts[0]} studentIds={[r.studentId]} title={fillMessage(t['cpi.reinforceTitle'], { concept: label.get(r.gapConcepts[0]) ?? '' })} labels={reinforceLabels(1)} />
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                );
              })}
            </div>
          </section>

          <section aria-labelledby="cpi-phases" className="card ta-card">
            <h3 id="cpi-phases" style={{ fontSize: 16 }}>{t['cpi.phases.title']}</h3>
            <p className="ta-msg">{t['cpi.phases.subtitle']}</p>
            {view.phases.every((p) => p.pairs === 0) ? (
              <p className="ta-msg">{t['cpi.notEnough']}</p>
            ) : (
              <ul className="cpi-bars">
                {view.phases.map((p) => (
                  <li key={p.bucket} data-phase={p.bucket}>
                    <details>
                      <summary>
                        <span className="cpi-bar-label">{t[`cpi.phase.${p.bucket}` as MessageKey]}</span>
                        <span className="cpi-bar-track">
                          <span className={`cpi-bar cpi-phase-${p.bucket}`} style={{ width: `${p.pairs ? Math.max(4, (p.pairs / Math.max(1, ...view.phases.map((x) => x.pairs))) * 100) : 0}%` }} />
                        </span>
                        <span className="cpi-bar-value">
                          {p.pairs} · {fillMessage(t['cpi.pareto.students'], { n: p.students })}
                        </span>
                      </summary>
                      <ul className="role-list ta-compact">
                        {p.items.map((x) => (
                          <li key={`${x.studentId}:${x.conceptId}`}>
                            <Link href={studentHref(x.studentId)}>{x.name}</Link> · {x.conceptLabel}
                          </li>
                        ))}
                      </ul>
                    </details>
                  </li>
                ))}
              </ul>
            )}
            {matrix.length > 0 && (
              <div className="cpi-matrix-desktop">
                <h4 style={{ fontSize: 15 }}>{t['tcp.matrix.title']}</h4>
                <div style={{ overflowX: 'auto' }}>
                  <table className="ta-matrix">
                    <thead>
                      <tr>
                        <th scope="col">{t['tcp.matrix.concept']}</th>
                        {BUCKETS.map((b) => (
                          <th key={b} scope="col">
                            {t[`cpi.phase.${b}` as MessageKey]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {matrix.map((row) => (
                        <tr key={row.concept.id}>
                          <th scope="row">{row.concept.label}</th>
                          {row.cells.map((cell, i) => (
                            <td key={BUCKETS[i]} data-bucket={BUCKETS[i]}>
                              {cell.length === 0 ? (
                                <span className="ta-msg">0</span>
                              ) : (
                                <details>
                                  <summary>{cell.length}</summary>
                                  <ul className="role-list ta-compact">
                                    {cell.map((x) => (
                                      <li key={x.studentId}>
                                        <Link href={studentHref(x.studentId)}>{x.name}</Link>
                                      </li>
                                    ))}
                                  </ul>
                                </details>
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          <section aria-labelledby="cpi-timeline" className="card ta-card">
            <h3 id="cpi-timeline" style={{ fontSize: 16 }}>{t['cpi.timeline.title']}</h3>
            {view.timeline.length === 0 ? (
              <p className="ta-msg">{t['cpi.timeline.empty']}</p>
            ) : (
              <ul className="role-list">
                {view.timeline.map((e, i) => (
                  <li key={i} className="ta-coordinator" data-event={e.type}>
                    <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <strong>
                        {fmt(`${e.date}T12:00:00Z`)} · {t[`cpi.timeline.${e.type}` as MessageKey]}
                      </strong>
                      <span className="ta-msg">
                        {e.title} · {fillMessage(t['cpi.pareto.students'], { n: e.students.length })}
                        {e.institutional ? <span className="chip chip-warn" data-institutional> {t['cur2.progress.institutional']}</span> : null}
                      </span>
                    </span>
                    {e.atRisk.length > 0 && (
                      <details>
                        <summary className="chip chip-warn">{fillMessage(t['cpi.timeline.risk'], { n: e.atRisk.length })}</summary>
                        <span className="ta-msg">{names(e.atRisk)}</span>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="ta-msg">{t['cpi.timeline.riskRule']}</p>
          </section>

          <section aria-labelledby="cpi-exams" className="card ta-card">
            <h3 id="cpi-exams" style={{ fontSize: 16 }}>{t['cpi.exams.title']}</h3>
            {view.exams.length === 0 ? (
              <p className="ta-msg">{t['cpi.exams.empty']}</p>
            ) : (
              <ul className="role-list">
                {view.exams.map((g) => (
                  <li key={`${g.examName}:${g.conceptId}`} className="ta-stack" style={{ gap: 'var(--space-1)' }}>
                    <strong>
                      {g.examName} · {g.label}
                    </strong>
                    <span className="ta-msg">
                      {fillMessage(t['cpi.pareto.students'], { n: g.items.length })} · {fmt(g.latest)}
                    </span>
                    <span className="ta-msg">{g.items.map((x) => `${x.name} (${fillMessage(t['cpi.exams.evidence'], { code: x.objectiveCode ?? '—', pct: Math.round(x.fraction * 100) })})`).join(', ')}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Trend({ view, t, locale }: { view: ClassProgressView; t: T; locale: string }) {
  const weeks = view.trend.weeks;
  const max = Math.max(1, ...weeks.map((w) => PHASES.reduce((sum, p) => sum + w.phases[p].evidence, 0)));
  const W = 640;
  const H = 200;
  const bw = W / Math.max(1, weeks.length);
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H + 20}`} className="cpi-svg" role="img" aria-label={t['cpi.trend.title']}>
        {weeks.map((w, i) => {
          let y = H;
          return (
            <g key={w.week}>
              {PHASES.map((p) => {
                const h = (w.phases[p].evidence / max) * (H - 10);
                y -= h;
                return h > 0 ? (
                  <rect key={p} x={i * bw + 2} y={y} width={Math.max(2, bw - 4)} height={h} className={`cpi-phase-${p}`}>
                    <title>{`${fillMessage(t['cpi.trend.week'], { date: new Date(w.week).toLocaleDateString(locale) })} · ${t[`cpi.phase.${p}` as MessageKey]}: ${fillMessage(t['cpi.trend.evidence'], { n: w.phases[p].evidence })}, ${fillMessage(t['cpi.trend.students'], { n: w.phases[p].students })}`}</title>
                  </rect>
                ) : null;
              })}
              {(weeks.length <= 8 || i % Math.ceil(weeks.length / 8) === 0) && (
                <text x={i * bw + bw / 2} y={H + 15} textAnchor="middle" className="cpi-axis">
                  {new Date(w.week).toLocaleDateString(locale, { day: 'numeric', month: 'short' })}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <p className="cpi-legend">
        {PHASES.map((p) => (
          <span key={p}>
            <i className={`cpi-dot cpi-phase-${p}`} aria-hidden /> {t[`cpi.phase.${p}` as MessageKey]}
          </span>
        ))}
      </p>
    </>
  );
}

function QuadrantChart({ view, t }: { view: ClassProgressView; t: T }) {
  const S = 300;
  const pts = view.quadrant.filter((p) => p.y !== null);
  const th = RULES.quadrantThreshold;
  return (
    <svg viewBox={`-30 -10 ${S + 40} ${S + 40}`} className="cpi-svg cpi-quadrant" role="img" aria-label={t['cpi.quadrant.title']}>
      <rect x={0} y={0} width={S} height={S} className="cpi-plot" />
      <line x1={(th / 100) * S} y1={0} x2={(th / 100) * S} y2={S} className="cpi-axisline" />
      <line x1={0} y1={S - (th / 100) * S} x2={S} y2={S - (th / 100) * S} className="cpi-axisline" />
      <text x={S * 0.75} y={14} textAnchor="middle" className="cpi-axis">{t['cpi.quadrant.ADVANCED_SOLID']}</text>
      <text x={S * 0.25} y={14} textAnchor="middle" className="cpi-axis">{t['cpi.quadrant.CONSOLIDATING']}</text>
      <text x={S * 0.75} y={S - 6} textAnchor="middle" className="cpi-axis">{t['cpi.quadrant.ADVANCING_WITH_GAPS']}</text>
      <text x={S * 0.25} y={S - 6} textAnchor="middle" className="cpi-axis">{t['cpi.quadrant.NEEDS_SUPPORT']}</text>
      <text x={S / 2} y={S + 24} textAnchor="middle" className="cpi-axis">{t['cpi.quadrant.x']} →</text>
      <text x={-18} y={S / 2} textAnchor="middle" className="cpi-axis" transform={`rotate(-90 -18 ${S / 2})`}>
        {t['cpi.quadrant.y']} →
      </text>
      {pts.map((p) => (
        <a key={p.studentId} href={`#q-${p.studentId}`}>
          <circle cx={(p.x / 100) * S} cy={S - ((p.y ?? 0) / 100) * S} r={6} className="cpi-point" data-student={p.studentId}>
            <title>{fillMessage(t['cpi.quadrant.point'], { name: p.name, x: p.x, y: p.y ?? 0 })}</title>
          </circle>
        </a>
      ))}
    </svg>
  );
}
