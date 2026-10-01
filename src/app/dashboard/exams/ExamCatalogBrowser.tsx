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
  versioning: { curriculumVersion: string | null; firstAssessment: number | null; lastAssessment: number | null; syllabusCode: string | null; frameworkVersion: string | null };
  sources: Array<{ title: string; publisher: string | null; url: string | null; confidence: string }>;
}

interface LevelView {
  nodeKey: string;
  label: string;
  components: Array<{ componentId: string; nodeKey: string | null; name: string; facts: Record<string, string | number> | null; untimed: boolean; kind: string | null }>;
}

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

export function ExamCatalogBrowser({ labels: l, language }: { labels: L; language: string }) {
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
      setLevel(b.data.level);
      setPicked(b.data.level.components.map((c: LevelView['components'][number]) => c.componentId).slice(0, 1));
      setNodes(null);
      return;
    }
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
              <button type="button" className={`exv2-node${n.available ? '' : ' is-unavailable'}`} disabled={!n.available || (!n.hasChildren && !n.isExamLevel)} onClick={() => openNode(n)}>
                <span className="exv2-node-main">
                  <span className="exv2-node-label">{n.label}</span>
                  {(n.versioning.firstAssessment || n.versioning.syllabusCode) && (
                    <span className="exv2-node-version">
                      {[n.versioning.syllabusCode, n.versioning.firstAssessment ? (l['exv2.version.first'] ?? '{y}').replace('{y}', String(n.versioning.firstAssessment)) : null, n.versioning.lastAssessment ? (l['exv2.version.last'] ?? '{y}').replace('{y}', String(n.versioning.lastAssessment)) : null].filter(Boolean).join(' · ')}
                    </span>
                  )}
                  {factText(n.facts, l).length > 0 && <span className="exv2-node-facts">{factText(n.facts, l).join(' · ')}</span>}
                </span>
                {!n.available ? <span className="xr-pill">{l['exv2.notAvailable']}</span> : n.isExamLevel ? <span className="xr-pill is-good">{l['exv2.choose']}</span> : <span aria-hidden className="exv2-chevron">›</span>}
              </button>
            </li>
          ))}
          {nodes.length === 0 && <li className="ui-hint">{l['exv2.empty']}</li>}
        </ul>
      )}

      {level && !created && (
        <div className="exv2-setup">
          <fieldset className="exv2-fieldset">
            <legend className="exv2-legend">{l['exv2.setup.components']}</legend>
            {level.components.map((c) => (
              <label key={c.componentId} className={`xr-choice${picked.includes(c.componentId) ? ' is-checked' : ''}`}>
                <input type="checkbox" checked={picked.includes(c.componentId)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, c.componentId] : p.filter((x) => x !== c.componentId)))} />
                <span aria-hidden />
                <span className="exv2-comp">
                  <span className="xr-choice-text">{c.name}</span>
                  <span className="exv2-node-facts">{[...factText(c.facts, l), c.untimed ? l['exv2.fact.untimed'] : null].filter(Boolean).join(' · ')}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <fieldset className="exv2-fieldset">
            <legend className="exv2-legend">{l['exv2.setup.mode']}</legend>
            <div className="exv2-modes">
              {(['PRACTICE', 'MOCK', 'CHALLENGE'] as Mode[]).map((m) => (
                <label key={m} className={`exv2-mode${mode === m ? ' is-checked' : ''}`}>
                  <input type="radio" name="exv2-mode" checked={mode === m} onChange={() => setMode(m)} />
                  <span className="exv2-mode-name">{l[`exv2.mode.${m}`]}</span>
                  <span className="exv2-mode-desc">{l[`exv2.mode.${m}.desc`]}</span>
                </label>
              ))}
            </div>
          </fieldset>

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

          <button type="button" className="btn btn-primary" disabled={busy || picked.length === 0} onClick={create}>
            {busy ? l['exv2.setup.creating'] : l['exv2.setup.create']}
          </button>
        </div>
      )}

      {created && <InstanceCard instance={created} labels={l} language={language} highlight />}
      {error && <p role="alert" className="xr-error">{error}</p>}
    </section>
  );
}
