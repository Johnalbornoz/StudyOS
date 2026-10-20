'use client';

/**
 * FD Cambridge §16 -- step-ordered creation flow (client). The server decides everything: the options of each
 * step, the valid series, the syllabus auto-resolution and the blockers. Choosing a step clears every later step
 * (the order programme -> subject -> tier -> year -> series is never bypassed). Blocked options are shown with
 * their reason and cannot be chosen; nothing visible leads to a route that does not work.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CambridgeSelection, FlowState } from '@/lib/exam-core/cambridge/creation-flow';
import type { CambridgeFlowLabels } from '@/lib/exam-core/cambridge/flow-labels';

const ORDER = ['programme', 'subject', 'tier', 'examYear', 'examSeries', 'syllabusChoice'] as const;

/** Pure: a new selection with `field` set and every later field cleared. */
export function selectStep(sel: CambridgeSelection, field: (typeof ORDER)[number], value: string | number | null): CambridgeSelection {
  const next: CambridgeSelection = {};
  for (const f of ORDER) {
    if (f === field) {
      (next as Record<string, unknown>)[f] = value === '' ? null : value;
      break;
    }
    (next as Record<string, unknown>)[f] = sel[f];
  }
  return next;
}

function query(sel: CambridgeSelection, locale: string): string {
  const p = new URLSearchParams({ lang: locale });
  for (const f of ORDER) {
    const v = sel[f];
    if (v !== undefined && v !== null && v !== '') p.set(f, String(v));
  }
  return p.toString();
}

export function CambridgeCreationFlow({ initial, labels: l, locale }: { initial: FlowState; labels: CambridgeFlowLabels; locale: string }) {
  const router = useRouter();
  const [sel, setSel] = useState<CambridgeSelection>({});
  const [state, setState] = useState<FlowState>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = l as Record<string, string>;

  async function choose(field: (typeof ORDER)[number], value: string | number | null) {
    const next = selectStep(sel, field, value);
    setSel(next);
    setError(null);
    const r = await fetch(`/api/exam-preparation/cambridge?${query(next, locale)}`).catch(() => null);
    const b = r?.ok ? await r.json().catch(() => null) : null;
    if (b?.data) setState(b.data as FlowState);
    else setError(l.error);
  }

  async function create() {
    if (busy || state.step !== 'CREATE') return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/exam-preparation/cambridge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...sel, examYear: sel.examYear ?? undefined, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      });
      const b = await r.json().catch(() => null);
      if (!r.ok || !b?.data?.profile?.id) throw new Error();
      router.push(`/dashboard/exam-prep/${b.data.profile.id}`);
      router.refresh();
    } catch {
      setError(l.error);
      setBusy(false);
    }
  }

  const blockers = state.resolution?.status === 'BLOCKED' ? state.resolution.blockers : [];
  const resolved = state.resolution?.status === 'RESOLVED' ? state.resolution : null;
  const choices = state.resolution?.status === 'CHOICE_REQUIRED' ? state.resolution.choices : [];

  return (
    <form className="ui-form cambridge-flow" onSubmit={(e) => { e.preventDefault(); void create(); }} data-cambridge-flow data-step={state.step}>
      <label className="ui-field">
        <span className="ui-label">{l['step.PROGRAMME']}</span>
        <select className="ui-select" value={sel.programme ?? ''} onChange={(e) => choose('programme', e.target.value)} data-step-programme>
          <option value="">{l.choose}</option>
          {state.programmes.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
      </label>

      {state.subjects ? (
        <label className="ui-field">
          <span className="ui-label">{l['step.SUBJECT']}</span>
          <select className="ui-select" value={sel.subject ?? ''} onChange={(e) => choose('subject', e.target.value)} data-step-subject>
            <option value="">{l.choose}</option>
            {state.subjects.map((s) => (
              <option key={s.key} value={s.key} disabled={!s.available} data-blocked={s.available ? undefined : s.blockers.map((b) => b.code).join(',')}>
                {s.label}{s.codes.length ? ` (${s.codes.join(' / ')})` : ''}{s.available ? '' : ` -- ${t[`blocker.${s.blockers[0]?.code}`] ?? l['blocked.title']}`}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {state.tiers ? (
        <label className="ui-field">
          <span className="ui-label">{l['step.TIER']}</span>
          <select className="ui-select" value={sel.tier ?? ''} onChange={(e) => choose('tier', e.target.value)} data-step-tier>
            <option value="">{l.choose}</option>
            {state.tiers.map((tier) => <option key={tier} value={tier}>{t[`tier.${tier}`]}</option>)}
          </select>
        </label>
      ) : null}

      {state.years ? (
        <label className="ui-field">
          <span className="ui-label">{l['step.EXAM_YEAR']}</span>
          <select className="ui-select" value={sel.examYear ?? ''} onChange={(e) => choose('examYear', e.target.value ? Number(e.target.value) : null)} data-step-year>
            <option value="">{l.choose}</option>
            {state.years.map((y) => <option key={y.year} value={y.year} disabled={!y.versionGoverned}>{y.year}{y.versionGoverned ? '' : ` -- ${l['year.versionNotGoverned']}`}</option>)}
          </select>
        </label>
      ) : null}

      {choices.length ? (
        <fieldset className="ui-field" data-syllabus-choice>
          <legend className="ui-label">{l['syllabus.choose']}</legend>
          {choices.map((c) => (
            <label key={c.key} className="ui-check">
              <input type="radio" name="syllabusChoice" value={c.key} checked={sel.syllabusChoice === c.key} onChange={() => choose('syllabusChoice', c.key)} />
              <span>{c.syllabusCode} · {c.version}{c.route ? ` · ${t[`route.${c.route}`] ?? c.route}` : ''}</span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {state.series ? (
        <label className="ui-field">
          <span className="ui-label">{l['step.EXAM_SERIES']}</span>
          <select className="ui-select" value={sel.examSeries ?? ''} onChange={(e) => choose('examSeries', e.target.value)} data-step-series>
            <option value="">{l.choose}</option>
            {state.series.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
      ) : null}

      {resolved ? (
        <p className="ui-hint" data-syllabus-resolved>
          {l['syllabus.resolved']}: {resolved.mapping.syllabusCode} · {resolved.version.version}{resolved.mapping.route ? ` · ${t[`route.${resolved.mapping.route}`] ?? resolved.mapping.route}` : ''}
        </p>
      ) : null}
      {resolved && resolved.mapping.supply !== 'READY' ? <p className="ui-hint" data-supply-not-ready>{l['supply.notReady']}</p> : null}
      {state.activityKinds && !state.activityKinds.includes('MOCK') ? <p className="ui-hint" data-format-project>{l['format.project']}</p> : null}
      {blockers.length ? (
        <div className="ui-hint" role="status" data-blocked={blockers.map((b) => b.code).join(',')}>
          <strong>{l['blocked.title']}</strong>
          <ul>{blockers.map((b) => <li key={b.code}>{t[`blocker.${b.code}`] ?? b.code}</li>)}</ul>
        </div>
      ) : null}

      <div className="ui-form-actions">
        <button type="submit" className="btn btn-primary prep-cta" disabled={busy || state.step !== 'CREATE'} aria-busy={busy} data-create>
          {busy ? l.creating : l.create}
        </button>
        {error ? <span className="ui-hint" role="alert">{error}</span> : null}
      </div>
    </form>
  );
}
