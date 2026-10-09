'use client';

/**
 * "¿Para qué examen quieres prepararte?" -- objective-first exam selection.
 *
 * EVERY exam / subject level of the governed catalogue can be chosen. The
 * status shown is a short summary of what StudyUs can do for it today; it never
 * disables, hides or blocks an objective ("Exam availability ≠ activity
 * availability"). Search and filters narrow by name / framework / region only,
 * never by readiness. The detail of capabilities lives inside the preparation.
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

type L = Record<string, string>;

export interface PickerObjective {
  key: string;
  framework: string;
  kind: 'EXAM' | 'SUBJECT_LEVEL' | 'PROGRAMME_PLAN';
  label: string;
  context: { programme: string | null; groups: string[]; subject: string | null; syllabusCode: string | null; level: string | null; version: string | null };
  /** Short status key (canAdd | structure | bankInProgress | practice | reducedMock | fullMock | plan). */
  status: string;
  preparationId: string | null;
  searchText: string;
  /** Exam eligibility: recommended for this Student, and why (already in the Student's language). */
  recommended?: boolean;
  reason?: string | null;
  /** REM-T1-04: a subject of the Student's personal Academic Profile -- shown first in its framework. */
  yourSubject?: boolean;
}

export interface PickerFramework { key: string; region: string }

const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const PAGE = 40;

