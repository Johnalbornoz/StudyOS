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
import { preparationBadgeKey, preparationBadgeLabelKey } from '@/lib/exam-core/objectives/capabilities';
import { objectiveSuggestions, searchTokens, suggestionKey, type ObjectiveSuggestion } from '@/lib/exam-core/objectives/objective-suggest';

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
  /** T1 final delta (B2): canonical subject this option belongs to (catalogue identifiers, never label text). */
  groupKey?: string | null;
  groupLabel?: string | null;
  /** Micro-delta M04: the course ("Matemáticas: Análisis y Enfoques") and level ("Nivel Medio (NM)") as displayed. */
  subjectLabel?: string | null;
  levelLabel?: string | null;
  /** M03c: the catalogue groups as displayed in the interface locale. */
  groupNames?: string[];
}

/** `family` (B1): frameworks of one awarding body are ONE entry on the landing (Cambridge International). */
export interface PickerFramework { key: string; region: string; family?: string | null }

/** A listing longer than this is organised by canonical subject (closed accordions). */
export const GROUPING_THRESHOLD = 8;

export interface ObjectiveGroup { key: string; label: string; options: PickerObjective[] }

/**
 * T1 final delta (B2) -- pure: organises a listing by canonical subject, in catalogue order. Options
 * without a subject (tests, programme plans) stay ungrouped. Nothing is dropped: every option keeps
 * its own row, level, variant and syllabus code.
 */
export function groupBySubject(list: PickerObjective[]): { groups: ObjectiveGroup[]; ungrouped: PickerObjective[] } {
  const groups = new Map<string, ObjectiveGroup>();
  const ungrouped: PickerObjective[] = [];
  for (const o of list) {
    if (!o.groupKey) { ungrouped.push(o); continue; }
    if (!groups.has(o.groupKey)) groups.set(o.groupKey, { key: o.groupKey, label: o.groupLabel ?? o.label, options: [] });
    groups.get(o.groupKey)!.options.push(o);
  }
  return { groups: [...groups.values()], ungrouped };
}

/** Landing entries (pure): a family replaces its frameworks, at the position of the first one. */
export function landingEntries(frameworks: PickerFramework[]): Array<{ kind: 'FRAMEWORK'; framework: PickerFramework } | { kind: 'FAMILY'; family: string; frameworks: PickerFramework[] }> {
  const out: Array<{ kind: 'FRAMEWORK'; framework: PickerFramework } | { kind: 'FAMILY'; family: string; frameworks: PickerFramework[] }> = [];
  for (const f of frameworks) {
    const members = f.family ? frameworks.filter((x) => x.family === f.family) : [];
    if (members.length < 2) { out.push({ kind: 'FRAMEWORK', framework: f }); continue; }
    if (members[0].key === f.key) out.push({ kind: 'FAMILY', family: f.family!, frameworks: members });
  }
  return out;
}

const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const PAGE = 40;

