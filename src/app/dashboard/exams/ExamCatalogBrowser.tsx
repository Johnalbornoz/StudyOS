'use client';

/**
 * Exam V2 -- dynamic hierarchical exam selection.
 *
 * Renders whatever the catalogue returns, level by level, in the framework's
 * own words (IB -> Diploma -> Group 5 -> Math AA -> HL -> papers; PISA ->
 * PISA 2022 -> Mathematics; ...). Nothing here knows a framework: unavailable
 * nodes are shown as "not available yet", never hidden and never faked.
 * At the exam level the Student picks papers / components and a mode, and an
 * instance is created (a Mock form is frozen on the server before start).
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { InstanceCard, type InstanceView } from './InstanceCard';

type L = Record<string, string>;

interface NodeView {
  key: string;
  family: string;
  type: string;
  label: string;
  description: string | null;
  facts: Record<string, string | number> | null;
  available: boolean;
  isExamLevel: boolean;
  hasChildren: boolean;
  readiness: 'CATALOG_ONLY' | 'STRUCTURE_READY' | 'PRACTICE_READY' | 'REDUCED_MOCK_READY' | 'FULL_MOCK_READY';
  bankInProgress?: boolean;
  bank?: { items: number; positions: number; lengthCoveragePercent: number | null } | null;
  purpose: 'FULL_TEST' | 'AREA_PRACTICE' | 'SKILL_PRACTICE' | null;
  notExaminable: boolean;
  versioning: { curriculumVersion: string | null; firstAssessment: number | null; lastAssessment: number | null; syllabusCode: string | null; frameworkVersion: string | null };
  sources: Array<{ title: string; publisher: string | null; url: string | null; confidence: string }>;
}

interface LevelView {
  nodeKey: string;
  family?: string;
  label: string;
  purpose: 'FULL_TEST' | 'AREA_PRACTICE' | 'SKILL_PRACTICE' | null;
  modes: Mode[];
  componentsFixed: boolean;
  components: Array<{ componentId: string; nodeKey: string | null; name: string; facts: Record<string, string | number> | null; untimed: boolean; kind: string | null; readiness: string; officialMinutes: number | null; officialItems: number | null; officialMarks: number | null; calculator: string | null; plannedMinutes: number | null }>;
  /** Official assessment routes / component combinations (a Mock takes exactly one). */
  routes?: Array<{ key: string; label: string; componentIds: string[]; stage: number | null; stageCount: number | null }>;
  readiness?: string;
  description?: string | null;
  bank?: { items: number; positions: number; lengthCoveragePercent: number | null } | null;
}

/** The readiness the Student sees, as a message key (never the raw state). */
export function readinessKey(n: { readiness: string; notExaminable?: boolean; bankInProgress?: boolean }): string {
  if (n.notExaminable) return 'notExaminable';
  if (n.readiness === 'FULL_MOCK_READY') return 'fullMock';
  if (n.readiness === 'REDUCED_MOCK_READY') return 'reducedMock';
  if (n.readiness === 'PRACTICE_READY') return 'practice';
  if (n.readiness === 'STRUCTURE_READY') return n.bankInProgress ? 'bankInProgress' : 'structureOnly';
  return 'notYet';
}
/** Student-facing readiness label. */
export function readinessLabel(n: { readiness: string; notExaminable?: boolean; bankInProgress?: boolean }, l: L): string {
  return l[`exv2.readiness.${readinessKey(n)}`];
}
/** One sentence saying what that readiness means. */
export function readinessHint(n: { readiness: string; notExaminable?: boolean; bankInProgress?: boolean }, l: L): string {
  return l[`exv2.readinessHint.${readinessKey(n)}`];
}
const PRACTICE_OK = new Set(['PRACTICE_READY', 'REDUCED_MOCK_READY', 'FULL_MOCK_READY']);
/** Catalogue node types that describe WHAT an entry assesses (shown in the domain detail). */
const ASSESSES = new Set(['PROCESS', 'COMPETENCY', 'CONTEXT']);
const MOCK_OK = new Set(['REDUCED_MOCK_READY', 'FULL_MOCK_READY']);

type Mode = 'PRACTICE' | 'MOCK' | 'CHALLENGE';
type Level = 'AUTO' | 'FOUNDATION' | 'STANDARD' | 'ADVANCED' | 'CHALLENGE';