export function ObjectivePicker({ objectives, frameworks, suggested, frameworkReasons = {}, labels: l }: { objectives: PickerObjective[]; frameworks: PickerFramework[]; suggested: string[]; frameworkReasons?: Record<string, string>; labels: L }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [framework, setFramework] = useState<string>('ALL');
  const [region, setRegion] = useState<string>('ALL');
  const [limit, setLimit] = useState(PAGE);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const regionOf = useMemo(() => new Map(frameworks.map((f) => [f.key, f.region])), [frameworks]);
  const byFramework = useMemo(() => {
    const m = new Map<string, PickerObjective[]>();
    for (const o of objectives) {
      if (!m.has(o.framework)) m.set(o.framework, []);
      m.get(o.framework)!.push(o);
    }
    return m;
  }, [objectives]);

  const words = strip(query).split(/\s+/).filter(Boolean);
  const listing = words.length > 0 || framework !== 'ALL';
  const results = objectives.filter(
    (o) => (framework === 'ALL' || o.framework === framework) && (region === 'ALL' || regionOf.get(o.framework) === region) && words.every((w) => o.searchText.includes(w))
  );
  // REM-T1-04: frameworks holding the Student's own profile subjects come first.
  const hasMine = (key: string) => (byFramework.get(key) ?? []).some((o) => o.yourSubject);
  const visibleFrameworks = frameworks
    .filter((f) => (region === 'ALL' || f.region === region) && byFramework.has(f.key))
    .sort((a, b) => Number(hasMine(b.key)) - Number(hasMine(a.key)));
  const regions = [...new Set(frameworks.filter((f) => byFramework.has(f.key)).map((f) => f.region))];

  async function choose(o: PickerObjective) {
    if (o.preparationId) {
      router.push(`/dashboard/exam-prep/${o.preparationId}`);
      return;
    }
    if (busy) return;
    setBusy(o.key);
    setError(null);
    try {
      const r = await fetch('/api/exam-preparation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objectiveKey: o.key, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      });
      const b = await r.json().catch(() => null);
      if (!r.ok || !b?.data?.profile?.id) throw new Error();
      router.push(`/dashboard/exam-prep/${b.data.profile.id}`);
      router.refresh();
    } catch {
      setError(l['prep.error']);
      setBusy(null);
    }
  }

  const contextLine = (o: PickerObjective) =>
    [o.kind === 'SUBJECT_LEVEL' ? o.context.programme : null, o.context.groups.join(' / ') || null, o.context.syllabusCode && !o.label.includes(o.context.syllabusCode) ? o.context.syllabusCode : null, o.context.version ? `${l['prep.goal.version']}: ${o.context.version}` : null]
      .filter(Boolean)
      .join(' · ');

  const ctaLabel = (o: PickerObjective) => (o.preparationId ? l['prep.cta.view'] : busy === o.key ? l['prep.cta.adding'] : o.kind === 'SUBJECT_LEVEL' ? l['prep.cta.add'] : l['prep.cta.prepare']);

  const row = (o: PickerObjective) => (
    <li key={o.key} className="prep-row">
      <div className="prep-row-main">
        <span className="prep-row-name">{o.label}</span>
        {contextLine(o) ? <span className="ui-hint">{contextLine(o)}</span> : null}
        {o.reason ? <span className="ui-hint elig-reason">{o.reason}</span> : null}
        <span className={`xr-pill prep-status prep-status--${o.status}`}>{l[`prep.status.${o.status}`]}</span>
      </div>
      <button type="button" className={o.preparationId ? 'btn btn-secondary prep-cta' : 'btn btn-primary prep-cta'} onClick={() => choose(o)} disabled={!!busy && busy !== o.key} aria-busy={busy === o.key} aria-label={`${ctaLabel(o)}: ${o.label}`}>
        {ctaLabel(o)}
      </button>
    </li>
  );

  return (
    <div className="prep-picker">
      <div className="prep-controls">
        <label className="ui-field prep-search">
          <span className="ui-label">{l['prep.search.label']}</span>
          <input className="ui-input" type="search" value={query} placeholder={l['prep.search.placeholder']} onChange={(e) => { setQuery(e.target.value); setLimit(PAGE); }} />
        </label>
        <div className="prep-chips" role="group" aria-label={l['prep.filter.framework']}>
          {['ALL', ...visibleFrameworks.map((f) => f.key)].map((k) => (
            <button key={k} type="button" className="prep-chip" aria-pressed={framework === k} onClick={() => { setFramework(k); setLimit(PAGE); }}>
              {k === 'ALL' ? l['prep.filter.all'] : l[`prep.fw.${k}`]}
            </button>
          ))}
        </div>
        <div className="prep-chips" role="group" aria-label={l['prep.filter.region']}>
          {['ALL', ...regions].map((k) => (
            <button key={k} type="button" className="prep-chip" aria-pressed={region === k} onClick={() => { setRegion(k); setFramework('ALL'); }}>
              {k === 'ALL' ? l['prep.filter.allRegions'] : l[`prep.region.${k}`]}
            </button>
          ))}
        </div>
      </div>

      {error ? <p className="ui-hint prep-error" role="alert">{error}</p> : null}

      {!listing ? (
        <ul className="prep-frameworks">
          {visibleFrameworks.map((f) => {
            const list = byFramework.get(f.key) ?? [];
            const single = list.length === 1 ? list[0] : null;
            const mine = single ? [] : list.filter((o) => o.yourSubject);
            return (
              <li key={f.key} className="card prep-fw">
                <div className="prep-fw-head">
                  <h3 className="prep-fw-name">{l[`prep.fw.${f.key}`]}</h3>
                  {suggested.includes(f.key) && !frameworkReasons[f.key] ? <span className="xr-pill is-good">{l['prep.suggested']}</span> : null}
                </div>
                {frameworkReasons[f.key] ? <p className="ui-hint elig-reason">{frameworkReasons[f.key]}</p> : null}
                <p className="ui-hint prep-fw-desc">{l[`prep.fwDesc.${f.key}`]}</p>
                <p className="prep-fw-meta">
                  {single ? (single.context.version ? `${l['prep.goal.version']}: ${single.context.version}` : '') : (l['prep.fw.options'] ?? '{n}').replace('{n}', String(list.length))}
                  {single ? <span className={`xr-pill prep-status prep-status--${single.status}`}>{l[`prep.status.${single.status}`]}</span> : null}
                </p>
                {mine.length > 0 ? (
                  <div className="prep-mine-subjects" data-your-subjects>
                    <p className="ui-label">{l['acp.prep.yourSubjects']}</p>
                    <ul className="prep-rows">{mine.map(row)}</ul>
                  </div>
                ) : null}
                {single ? (
                  <button type="button" className={single.preparationId ? 'btn btn-secondary prep-cta' : 'btn btn-primary prep-cta'} onClick={() => choose(single)} disabled={!!busy && busy !== single.key} aria-busy={busy === single.key}>
                    {ctaLabel(single)}
                  </button>
                ) : mine.length > 0 ? (
                  <button type="button" className="btn btn-secondary prep-cta" data-explore-all onClick={() => { setFramework(f.key); setLimit(PAGE); }}>
                    {(l['acp.prep.exploreAll'] ?? '{framework} ({n})').replace('{framework}', l[`prep.fw.${f.key}`] ?? f.key).replace('{n}', String(list.length))}
                  </button>
                ) : (
                  <button type="button" className="btn btn-primary prep-cta" onClick={() => { setFramework(f.key); setLimit(PAGE); }} aria-label={`${l['prep.cta.chooseSubject']}: ${l[`prep.fw.${f.key}`]}`}>
                    {l['prep.cta.chooseSubject']}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <section aria-live="polite" className="prep-results">
          <div className="prep-results-head">
            <p className="ui-hint">{(l['prep.results'] ?? '{n}').replace('{n}', String(results.length))}</p>
            <button type="button" className="btn btn-ghost prep-back" onClick={() => { setFramework('ALL'); setQuery(''); }}>{l['prep.back']}</button>
          </div>
          {results.length === 0 ? (
            <p className="ui-hint">{l['prep.noResults']}</p>
          ) : (
            <>
              {results.some((o) => o.yourSubject) ? (
                <div className="prep-mine-subjects" data-your-subjects>
                  <p className="ui-label">{l['acp.prep.yourSubjects']}</p>
                  <ul className="prep-rows">{results.filter((o) => o.yourSubject).map(row)}</ul>
                </div>
              ) : null}
              <ul className="prep-rows">{results.filter((o) => !o.yourSubject).slice(0, limit).map(row)}</ul>
              {results.filter((o) => !o.yourSubject).length > limit ? (
                <button type="button" className="btn btn-secondary prep-cta" onClick={() => setLimit(limit + PAGE)}>{l['prep.showMore']}</button>
              ) : null}
            </>
          )}
        </section>
      )}
    </div>
  );
}
