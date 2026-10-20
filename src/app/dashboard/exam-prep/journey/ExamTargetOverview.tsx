/**
 * J3.5 -- one Exam Target: Resumen / Preparar / Resultados.
 *
 * Truthful only. Everything comes from the Journey resolution and the existing
 * preparation view; nothing is re-derived and nothing is invented:
 *   - no readiness or coverage percentage and no status pills (G6: evidence can still
 *     be contaminated across exams);
 *   - mocks only when the Journey says one can run;
 *   - no prediction section while no prediction model exists;
 *   - Resultados only when completed attempts exist;
 *   - dates always carry their own source (official / reported by you / your goal / month).
 */
import Link from 'next/link';
import type { StudentExamJourneyResolution } from '@/lib/exam-journey/types';
import type { PreparationView } from '@/lib/exam-core/objectives/preparation.service';
import type { PlannedRequirement } from '@/lib/exam-core/objectives/preparation-plan';
import { formatScheduleValue, mocksVisible, presentNextAction, studentBlockerKeys, type ScheduleLine } from '@/lib/exam-journey/ux';
import { AddConceptButton, DiagnosticButton } from '../[examProfileId]/PrepActions';
import { AttemptHistory, type AttemptHistoryRow } from '../[examProfileId]/AttemptHistory';
import { DateStep } from './DateStep';

type L = Record<string, string>;
export type OverviewTab = 'summary' | 'prepare' | 'results';
const fill = (s: string | undefined, vars: Record<string, string | number>) => Object.entries(vars).reduce((acc, [k, v]) => acc.replace(`{${k}}`, String(v)), s ?? '');

export function parseOverviewTab(v: string | undefined, hasResults: boolean): OverviewTab {
  if (v === 'prepare') return 'prepare';
  if (v === 'results' && hasResults) return 'results';
  return 'summary';
}

