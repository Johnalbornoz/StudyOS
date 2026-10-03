'use client';

/**
 * Cambridge AICE Diploma -- "My AICE Diploma Plan". Planning and readiness only:
 * every number comes from the server view (credits from the versioned policy,
 * results recorded by the coordinator); the Student never edits credits,
 * grades or points. Official Cambridge terms stay visible next to the Spanish.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AicePlanView, PlanEntryView } from '@/lib/exam-core/aice/plan.service';

type L = Record<string, string>;
type Group = 'CORE' | 'GROUP_1' | 'GROUP_2' | 'GROUP_3' | 'GROUP_4';
const GROUPS: Group[] = ['CORE', 'GROUP_1', 'GROUP_2', 'GROUP_3', 'GROUP_4'];
const f = (s: string, v: Record<string, string | number>) => Object.entries(v).reduce((a, [k, x]) => a.replace(`{${k}}`, String(x)), s);

export function AicePlanner({ view, labels: l }: { view: AicePlanView; labels: L }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seriesLabel = (s: { year: number; month: number }) => `${l[`aice.series.${s.month}`]} ${s.year}`;

  async function call(url: string, method: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const b = await r.json().catch(() => null);
      if (!r.ok) {
        setError(l[`aice.error.${b?.error}`] ?? l['aice.error.generic']);
        return false;
      }
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  if (!view.plan) {
    return (
      <section className="card ex-status" aria-labelledby="aice-start-title">
        <h2 id="aice-start-title" className="ex-status-title">{l['aice.start.title']}</h2>
        <p className="ex-status-body">{l['aice.start.body']}</p>
        <ul className="aice-rules">
          <li>{l['aice.rule.credits']}</li>
          <li>{l['aice.rule.core']}</li>
          <li>{l['aice.rule.groups']}</li>
          <li>{l['aice.rule.window']}</li>
        </ul>
        <div><button type="button" className="btn btn-primary" disabled={busy} onClick={() => call('/api/aice/plan', 'POST')}>{l['aice.start.cta']}</button></div>
        {error && <p role="alert" className="xr-error">{error}</p>}
      </section>
    );
  }

  const ev = view.planEvaluation;
  const pct = Math.min(100, Math.round((ev.totalCredits / ev.minimumCredits) * 100));
  const unplaced = view.entries.filter((e) => e.needsGroupChoice);
  const resultsExist = view.diploma.results.length > 0;

  return (
    <div className="aice-plan">
      <section className="card ex-status" aria-labelledby="aice-progress-title">
        <h2 id="aice-progress-title" className="ex-status-title">{f(l['aice.progress.credits'], { n: ev.totalCredits, m: ev.minimumCredits })}</h2>
        <div className="xr-bar" role="img" aria-label={f(l['aice.progress.credits'], { n: ev.totalCredits, m: ev.minimumCredits })}><span className="xr-bar-fill" style={{ width: `${pct}%` }} /></div>
        <ul className="aice-reqs">
          <li className={ev.coreIncluded ? 'is-ok' : 'is-missing'}>{ev.coreIncluded ? l['aice.req.coreOk'] : l['aice.req.coreMissing']}</li>
          {ev.groups.map((g) => (
            <li key={g.group} className={g.satisfied ? 'is-ok' : 'is-missing'}>
              {g.group === 'GROUP_4' ? f(l['aice.req.group4'], { n: g.credits, max: g.max ?? 2 }) : f(l['aice.req.group'], { group: l[`aice.group.${g.group}`], n: Math.min(g.credits, g.required), m: g.required })}
            </li>
          ))}
        </ul>
        {ev.issues.length > 0 && (
          <ul className="aice-issues">
            {[...new Set(ev.issues.map((i) => i.code))].filter((c) => c !== 'GROUP_MISSING' && c !== 'CORE_MISSING').map((c) => <li key={c}>{l[`aice.issue.${c}`]}</li>)}
          </ul>
        )}
        <p className="ui-hint">{l['aice.planningOnly']}</p>
      </section>

      {unplaced.length > 0 && (
        <section className="card ex-status" aria-labelledby="aice-choose-title">
          <h2 id="aice-choose-title" className="ex-status-title">{l['aice.choose.title']}</h2>
          {unplaced.map((e) => (
            <div key={e.id} className="aice-entry">
              <p className="aice-entry-name">{e.subjectName} · {l['aice.syllabusCode']}: {e.syllabusCode}</p>
              <p className="ui-hint">{f(l['aice.choose.body'], { groups: e.eligibleGroups.filter((g) => g !== 'CORE').map((g) => l[`aice.group.${g}`]).join(l['aice.or']) })}</p>
              <div className="xr-next-actions">
                {e.eligibleGroups.filter((g) => g !== 'CORE').map((g) => (
                  <button key={g} type="button" className="btn" disabled={busy} onClick={() => call(`/api/aice/plan/entries/${e.id}`, 'PATCH', { countedGroup: g })}>{f(l['aice.choose.countIn'], { group: l[`aice.group.${g}`] })}</button>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {GROUPS.map((g) => (
        <GroupSection key={g} group={g} view={view} labels={l} busy={busy} seriesLabel={seriesLabel} call={call} />
      ))}

      <section className="card ex-status" aria-labelledby="aice-results-title">
        <h2 id="aice-results-title" className="ex-status-title">{l['aice.results.title']}</h2>
        {!resultsExist ? (
          <p className="ui-hint">{l['aice.results.none']}</p>
        ) : (
          <>
            <p className="ex-status-body">
              {view.diploma.compositionValid
                ? f(l['aice.results.points'], { n: view.diploma.points, max: view.policy.maxScore, band: l[`aice.band.${view.diploma.band}`] ?? '' })
                : l['aice.results.incomplete']}
            </p>
            <p className="ui-hint">{l['aice.results.source']}</p>
          </>
        )}
        {view.policy.assumptions.length > 0 && (
          <details className="ui-disclosure">
            <summary>{l['aice.assumptions.title']}</summary>
            <div className="ui-disclosure-body">
              <ul>{view.policy.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
              <p className="ui-hint">{f(l['aice.assumptions.policy'], { v: view.policy.version })}</p>
            </div>
          </details>
        )}
      </section>
      {error && <p role="alert" className="xr-error">{error}</p>}
    </div>
  );
}

function GroupSection({ group, view, labels: l, busy, seriesLabel, call }: { group: Group; view: AicePlanView; labels: L; busy: boolean; seriesLabel: (s: { year: number; month: number }) => string; call: (url: string, method: string, body?: unknown) => Promise<boolean> }) {
  const entries = view.entries.filter((e) => e.countedGroup === group);
  const options = view.options.find((o) => o.group === group)?.subjects.filter((s) => !view.entries.some((e) => e.syllabusCode === s.code)) ?? [];
  const [code, setCode] = useState('');
  const [level, setLevel] = useState<'AS' | 'A'>('AS');
  const [series, setSeries] = useState('');
  const subject = options.find((s) => s.code === code);
  const credits = view.planEvaluation.groups.find((x) => x.group === group)?.credits ?? (group === 'CORE' ? (view.planEvaluation.coreIncluded ? 1 : 0) : 0);
  return (
    <section className={`card ex-status aice-group${group === 'CORE' ? ' is-core' : ''}`} aria-labelledby={`aice-${group}`}>
      <div className="aice-group-head">
        <h2 id={`aice-${group}`} className="ex-status-title">{l[`aice.group.${group}.title`]}</h2>
        <span className="xr-pill">{f(l['aice.group.credits'], { n: credits })}</span>
      </div>
      <p className="ui-hint">{l[`aice.group.${group}.hint`]}</p>
      {entries.length === 0 && <p className="ui-hint">{l['aice.group.empty']}</p>}
      {entries.map((e) => <EntryRow key={e.id} e={e} view={view} labels={l} busy={busy} seriesLabel={seriesLabel} call={call} />)}
      {options.length > 0 && (
        <form
          className="aice-add"
          onSubmit={async (ev) => {
            ev.preventDefault();
            if (!subject) return;
            const [y, m] = series ? series.split('-').map(Number) : [null, null];
            const multi = subject.groups.filter((x) => x !== 'CORE').length > 1;
            if (await call('/api/aice/plan/entries', 'POST', { syllabusCode: subject.code, level, countedGroup: multi ? group : null, expectedSeries: y ? { year: y, month: m } : null })) {
              setCode('');
              setSeries('');
            }
          }}
        >
          <label className="aice-field">
            <span>{l['aice.add.subject']}</span>
            <select value={code} onChange={(e) => { setCode(e.target.value); const s = options.find((x) => x.code === e.target.value); if (s && !s.levels.includes(level)) setLevel(s.levels[0]); }}>
              <option value="">{l['aice.add.choose']}</option>
              {options.map((s) => <option key={s.code} value={s.code}>{s.name} ({s.code}){s.configured.length ? ` · ${l['aice.add.practice']}` : ''}</option>)}
            </select>
          </label>
          <label className="aice-field">
            <span>{l['aice.add.level']}</span>
            <select value={level} onChange={(e) => setLevel(e.target.value as 'AS' | 'A')} disabled={!subject}>
              {(subject?.levels ?? ['AS', 'A']).map((lv) => <option key={lv} value={lv}>{lv === 'AS' ? l['aice.level.AS'] : l['aice.level.A']}</option>)}
            </select>
          </label>
          <label className="aice-field">
            <span>{l['aice.add.series']}</span>
            <select value={series} onChange={(e) => setSeries(e.target.value)}>
              <option value="">{l['aice.add.seriesLater']}</option>
              {view.series.map((s) => <option key={`${s.year}-${s.month}`} value={`${s.year}-${s.month}`}>{seriesLabel(s)}</option>)}
            </select>
          </label>
          <button type="submit" className="btn" disabled={busy || !subject}>{l['aice.add.cta']}</button>
        </form>
      )}
    </section>
  );
}

function EntryRow({ e, view, labels: l, busy, seriesLabel, call }: { e: PlanEntryView; view: AicePlanView; labels: L; busy: boolean; seriesLabel: (s: { year: number; month: number }) => string; call: (url: string, method: string, body?: unknown) => Promise<boolean> }) {
  const [confirming, setConfirming] = useState(false);
  const subject = view.options.flatMap((o) => o.subjects).find((s) => s.code === e.syllabusCode);
  const groups = e.eligibleGroups.filter((g) => g !== 'CORE');
  return (
    <div className="aice-entry">
      <div className="aice-entry-main">
        <p className="aice-entry-name">{e.subjectName}</p>
        <p className="ex-card-meta">
          {l['aice.syllabusCode']}: {e.syllabusCode} · {e.level === 'AS' ? l['aice.level.AS'] : l['aice.level.A']} · {f(l['aice.credits'], { n: e.credits })}
          {e.syllabusVersion ? ` · ${f(l['aice.version'], { v: e.syllabusVersion })}` : ''}
        </p>
        {groups.length > 1 && e.countedGroup !== 'CORE' && <p className="ui-hint">{f(l['aice.multiGroup'], { groups: groups.map((g) => l[`aice.group.${g}`]).join(l['aice.or']) })}</p>}
        <p className="ex-card-meta">
          {/* A planned qualification is independent of what StudyUS can practise for it today. */}
          <span className="xr-pill is-good">{l['aice.planned']}</span>{' '}
          <span className="xr-pill">{f(l['aice.studyusActivities'], { status: l[`aice.readiness.${e.readiness}`] ?? e.readiness })}</span>{' '}
          {e.preparation.latest ? f(l['aice.estimate'], { raw: e.preparation.latest.raw, max: e.preparation.latest.max }) : e.preparation.attempts > 0 ? f(l['aice.attempts'], { n: e.preparation.attempts }) : l['aice.notStarted']}
        </p>
        {e.results.map((r) => (
          <p key={r.id} className="ex-card-meta">
            {f(l['aice.result'], { grade: r.grade, series: seriesLabel(r.series), points: r.points })} · {l[`aice.resultStatus.${r.counted ? 'COUNTED' : r.status}`]}
            {r.status === 'ELIGIBLE' || r.status === 'NOT_COUNTED' ? ` · ${f(l['aice.expires'], { series: seriesLabel(r.expiresAfter) })}` : ''}
          </p>
        ))}
      </div>
      <div className="aice-entry-actions">
        <label className="aice-field">
          <span>{l['aice.add.series']}</span>
          <select
            value={e.expectedSeries ? `${e.expectedSeries.year}-${e.expectedSeries.month}` : ''}
            disabled={busy}
            onChange={(ev) => {
              const [y, m] = ev.target.value ? ev.target.value.split('-').map(Number) : [null, null];
              void call(`/api/aice/plan/entries/${e.id}`, 'PATCH', { expectedSeries: y ? { year: y, month: m } : null });
            }}
          >
            <option value="">{l['aice.add.seriesLater']}</option>
            {view.series.map((s) => <option key={`${s.year}-${s.month}`} value={`${s.year}-${s.month}`}>{seriesLabel(s)}</option>)}
          </select>
        </label>
        {subject && subject.levels.length > 1 && (
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => call(`/api/aice/plan/entries/${e.id}`, 'PATCH', { level: e.level === 'AS' ? 'A' : 'AS' })}>
            {e.level === 'AS' ? l['aice.toA'] : l['aice.toAS']}
          </button>
        )}
        {e.prepareNodeKey && <a className="btn btn-primary" href={`/dashboard/exams?node=${encodeURIComponent(e.prepareNodeKey)}`}>{l['aice.prepare']}</a>}
        {!confirming ? (
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setConfirming(true)}>{l['aice.remove']}</button>
        ) : (
          <span className="exv2-confirm" role="alertdialog" aria-label={l['aice.remove.confirm']}>
            <span>{l['aice.remove.confirm']}</span>
            <button type="button" className="btn btn-danger" disabled={busy} onClick={() => call(`/api/aice/plan/entries/${e.id}`, 'DELETE')}>{l['aice.remove']}</button>
            <button type="button" className="btn" onClick={() => setConfirming(false)}>{l['exv2.delete.no']}</button>
          </span>
        )}
      </div>
    </div>
  );
}