export function factText(facts: Record<string, string | number> | null, l: L): string[] {
  if (!facts) return [];
  const out: string[] = [];
  if (facts.minutes) out.push((l['exv2.fact.minutes'] ?? '{n} min').replace('{n}', String(facts.minutes)));
  if (facts.marks) out.push((l['exv2.fact.marks'] ?? '{n} marks').replace('{n}', String(facts.marks)));
  if (facts.items) out.push((l['exv2.fact.items'] ?? '{n} items').replace('{n}', String(facts.items)));
  if (facts.weightPercent) out.push((l['exv2.fact.weight'] ?? '{n}%').replace('{n}', String(facts.weightPercent)));
  if (facts.calculator) out.push(l[`exv2.fact.calculator.${facts.calculator}`] ?? String(facts.calculator));
  if (facts.assessment) out.push(l[`exv2.fact.assessment.${facts.assessment}`] ?? String(facts.assessment));
  return out;
}

export function ExamCatalogBrowser({ labels: l, language, initialNode }: { labels: L; language: string; initialNode?: { key: string; family: string; label: string } | null }) {
  const router = useRouter();
  const [families, setFamilies] = useState<Array<{ family: string; available: boolean }> | null>(null);
  const [family, setFamily] = useState<string | null>(null);
  const [path, setPath] = useState<Array<{ key: string; label: string }>>([]);
  const [nodes, setNodes] = useState<NodeView[] | null>(null);
  const [level, setLevel] = useState<LevelView | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>('MOCK');
  const [practiceLevel, setPracticeLevel] = useState<Level>('AUTO');
  const [timed, setTimed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<InstanceView | null>(null);
  /** Narrower entries under the chosen one (e.g. PAA area -> skills). */
  const [levelChildren, setLevelChildren] = useState<NodeView[]>([]);

  // Deep link (e.g. from the AICE Diploma plan "Preparar"): open that exam level directly.
  useEffect(() => {
    if (!initialNode) return;
    setFamily(initialNode.family);
    void openNode({ key: initialNode.key, family: initialNode.family, label: initialNode.label, isExamLevel: true, hasChildren: true, available: true } as NodeView);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialNode?.key]);

  useEffect(() => {
    fetch('/api/exams/catalog', { cache: 'no-store' })
      .then((r) => r.json())
      .then((b) => setFamilies(b?.data?.families ?? []))
      .catch(() => setError(l['exv2.error.load']));
  }, [l]);

  const loadChildren = useCallback(
    async (fam: string, parentKey: string | null) => {
      setNodes(null);
      setLevel(null);
      setError(null);
      const qs = new URLSearchParams({ family: fam, lang: language });
      if (parentKey) qs.set('parent', parentKey);
      const r = await fetch(`/api/exams/catalog?${qs}`, { cache: 'no-store' }).catch(() => null);
      const b = r ? await r.json().catch(() => null) : null;
      if (!r?.ok || !b) {
        setError(l['exv2.error.load']);
        return;
      }
      setNodes(b.data.nodes);
    },
    [language, l]
  );

  async function openNode(n: NodeView) {
    setCreated(null);
    if (n.isExamLevel) {
      const r = await fetch(`/api/exams/catalog/level?node=${encodeURIComponent(n.key)}&lang=${language}`, { cache: 'no-store' }).catch(() => null);
      const b = r ? await r.json().catch(() => null) : null;
      if (!r?.ok || !b) {
        setError(l['exv2.error.notAvailable']);
        return;
      }
      setPath((p) => [...p, { key: n.key, label: n.label }]);
      setLevelChildren([]);
      if (n.hasChildren) {
        const cr = await fetch(`/api/exams/catalog?${new URLSearchParams({ family: n.family, parent: n.key, lang: language })}`, { cache: 'no-store' }).catch(() => null);
        const cb = cr ? await cr.json().catch(() => null) : null;
        if (cr?.ok && cb) setLevelChildren(cb.data.nodes);
      }
      const lvl: LevelView = b.data.level;
      setLevel(lvl);
      const ready = lvl.components.filter((c) => PRACTICE_OK.has(c.readiness));
      setPicked(lvl.componentsFixed ? lvl.components.map((c) => c.componentId) : ready.map((c) => c.componentId).slice(0, 1));
      const firstMode = lvl.modes.includes('MOCK') ? 'MOCK' : lvl.modes[0] ?? 'PRACTICE';
      setMode(firstMode);
      const firstRoute = (lvl.routes ?? []).find((r) => r.componentIds.every((id) => MOCK_OK.has(lvl.components.find((c) => c.componentId === id)?.readiness ?? '')));
      if (firstMode !== 'PRACTICE' && firstRoute) setPicked(firstRoute.componentIds);
      setNodes(null);
      return;
    }
    setPath((p) => [...p, { key: n.key, label: n.label }]);
    await loadChildren(n.family, n.key);
  }

  async function openChildren(n: NodeView) {
    setCreated(null);
    setPath((p) => [...p, { key: n.key, label: n.label }]);
    await loadChildren(n.family, n.key);
  }

  async function goToCrumb(i: number) {
    if (!family) return;
    setCreated(null);
    if (i < 0) {
      setPath([]);
      await loadChildren(family, null);
      return;
    }
    const next = path.slice(0, i + 1);
    setPath(next);
    await loadChildren(family, next[next.length - 1].key);
  }

  async function chooseFamily(f: string) {
    setFamily(f);
    setPath([]);
    setCreated(null);
    await loadChildren(f, null);
  }

  async function create() {
    if (!level || picked.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/exams/instances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodeKey: level.nodeKey,
          componentIds: picked,
          mode,
          practiceLevel: mode === 'PRACTICE' && practiceLevel !== 'AUTO' ? practiceLevel : undefined,
          timingMode: mode === 'PRACTICE' ? (timed ? 'TRAINING_TIMED' : 'UNTIMED') : undefined,
          language,
        }),
      });
      const b = await r.json().catch(() => null);
      if (!r.ok) {
        setError(l[`exv2.error.${b?.error}`] ?? l['exv2.error.create']);
        return;
      }
      setCreated(b.data.instance);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const allUntimed = level ? level.components.filter((c) => picked.includes(c.componentId)).every((c) => c.untimed) : false;

  return (
    <section className="card exv2-browser" aria-labelledby="exv2-browse-title">
      <h2 id="exv2-browse-title" className="exv2-title">{l['exv2.browse.title']}</h2>
      <p className="ui-hint">{l['exv2.browse.intro']}</p>

      <div className="exv2-families" role="list">
        {(families ?? []).map((f) => (
          <button key={f.family} type="button" role="listitem" className={`exv2-family${family === f.family ? ' is-active' : ''}`} onClick={() => chooseFamily(f.family)} aria-pressed={family === f.family}>
            <span className="exv2-family-name">{l[`exv2.family.${f.family}`] ?? f.family}</span>
            {!f.available && <span className="xr-pill">{l['exv2.notAvailable']}</span>}
          </button>
        ))}
        {families === null && !error && <p className="ui-hint">{l['exv2.loading']}</p>}
      </div>

      {family && (
        <nav className="exv2-crumbs" aria-label={l['exv2.browse.path']}>
          <button type="button" className="exv2-crumb" onClick={() => goToCrumb(-1)}>{l[`exv2.family.${family}`] ?? family}</button>
          {path.map((p, i) => (
            <span key={p.key} className="exv2-crumb-wrap">
              <span aria-hidden className="exv2-crumb-sep">›</span>
              <button type="button" className="exv2-crumb" onClick={() => goToCrumb(i)} disabled={i === path.length - 1}>{p.label}</button>
            </span>
          ))}
        </nav>
      )}

      {nodes && (
        <ul className="exv2-nodes">
          {nodes.map((n) => (
            <li key={n.key}>
              <button type="button" className={`exv2-node${n.available ? '' : ' is-unavailable'}`} disabled={!n.hasChildren && !(n.isExamLevel && n.available)} onClick={() => (n.isExamLevel && !n.available ? n.hasChildren && openChildren(n) : openNode(n))}>
                <span className="exv2-node-main">
                  <span className="exv2-node-label">{n.label}</span>
                  {(n.versioning.firstAssessment || n.versioning.syllabusCode) && (
                    <span className="exv2-node-version">
                      {[n.versioning.syllabusCode, n.versioning.firstAssessment ? (l['exv2.version.first'] ?? '{y}').replace('{y}', String(n.versioning.firstAssessment)) : null, n.versioning.lastAssessment ? (l['exv2.version.last'] ?? '{y}').replace('{y}', String(n.versioning.lastAssessment)) : null].filter(Boolean).join(' · ')}
                    </span>
                  )}
                  {factText(n.facts, l).length > 0 && <span className="exv2-node-facts">{factText(n.facts, l).join(' · ')}</span>}
                </span>
                <span className="exv2-node-side">
                  <span className={`xr-pill${PRACTICE_OK.has(n.readiness) ? ' is-good' : ''}`} title={readinessHint(n, l)} aria-describedby={`exv2-hint-${n.key}`}>{readinessLabel(n, l)}</span>
                  <span id={`exv2-hint-${n.key}`} className="sr-only">{readinessHint(n, l)}</span>
                  {n.hasChildren && <span aria-hidden className="exv2-chevron">›</span>}
                </span>
              </button>
            </li>
          ))}
          {nodes.length === 0 && <li className="ui-hint">{l['exv2.empty']}</li>}
        </ul>
      )}

      {level && !created && (level.description || levelChildren.some((c) => ASSESSES.has(c.type))) && (
        <section className="exv2-about" aria-labelledby="exv2-about-title">
          {level.description && (
            <>
              <h3 id="exv2-about-title" className="exv2-legend">{l['exv2.about.title']}</h3>
              <p className="ex-status-body">{level.description}</p>
            </>
          )}
          {levelChildren.some((c) => ASSESSES.has(c.type)) && (
            <>
              <h3 className="exv2-legend">{l['exv2.about.assesses']}</h3>
              <ul className="exv2-about-list">
                {levelChildren.filter((c) => ASSESSES.has(c.type)).map((c) => (
                  <li key={c.key}>{c.label}{c.facts?.weightPercent ? ` · ${String(c.facts.weightPercent).replace(/%$/, '')} %` : ''}</li>
                ))}
              </ul>
            </>
          )}
          <h3 className="exv2-legend">{l['exv2.about.practise']}</h3>
          <p className="ex-status-body">{level.modes.length ? level.modes.map((m) => l[`exv2.mode.${m}`]).join(' · ') : l['exv2.readinessHint.structureOnly']}</p>
          <h3 className="exv2-legend">{l['exv2.about.mock']}</h3>
          <p className="ex-status-body">
            {readinessLabel({ readiness: level.readiness ?? 'CATALOG_ONLY' }, l)} — {readinessHint({ readiness: level.readiness ?? 'CATALOG_ONLY' }, l)}
            {level.bank?.lengthCoveragePercent !== null && level.bank?.lengthCoveragePercent !== undefined && (level.readiness === 'REDUCED_MOCK_READY' || level.readiness === 'FULL_MOCK_READY') ? ` ${(l['exv2.about.coverage'] ?? '{n}').replace('{n}', String(level.bank.lengthCoveragePercent))}` : ''}
          </p>
        </section>
      )}

      {level && !created && (
        <div className="exv2-setup">
          <fieldset className="exv2-fieldset">
            <legend className="exv2-legend">{l['exv2.setup.components']}</legend>
            {level.componentsFixed && <p className="ui-hint">{l['exv2.setup.fullTest']}</p>}
            {level.components.map((c) => {
              const usable = mode === 'PRACTICE' ? PRACTICE_OK.has(c.readiness) : MOCK_OK.has(c.readiness);
              return (
              <label key={c.componentId} className={`xr-choice${picked.includes(c.componentId) ? ' is-checked' : ''}`}>
                <input type="checkbox" checked={picked.includes(c.componentId)} disabled={level.componentsFixed || !usable || (mode !== 'PRACTICE' && !!level.routes?.length)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, c.componentId] : p.filter((x) => x !== c.componentId)))} />
                <span aria-hidden />
                <span className="exv2-comp">
                  <span className="xr-choice-text">{c.name}</span>
                  <span className="exv2-node-facts">{[...factText(c.facts, l), c.untimed ? l['exv2.fact.untimed'] : null, !usable ? readinessLabel({ readiness: c.readiness }, l) : null].filter(Boolean).join(' · ')}</span>
                </span>
              </label>
              );
            })}
          </fieldset>

          <fieldset className="exv2-fieldset">
            <legend className="exv2-legend">{l['exv2.setup.mode']}</legend>
            <div className="exv2-modes">
              {level.modes.map((m) => (
                <label key={m} className={`exv2-mode${mode === m ? ' is-checked' : ''}`}>
                  <input
                    type="radio"
                    name="exv2-mode"
                    checked={mode === m}
                    onChange={() => {
                      setMode(m);
                      if (m !== 'PRACTICE' && level.routes?.length) {
                        const r = level.routes.find((x) => x.componentIds.every((id) => MOCK_OK.has(level.components.find((c) => c.componentId === id)?.readiness ?? '')));
                        setPicked(r ? r.componentIds : []);
                      }
                    }}
                  />
                  <span className="exv2-mode-name">{l[`exv2.mode.${m}`]}</span>
                  <span className="exv2-mode-desc">{l[`exv2.mode.${m}.desc`]}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {mode !== 'PRACTICE' && !!level.routes?.length && (
            <fieldset className="exv2-fieldset">
              <legend className="exv2-legend">{l['exv2.route.legend']}</legend>
              <p className="ui-hint">{l['exv2.route.hint']}</p>
              {level.routes.map((r, i) => {
                const usable = r.componentIds.every((id) => MOCK_OK.has(level.components.find((c) => c.componentId === id)?.readiness ?? ''));
                const checked = [...picked].sort().join() === [...r.componentIds].sort().join();
                return (
                  <label key={`${r.key}-${i}`} className={`xr-choice${checked ? ' is-checked' : ''}`}>
                    <input type="radio" name="exv2-route" checked={checked} disabled={!usable} onChange={() => setPicked(r.componentIds)} />
                    <span aria-hidden />
                    <span className="exv2-comp">
                      <span className="xr-choice-text">{l[`exv2.route.${r.key}`] ?? r.key}{r.stage ? ` · ${(l['exv2.route.stage'] ?? '{n}/{m}').replace('{n}', String(r.stage)).replace('{m}', String(r.stageCount))}` : ''}</span>
                      <span className="exv2-node-facts">{r.componentIds.map((id) => level.components.find((c) => c.componentId === id)?.name ?? '').join(' + ')}</span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
          )}

          {mode === 'PRACTICE' && (
            <div className="exv2-practice">
              <fieldset className="exv2-fieldset">
                <legend className="exv2-legend">{l['exv2.setup.level']}</legend>
                <div className="exv2-chips">
                  {(['AUTO', 'FOUNDATION', 'STANDARD', 'ADVANCED', 'CHALLENGE'] as Level[]).map((v) => (
                    <label key={v} className={`exv2-chip${practiceLevel === v ? ' is-checked' : ''}`}>
                      <input type="radio" name="exv2-level" checked={practiceLevel === v} onChange={() => setPracticeLevel(v)} />
                      <span>{l[`exv2.level.${v}`]}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {!allUntimed && (
                <label className="exv2-inline">
                  <input type="checkbox" checked={timed} onChange={(e) => setTimed(e.target.checked)} />
                  <span>{l['exv2.setup.timedPractice']}</span>
                </label>
              )}
            </div>
          )}
          {mode !== 'PRACTICE' && <p className="ui-hint">{allUntimed ? l['exv2.setup.untimedNote'] : l['exv2.setup.officialTiming']}</p>}
          {mode !== 'PRACTICE' && picked.length > 0 && (
            <div className="exv2-fidelity">
              <p className="exv2-fidelity-main">{l['exv2.setup.beforeStart']}</p>
              <ul className="exv2-reqs">
                {level.components.filter((c) => picked.includes(c.componentId)).map((c) => (
                  <li key={c.componentId}>
                    {[
                      c.name,
                      c.officialMinutes ? (l['exv2.setup.officialMinutes'] ?? '{n}').replace('{n}', String(c.officialMinutes)) : null,
                      c.plannedMinutes && !c.untimed ? (l['exv2.setup.plannedMinutes'] ?? '{n}').replace('{n}', String(c.plannedMinutes)) : null,
                      c.officialItems ? (l['exv2.fact.items'] ?? '{n}').replace('{n}', String(c.officialItems)) : c.officialMarks ? (l['exv2.fact.marks'] ?? '{n}').replace('{n}', String(c.officialMarks)) : null,
                      c.calculator ? l[`exv2.calculator.${c.calculator}`] : null,
                    ].filter(Boolean).join(' · ')}
                  </li>
                ))}
              </ul>
              <p className="ui-hint">{l['exv2.setup.rules']}</p>
            </div>
          )}

          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || picked.length === 0 || level.modes.length === 0 || (mode !== 'PRACTICE' && !!level.routes?.length && !level.routes.some((r) => [...r.componentIds].sort().join() === [...picked].sort().join()))}
            onClick={create}
          >
            {busy ? l['exv2.setup.creating'] : l['exv2.setup.create']}
          </button>
          {level.family === 'AICE' && (
            <p className="xr-next-actions">
              <a className="btn btn-ghost" href="/dashboard/exam-prep">{l['exv2.aice.viewPrep']}</a>
              <a className="btn btn-ghost" href="/dashboard/exams/aice">{l['exv2.aice.diplomaPlan']}</a>
            </p>
          )}
          {levelChildren.length > 0 && (
            <div className="exv2-fieldset">
              <p className="exv2-legend">{l['exv2.setup.narrower']}</p>
              <div className="exv2-chips">
                {levelChildren.map((c) => (
                  <button key={c.key} type="button" className="exv2-chip" disabled={!c.available} onClick={() => openNode(c)}>
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {created && <InstanceCard instance={created} labels={l} language={language} highlight />}
      {error && <p role="alert" className="xr-error">{error}</p>}
    </section>
  );
}