/** The date lines of a target, each with its source; a month stays a month. */
export function ScheduleSummary({ lines, labels: l, locale }: { lines: ScheduleLine[]; labels: L; locale: string }) {
  if (lines.length === 0) return <p className="ex-status-body" data-schedule="none">{l['jx.date.none']}</p>;
  return (
    <dl className="prep-facts jx-facts" data-schedule="lines">
      {lines.map((x) => (
        <div key={x.key}>
          <dt>{l[x.key]}</dt>
          <dd>{x.value && x.precision ? formatScheduleValue(x.value, x.precision, locale) : <span className="ui-hint">{l['jx.date.sessionNoDates']}</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface ExamTargetOverviewProps {
  profileId: string;
  resolution: StudentExamJourneyResolution;
  view: PreparationView;
  scheduleLines: ScheduleLine[];
  newScheduleFieldsAvailable: boolean;
  tab: OverviewTab;
  /** Completed attempts only. */
  attempts: AttemptHistoryRow[];
  /** "Confirm with {institution}": the destination the Student named (never a verified requirement). */
  destinationInstitution: string | null;
  labels: L;
  locale: string;
}

export function ExamTargetOverview(p: ExamTargetOverviewProps) {
  const { profileId, resolution: r, view, labels: l, locale, tab } = p;
  const c = view.capabilities;
  const base = `/dashboard/exam-prep/${profileId}`;
  const hasResults = p.attempts.length > 0;
  const practiceHref = (nodeKey: string) => `/dashboard/exams?node=${encodeURIComponent(nodeKey)}`;
  const firstMock = c.fullMocks[0] ?? c.reducedMocks[0] ?? null;
  // Adding a concept creates a curriculum subject: only for learners whose academic path is defined (EXAM_SCOPE is not implemented).
  const canAddToPlan = r.learner.state === 'ACADEMIC_PATH_DEFINED';

  const tabs: { key: OverviewTab; href: string }[] = [
    { key: 'summary', href: base },
    { key: 'prepare', href: `${base}?tab=prepare` },
    ...(hasResults ? [{ key: 'results' as const, href: `${base}?tab=results` }] : []),
  ];

  // ---- the ONE next step (Resumen)
  const action = presentNextAction(r.recommendedNextAction.kind);
  const nextCta = (() => {
    if (action.kind === 'TEXT') return <p className="ex-status-body" data-next-action={r.recommendedNextAction.kind}>{l[action.labelKey]}</p>;
    const label = l[action.labelKey];
    const link = (href: string) => <Link className="btn btn-primary prep-cta" href={href} data-next-action={r.recommendedNextAction.kind}>{label}</Link>;
    switch (action.target) {
      case 'RESUME':
        return view.openAttemptId ? link(`/dashboard/exam-prep/attempt/${view.openAttemptId}`) : link(`${base}?tab=prepare`);
      case 'DIAGNOSTIC':
        return c.canRunDiagnostic ? <DiagnosticButton profileId={profileId} language={locale} labels={l} /> : link(`${base}?tab=prepare`);
      case 'PRACTICE':
        return c.practiceModes[0] ? link(practiceHref(c.practiceModes[0].nodeKey)) : link(`${base}?tab=prepare`);
      case 'MOCK':
        return firstMock && r.mockStatus.startable ? link(practiceHref(firstMock.nodeKey)) : link(`${base}?tab=prepare`);
      case 'RESULTS_TAB':
        return hasResults ? link(`${base}?tab=results`) : link(`${base}?tab=prepare`);
      case 'ASSESSES':
        return link(`${base}?tab=prepare#jx-assesses`);
      case 'DATE':
        return <a className="btn btn-primary prep-cta" href="#jx-date" data-next-action={r.recommendedNextAction.kind}>{label}</a>;
      case 'LEARN':
        return link('/dashboard/today');
      case 'PLANNER':
        return link('/dashboard/exams/aice');
      default:
        return link(`${base}?tab=prepare`);
    }
  })();

  const blockers = studentBlockerKeys(r);
  const hasDate = p.scheduleLines.length > 0;

  const summary = (
    <>
      <section className="card prep-section jx-card" aria-labelledby="jx-next-title" data-journey-state={r.state}>
        <p className="ex-goal-kicker">{l[`jx.phase.${r.phase}`]}</p>
        <h2 id="jx-next-title" className="ex-status-title">{l[`jx.state.${r.state}`]}</h2>
        <p className="ui-label">{l['jx.next.title']}</p>
        <div className="xr-next-actions">{nextCta}</div>
        {blockers.length > 0 ? (
          <ul className="jx-notices" data-blockers>
            {blockers.map((k) => <li key={k} className="jx-notice" role="note">{l[k]}</li>)}
          </ul>
        ) : null}
        {p.destinationInstitution ? <p className="jx-notice" role="note" data-requirement="unconfirmed">{fill(l['jx.requirement.unconfirmed'], { institution: p.destinationInstitution })}</p> : null}
      </section>

      <section className="card prep-section jx-card" aria-labelledby="jx-date-title">
        <h2 id="jx-date-title" className="ex-status-title">{l['jx.date.title']}</h2>
        <ScheduleSummary lines={p.scheduleLines} labels={l} locale={locale} />
        <DateStep profileId={profileId} labels={l} newFieldsAvailable={p.newScheduleFieldsAvailable} defaultOpen={!hasDate} />
      </section>
    </>
  );

  // ---- Preparar
  const recs = (view.plan?.recommendations ?? []).filter((x) => x.recommendation.action !== 'DIAGNOSTIC').slice(0, 8);
  const conceptHref = (x: PlannedRequirement) => {
    const cc = x.concepts.find((y) => y.canonicalConceptId === x.recommendation.canonicalConceptId);
    return cc?.learner ? `/dashboard/subjects/${cc.learner.subjectId}/concepts/${cc.learner.studentConceptId}` : null;
  };
  const conceptName = (x: PlannedRequirement) => x.concepts.find((y) => y.canonicalConceptId === x.recommendation.canonicalConceptId)?.name ?? x.description;
  const recAction = (x: PlannedRequirement) => {
    const a = x.recommendation.action;
    if (a === 'CONTINUE_CONCEPT') {
      const href = conceptHref(x);
      return href ? <Link className="btn btn-secondary prep-cta" href={href}>{l['jx.prep.reinforce.continue']}</Link> : null;
    }
    if (a === 'ADD_TO_PLAN' && x.recommendation.canonicalConceptId) {
      if (canAddToPlan) return <AddConceptButton profileId={profileId} learningObjectiveId={x.learningObjectiveId} canonicalConceptId={x.recommendation.canonicalConceptId} language={locale} label={conceptName(x)} labels={l} />;
      return null;
    }
    if (a === 'PRACTICE_AREA' && c.practiceModes[0]) {
      const area = c.practiceModes.find((m) => m.label === x.area) ?? c.practiceModes[0];
      return <Link className="btn btn-secondary prep-cta" href={practiceHref(area.nodeKey)}>{l['prep.action.PRACTICE_AREA']}</Link>;
    }
    return null;
  };
  const needsAddNote = !canAddToPlan && recs.some((x) => x.recommendation.action === 'ADD_TO_PLAN');
  const byArea = new Map<string, string[]>();
  for (const x of view.plan?.requirements ?? []) {
    if (!byArea.has(x.area)) byArea.set(x.area, []);
    byArea.get(x.area)!.push(x.description);
  }
  const showMocks = mocksVisible(r) && (c.reducedMocks.length > 0 || c.fullMocks.length > 0);

  const prepare = (
    <>
      {c.canRunDiagnostic ? (
        <section className="card prep-section jx-card" aria-labelledby="jx-diag-title">
          <h2 id="jx-diag-title" className="ex-status-title">{l['jx.prep.diagnostic.title']}</h2>
          <p className="ex-status-body">{view.diagnostic ? l['jx.prep.diagnostic.done'] : l['jx.prep.diagnostic.body']}</p>
          <div className="xr-next-actions"><DiagnosticButton profileId={profileId} language={locale} labels={l} primary={false} /></div>
        </section>
      ) : null}

      <section className="card prep-section jx-card" aria-labelledby="jx-practice-title">
        <h2 id="jx-practice-title" className="ex-status-title">{l['jx.prep.practice.title']}</h2>
        {c.practiceModes.length > 0 ? (
          <div className="prep-links">
            {c.practiceModes.map((m) => <Link key={m.nodeKey} className="btn btn-secondary prep-cta" href={practiceHref(m.nodeKey)}>{m.label}</Link>)}
          </div>
        ) : (
          <p className="ex-status-body">{l['jx.prep.practice.none']}</p>
        )}
      </section>

      <section className="card prep-section jx-card" aria-labelledby="jx-mocks-title" data-mocks={showMocks ? 'visible' : 'hidden'}>
        <h2 id="jx-mocks-title" className="ex-status-title">{l['jx.prep.mocks.title']}</h2>
        {showMocks ? (
          <>
            {r.mockStatus.status === 'AVAILABLE_NOT_RECOMMENDED' ? <p className="ui-hint">{l['jx.prep.mocks.notRecommended']}</p> : null}
            {!r.mockStatus.startable ? <p className="ui-hint" role="note">{l['jx.prep.mocks.busy']}</p> : null}
            <ul className="prep-activities">
              {[...c.fullMocks.map((m) => ({ m, full: true })), ...c.reducedMocks.map((m) => ({ m, full: false }))].map(({ m, full }) => (
                <li key={m.nodeKey}>
                  <strong>{full ? l['jx.prep.mocks.full'] : l['jx.prep.mocks.reducedNoLength']}{m.purpose === 'FULL_TEST' ? '' : ` · ${m.label}`}</strong>
                  {r.mockStatus.startable ? <Link className="btn btn-secondary prep-cta" href={practiceHref(m.nodeKey)}>{l['jx.prep.mocks.start']}</Link> : null}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="ex-status-body">{l['jx.prep.mocks.unavailable']}</p>
        )}
      </section>

      <section className="card prep-section jx-card" aria-labelledby="jx-reinforce-title">
        <h2 id="jx-reinforce-title" className="ex-status-title">{l['jx.prep.reinforce.title']}</h2>
        {recs.length === 0 ? (
          <p className="ex-status-body">{l['jx.prep.reinforce.empty']}</p>
        ) : (
          <>
            <ol className="prep-recs">
              {recs.map((x) => {
                const act = recAction(x);
                return (
                  <li key={x.learningObjectiveId} className="prep-rec">
                    <span className="prep-rec-name">{x.description}</span>
                    <p className="ui-hint">{x.area}</p>
                    {act ? <div className="xr-next-actions">{act}</div> : null}
                  </li>
                );
              })}
            </ol>
            {needsAddNote ? <p className="ui-hint" data-add-unavailable>{l['jx.prep.reinforce.addUnavailable']}</p> : null}
          </>
        )}
      </section>

      <section className="card prep-section jx-card" id="jx-assesses" aria-labelledby="jx-assesses-title">
        <h2 id="jx-assesses-title" className="ex-status-title">{l['jx.prep.assesses.title']}</h2>
        {view.objective.description ? <p className="ex-status-body">{view.objective.description}</p> : null}
        {byArea.size > 0 ? (
          [...byArea.entries()].map(([area, items]) => (
            <div key={area} className="prep-area">
              <h3 className="prep-subtitle">{area}</h3>
              <ul className="prep-reqs">{items.map((d, i) => <li key={`${area}-${i}`}>{d}</li>)}</ul>
            </div>
          ))
        ) : view.objective.catalogParts.length > 0 ? (
          <ul className="prep-reqs">{view.objective.catalogParts.map((x) => <li key={x.key}>{x.label}</li>)}</ul>
        ) : (
          <p className="ex-status-body">{l['jx.prep.assesses.pending']}</p>
        )}
      </section>
    </>
  );

  // Prediction (J3.7) is not implemented: with no classified model (PREDICTION_MODEL_UNAVAILABLE) nothing --
  // not even a placeholder -- is rendered. `predictionVisible` stays false for every resolution today.
  const results = (
    <section className="card prep-section jx-card" aria-labelledby="jx-results-title">
      <h2 id="jx-results-title" className="ex-status-title">{l['jx.results.title']}</h2>
      {hasResults ? <AttemptHistory rows={p.attempts} labels={l} locale={locale} /> : <p className="ex-status-body">{l['jx.results.empty']}</p>}
    </section>
  );

  return (
    <div className="prep-home jx-overview" data-tab={tab}>
      <nav className="jx-tabs" aria-label={l['jx.tabs.label']}>
        {tabs.map((t) => (
          <Link key={t.key} href={t.href} className={`jx-tab${t.key === tab ? ' is-active' : ''}`} aria-current={t.key === tab ? 'page' : undefined}>{l[`jx.tab.${t.key}`]}</Link>
        ))}
      </nav>
      {tab === 'summary' ? summary : tab === 'prepare' ? prepare : results}
    </div>
  );
}