export function ObjectivePicker({ objectives, frameworks, suggested, frameworkReasons = {}, labels: l, initial }: {
  objectives: PickerObjective[];
  frameworks: PickerFramework[];
  suggested: string[];
  frameworkReasons?: Record<string, string>;
  labels: L;
  /** Optional starting view (a family level, one framework's listing, or a search). */
  initial?: { family?: string | null; framework?: string; query?: string; suggest?: boolean };
}) {
  const router = useRouter();
  const [query, setQuery] = useState(initial?.query ?? '');
  const [framework, setFramework] = useState<string>(initial?.framework ?? 'ALL');
  const [family, setFamily] = useState<string | null>(initial?.family ?? null);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  // M04: typeahead. `suggest.open` only controls the popup; the typed search always keeps filtering.
  const [suggest, setSuggest] = useState<{ open: boolean; active: number }>({ open: !!initial?.suggest, active: -1 });
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

  const words = searchTokens(query);
  const listing = words.length > 0 || framework !== 'ALL';
  const results = objectives.filter(
    (o) => (framework === 'ALL' || o.framework === framework) && (region === 'ALL' || regionOf.get(o.framework) === region) && words.every((w) => o.searchText.includes(w))
  );
  // B2: the Student's own subjects stay first; the rest of a long listing is organised by canonical subject.
  const rest = results.filter((o) => !o.yourSubject);
  const grouped = rest.length > GROUPING_THRESHOLD && rest.some((o) => o.groupKey) ? groupBySubject(rest) : null;
  // REM-T1-04: frameworks holding the Student's own profile subjects come first.
  const hasMine = (key: string) => (byFramework.get(key) ?? []).some((o) => o.yourSubject);
  const visibleFrameworks = frameworks
    .filter((f) => (region === 'ALL' || f.region === region) && byFramework.has(f.key))
    .sort((a, b) => Number(hasMine(b.key)) - Number(hasMine(a.key)));
  const entries = landingEntries(visibleFrameworks);
  const familyFrameworks = family ? visibleFrameworks.filter((f) => f.family === family) : [];
  const fwName = (key: string) => l[`prep.fw.${key}`] ?? key;
  const familyName = (key: string) => l[`acp.prep.family.${key}`] ?? key;
  const optionsText = (n: number) => (n === 1 ? l['acp.prep.groupOptions.one'] ?? '1' : (l['acp.prep.groupOptions.other'] ?? '{n}').replace('{n}', String(n)));
  const pickFramework = (key: string) => { setFramework(key); setLimit(PAGE); setOpenGroups(new Set()); };
  const regions = [...new Set(frameworks.filter((f) => byFramework.has(f.key)).map((f) => f.region))];

  const suggestions = useMemo(
    () => objectiveSuggestions({ query, objectives: objectives.map((o) => ({ ...o, syllabusCode: o.context.syllabusCode })), frameworks, frameworkName: fwName, familyName, optionsText }),
    [query, objectives, frameworks, l]
  );
  const suggestOpen = suggest.open && suggestions.length > 0;
  function applySuggestion(s: ObjectiveSuggestion) {
    // Only the picker's own filter changes: nothing is added or selected for the Student.
    setRegion('ALL');
    setFamily(s.apply.family ?? null);
    setFramework(s.apply.framework ?? 'ALL');
    setQuery(s.apply.query ?? '');
    setLimit(PAGE);
    setOpenGroups(new Set());
    setSuggest({ open: false, active: -1 });
  }
  function onSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    const next = suggestionKey({ open: suggestOpen, active: suggest.active }, e.key, suggestions.length);
    if (!next.handled) return;
    e.preventDefault();
    if (next.select !== null) applySuggestion(suggestions[next.select]);
    else setSuggest({ open: next.open, active: next.active });
  }

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
    [o.kind === 'SUBJECT_LEVEL' ? o.context.programme : null, (o.groupNames ?? o.context.groups).join(' / ') || null, o.context.syllabusCode && !o.label.includes(o.context.syllabusCode) ? o.context.syllabusCode : null, o.context.version ? `${l['prep.goal.version']}: ${o.context.version}` : null]
      .filter(Boolean)
      .join(' · ');

  // M06: an objective already in the Student's preparation never shows an "add" eligibility message.
  const badgeOf = (o: PickerObjective) => preparationBadgeKey(o.status, !!o.preparationId);
  const ctaLabel = (o: PickerObjective) => (o.preparationId ? l['prep.cta.view'] : busy === o.key ? l['prep.cta.adding'] : o.kind === 'SUBJECT_LEVEL' ? l['prep.cta.add'] : l['prep.cta.prepare']);

  const row = (o: PickerObjective) => (
    <li key={o.key} className="prep-row">
      <div className="prep-row-main">
        <span className="prep-row-name">{o.label}</span>
        {contextLine(o) ? <span className="ui-hint">{contextLine(o)}</span> : null}
        {o.reason ? <span className="ui-hint elig-reason">{o.reason}</span> : null}
        <span className={`xr-pill prep-status prep-status--${badgeOf(o)}`} data-prep-badge={badgeOf(o)}>{l[preparationBadgeLabelKey(badgeOf(o))]}</span>
      </div>
      <button type="button" className={o.preparationId ? 'btn btn-secondary prep-cta' : 'btn btn-primary prep-cta'} onClick={() => choose(o)} disabled={!!busy && busy !== o.key} aria-busy={busy === o.key} aria-label={`${ctaLabel(o)}: ${o.label}`}>
        {ctaLabel(o)}
      </button>
    </li>
  );

  const frameworkCard = (f: PickerFramework) => {
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
                  {single ? <span className={`xr-pill prep-status prep-status--${badgeOf(single)}`} data-prep-badge={badgeOf(single)}>{l[preparationBadgeLabelKey(badgeOf(single))]}</span> : null}
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
                  <button type="button" className="btn btn-secondary prep-cta" data-explore-all onClick={() => { pickFramework(f.key); }}>
                    {(l['acp.prep.exploreAll'] ?? '{framework} ({n})').replace('{framework}', l[`prep.fw.${f.key}`] ?? f.key).replace('{n}', String(list.length))}
                  </button>
                ) : (
                  <button type="button" className="btn btn-primary prep-cta" onClick={() => { pickFramework(f.key); }} aria-label={`${l['prep.cta.chooseSubject']}: ${l[`prep.fw.${f.key}`]}`}>
                    {l['prep.cta.chooseSubject']}
                  </button>
                )}
              </li>
            );
  };

  return (
    <div className="prep-picker">
      <div className="prep-controls">
        <label className="ui-field prep-search">
          <span className="ui-label">{l['prep.search.label']}</span>
          <span className="prep-suggest-wrap">
            <input
              className="ui-input"
              type="search"
              value={query}
              placeholder={l['prep.search.placeholder']}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={suggestOpen}
              aria-controls="prep-suggest"
              aria-activedescendant={suggestOpen && suggest.active >= 0 ? `prep-suggest-${suggest.active}` : undefined}
              aria-describedby="prep-suggest-hint"
              autoComplete="off"
              onChange={(e) => { setQuery(e.target.value); setLimit(PAGE); setSuggest({ open: true, active: -1 }); }}
              onKeyDown={onSearchKey}
              onFocus={() => setSuggest((s) => ({ ...s, open: true }))}
              onBlur={() => setSuggest({ open: false, active: -1 })}
            />
            <span id="prep-suggest-hint" className="sr-only">{l['acp.prep.suggest.hint']}</span>
            {suggestOpen ? (
              <ul className="prep-suggest" id="prep-suggest" role="listbox" aria-label={l['acp.prep.suggest.label']} data-suggestions>
                {suggestions.map((s, i) => (
                  <li
                    key={s.id}
                    id={`prep-suggest-${i}`}
                    role="option"
                    aria-selected={i === suggest.active}
                    className={`prep-suggest-item${s.depth ? ' prep-suggest-item--child' : ''}`}
                    data-suggestion-kind={s.kind}
                    // mousedown would blur the input (closing the list) before the click lands
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => applySuggestion(s)}
                  >
                    <span className="prep-suggest-label">{s.label}</span>
                    <span className="ui-hint prep-suggest-detail">{s.detail ?? l[`acp.prep.suggest.kind.${s.kind}`]}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </span>
        </label>
        <div className="prep-chips" role="group" aria-label={l['prep.filter.framework']}>
          <button type="button" className="prep-chip" aria-pressed={framework === 'ALL' && !family} onClick={() => { pickFramework('ALL'); setFamily(null); }}>{l['prep.filter.all']}</button>
          {entries.map((e) =>
            e.kind === 'FAMILY' ? (
              <button key={e.family} type="button" className="prep-chip" data-family-chip={e.family} aria-pressed={family === e.family || e.frameworks.some((f) => f.key === framework)} onClick={() => { pickFramework('ALL'); setQuery(''); setFamily(e.family); }}>
                {familyName(e.family)}
              </button>
            ) : (
              <button key={e.framework.key} type="button" className="prep-chip" aria-pressed={framework === e.framework.key} onClick={() => { setFamily(null); pickFramework(e.framework.key); }}>
                {fwName(e.framework.key)}
              </button>
            )
          )}
        </div>
        <div className="prep-chips" role="group" aria-label={l['prep.filter.region']}>
          {['ALL', ...regions].map((k) => (
            <button key={k} type="button" className="prep-chip" aria-pressed={region === k} onClick={() => { setRegion(k); setFramework('ALL'); setFamily(null); }}>
              {k === 'ALL' ? l['prep.filter.allRegions'] : l[`prep.region.${k}`]}
            </button>
          ))}
        </div>
      </div>

      {error ? <p className="ui-hint prep-error" role="alert">{error}</p> : null}

      {!listing ? (
        <>
          {family ? (
            <div className="prep-family-head" data-family-level={family}>
              <h3 className="exv2-title">{l[`acp.prep.familyQuestion.${family}`] ?? familyName(family)}</h3>
              <p className="ui-hint">{l['acp.prep.familyLead']}</p>
              <button type="button" className="btn btn-ghost prep-back" onClick={() => setFamily(null)}>{l['prep.back']}</button>
            </div>
          ) : null}
          <ul className="prep-frameworks">
            {family
              ? familyFrameworks.map(frameworkCard)
              : entries.map((e) => {
                  if (e.kind === 'FRAMEWORK') return frameworkCard(e.framework);
                  const total = e.frameworks.reduce((n, f) => n + (byFramework.get(f.key)?.length ?? 0), 0);
                  const reason = e.frameworks.map((f) => frameworkReasons[f.key]).find(Boolean);
                  return (
                    <li key={e.family} className="card prep-fw" data-family={e.family}>
                      <div className="prep-fw-head">
                        <h3 className="prep-fw-name">{familyName(e.family)}</h3>
                        {e.frameworks.some((f) => suggested.includes(f.key)) && !reason ? <span className="xr-pill is-good">{l['prep.suggested']}</span> : null}
                      </div>
                      {reason ? <p className="ui-hint elig-reason">{reason}</p> : null}
                      <p className="ui-hint prep-fw-desc">{l[`acp.prep.familyDesc.${e.family}`]}</p>
                      <p className="prep-fw-meta">{(l['acp.prep.programmes'] ?? '{n}').replace('{n}', String(e.frameworks.length))} · {optionsText(total)}</p>
                      <button type="button" className="btn btn-primary prep-cta" onClick={() => setFamily(e.family)} aria-label={`${l['acp.prep.chooseProgramme']}: ${familyName(e.family)}`}>
                        {l['acp.prep.chooseProgramme']}
                      </button>
                    </li>
                  );
                })}
          </ul>
        </>
      ) : (
        <section aria-live="polite" className="prep-results">
          <div className="prep-results-head">
            <p className="ui-hint">{(l['prep.results'] ?? '{n}').replace('{n}', String(results.length))}</p>
            <button type="button" className="btn btn-ghost prep-back" onClick={() => { const fam = frameworks.find((f) => f.key === framework)?.family ?? null; setFramework('ALL'); setQuery(''); setOpenGroups(new Set()); setFamily(words.length === 0 ? fam : null); }}>{l['prep.back']}</button>
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
              {grouped ? (
                <>
                  {grouped.ungrouped.length > 0 ? <ul className="prep-rows">{grouped.ungrouped.map(row)}</ul> : null}
                  <div className="prep-groups" data-subject-groups aria-label={l['acp.prep.bySubject']} role="group">
                    {grouped.groups.map((g) => {
                      // Closed by default; a search opens every subject that holds a match.
                      const open = words.length > 0 || openGroups.has(g.key);
                      return (
                        <details key={g.key} className="prep-group" data-subject-group={g.key} open={open} onToggle={(e) => {
                          const isOpen = (e.currentTarget as HTMLDetailsElement).open;
                          if (words.length > 0 || isOpen === openGroups.has(g.key)) return;
                          const next = new Set(openGroups);
                          if (isOpen) next.add(g.key); else next.delete(g.key);
                          setOpenGroups(next);
                        }}>
                          <summary className="prep-group-head">
                            <span className="prep-group-name">{g.label}</span>
                            <span className="ui-hint prep-group-count">{optionsText(g.options.length)}</span>
                          </summary>
                          <ul className="prep-rows">{g.options.map(row)}</ul>
                        </details>
                      );
                    })}
                  </div>
                </>
              ) : (
                <>
                  <ul className="prep-rows">{rest.slice(0, limit).map(row)}</ul>
                  {rest.length > limit ? (
                    <button type="button" className="btn btn-secondary prep-cta" onClick={() => setLimit(limit + PAGE)}>{l['prep.showMore']}</button>
                  ) : null}
                </>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
