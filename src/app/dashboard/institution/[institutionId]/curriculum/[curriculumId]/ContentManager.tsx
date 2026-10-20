'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { fill } from '../CurriculumManager';

/**
 * Track A -- curriculum content management (coordinator): multi-select
 * objectives / concepts and apply include / exclude / status in bulk; add a
 * catalog concept; set institution target dates; put locked content into a
 * class plan. Server re-validates scope and records the audit trail.
 */
type L = Record<string, string>;
const CLASSES = ['REQUIRED', 'RECOMMENDED', 'OPTIONAL', 'SUPPLEMENTAL'] as const;

async function post(url: string, body: unknown) {
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return r.ok;
  } catch {
    return false;
  }
}

function BulkBar({ count, onApply, labels, busy }: { count: number; onApply: (patch: { status?: 'INCLUDED' | 'EXCLUDED'; classification?: string }) => void; labels: L; busy: boolean }) {
  return (
    <div className="ta-actions cur2-bulk" role="toolbar" aria-label={labels.selected}>
      <span className="ta-msg">{fill(labels.selected, { n: count })}</span>
      <button type="button" className="btn btn-secondary" disabled={busy || count === 0} onClick={() => onApply({ status: 'INCLUDED' })}>
        {labels.include}
      </button>
      <button type="button" className="btn btn-ghost" disabled={busy || count === 0} onClick={() => onApply({ status: 'EXCLUDED' })}>
        {labels.exclude}
      </button>
      {CLASSES.map((c) => (
        <button key={c} type="button" className="btn btn-ghost" disabled={busy || count === 0} onClick={() => onApply({ classification: c })}>
          {labels[c]}
        </button>
      ))}
    </div>
  );
}

export function ObjectivesManager({
  institutionId,
  curriculumId,
  topics,
  labels,
  readOnly,
}: {
  institutionId: string;
  curriculumId: string;
  topics: Array<{ key: string; label: string; objectives: Array<{ id: string; code: string | null; description: string; node: string; status: string; classification: string; concepts: Array<{ id: string; label: string }> }> }>;
  labels: L;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const all = topics.flatMap((t) => t.objectives.map((o) => o.id));
  async function apply(patch: { status?: 'INCLUDED' | 'EXCLUDED'; classification?: string }) {
    setBusy(true);
    setError(false);
    const ok = await post(`/api/institutions/${institutionId}/curriculum/subjects/${curriculumId}/content`, { objectives: selected.map((id) => ({ learningObjectiveId: id, ...patch })) });
    setBusy(false);
    if (!ok) return setError(true);
    setSelected([]);
    router.refresh();
  }
  return (
    <div className="ta-stack" style={{ gap: 'var(--space-3)' }}>
      {!readOnly && (
        <>
          <label className="ta-choice">
            <input type="checkbox" checked={selected.length === all.length && all.length > 0} onChange={(e) => setSelected(e.target.checked ? all : [])} /> {labels.selectAll}
          </label>
          <BulkBar count={selected.length} onApply={apply} labels={labels} busy={busy} />
        </>
      )}
      {error && (
        <p className="ta-msg" role="alert">
          {labels.error}
        </p>
      )}
      {topics.map((t) => (
        <section key={t.key} className="ta-stack" style={{ gap: 'var(--space-1)' }} aria-label={t.label} data-topic={t.key}>
          <h3 style={{ fontSize: 15 }}>{t.label}</h3>
          <ul className="role-list">
            {t.objectives.map((o) => (
              <li key={o.id} className={`cur2-objective${o.status === 'EXCLUDED' ? ' cur2-excluded' : ''}`} data-objective={o.id} data-status={o.status} data-classification={o.classification}>
                <label className="ta-choice" style={{ alignItems: 'flex-start' }}>
                  {!readOnly && (
                    <input type="checkbox" checked={selected.includes(o.id)} onChange={(e) => setSelected((s) => (e.target.checked ? [...s, o.id] : s.filter((x) => x !== o.id)))} aria-label={o.code ?? o.description} />
                  )}
                  <span>
                    {o.code && <strong>{o.code} · </strong>}
                    {o.description}
                    <span className="ta-msg" style={{ display: 'block' }}>
                      {o.node !== t.label ? `${o.node} · ` : ''}
                      {o.concepts.length ? o.concepts.map((c) => c.label).join(', ') : labels.noConcept}
                    </span>
                  </span>
                </label>
                <span className="ta-actions">
                  <span className={o.status === 'EXCLUDED' ? 'chip' : o.classification === 'REQUIRED' ? 'chip chip-warn' : 'chip chip-good'}>{o.status === 'EXCLUDED' ? labels.excluded : labels[o.classification]}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function ConceptsManager({
  institutionId,
  curriculumId,
  concepts,
  addable,
  labels,
  readOnly,
}: {
  institutionId: string;
  curriculumId: string;
  concepts: Array<{ id: string; label: string; status: string; classification: string; source: string; institutionTargetDate: string | null; period: string | null }>;
  addable: Array<{ id: string; label: string }>;
  labels: L;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [toAdd, setToAdd] = useState(addable[0]?.id ?? '');
  const [addClass, setAddClass] = useState('RECOMMENDED');
  const endpoint = `/api/institutions/${institutionId}/curriculum/subjects/${curriculumId}/content`;
  async function run(body: unknown) {
    setBusy(true);
    setError(false);
    const ok = await post(endpoint, body);
    setBusy(false);
    if (!ok) return setError(true);
    setSelected([]);
    router.refresh();
  }
  return (
    <div className="ta-stack" style={{ gap: 'var(--space-3)' }}>
      {!readOnly && <BulkBar count={selected.length} onApply={(patch) => run({ concepts: selected.map((id) => ({ canonicalConceptId: id, ...patch })) })} labels={labels} busy={busy} />}
      {error && (
        <p className="ta-msg" role="alert">
          {labels.error}
        </p>
      )}
      <ul className="role-list">
        {concepts.map((c) => (
          <li key={c.id} className={`ta-coordinator${c.status === 'EXCLUDED' ? ' cur2-excluded' : ''}`} data-concept={c.id} data-status={c.status} data-classification={c.classification}>
            <label className="ta-choice">
              {!readOnly && <input type="checkbox" checked={selected.includes(c.id)} onChange={(e) => setSelected((s) => (e.target.checked ? [...s, c.id] : s.filter((x) => x !== c.id)))} aria-label={c.label} />}
              <span>
                <strong>{c.label}</strong> <span className="chip">{labels[`source.${c.source}`]}</span>
              </span>
            </label>
            <span className="ta-actions">
              <span className={c.status === 'EXCLUDED' ? 'chip' : c.classification === 'REQUIRED' ? 'chip chip-warn' : 'chip chip-good'}>{c.status === 'EXCLUDED' ? labels.excluded : labels[c.classification]}</span>
              {!readOnly && c.status !== 'EXCLUDED' && (
                <label className="ta-field ta-form">
                  <span>{labels.targetDate}</span>
                  <input type="date" defaultValue={c.institutionTargetDate ?? ''} onBlur={(e) => e.target.value !== (c.institutionTargetDate ?? '') && run({ concepts: [{ canonicalConceptId: c.id, institutionTargetDate: e.target.value || null }] })} />
                </label>
              )}
            </span>
          </li>
        ))}
      </ul>
      {!readOnly && addable.length > 0 && (
        <div className="ta-form ta-row" style={{ alignItems: 'flex-end' }}>
          <label className="ta-field">
            <span>{labels.addConcept}</span>
            <select value={toAdd} onChange={(e) => setToAdd(e.target.value)}>
              {addable.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <label className="ta-field">
            <span>{labels.classification}</span>
            <select value={addClass} onChange={(e) => setAddClass(e.target.value)}>
              {CLASSES.map((c) => (
                <option key={c} value={c}>
                  {labels[c]}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn btn-secondary" disabled={busy || !toAdd} onClick={() => run({ concepts: [{ canonicalConceptId: toAdd, status: 'INCLUDED', classification: addClass }] })}>
            {labels.add}
          </button>
        </div>
      )}
    </div>
  );
}

export function InstitutionPlanForm({ institutionId, classes, concepts, labels }: { institutionId: string; classes: Array<{ id: string; name: string }>; concepts: Array<{ id: string; label: string }>; labels: L }) {
  const router = useRouter();
  const [classId, setClassId] = useState(classes[0]?.id ?? '');
  const [conceptId, setConceptId] = useState(concepts[0]?.id ?? '');
  const [priority, setPriority] = useState('HIGH');
  const [date, setDate] = useState('');
  const [period, setPeriod] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'saved' | 'error'>('idle');
  return (
    <form
      className="ta-form ta-row"
      style={{ alignItems: 'flex-end' }}
      onSubmit={async (e) => {
        e.preventDefault();
        setState('busy');
        const ok = await post(`/api/institutions/${institutionId}/classes/${classId}/plan`, { canonicalConceptId: conceptId, priority, institutionTargetDate: date || null, period: period.trim() || null, required: true });
        setState(ok ? 'saved' : 'error');
        if (ok) router.refresh();
      }}
    >
      <label className="ta-field">
        <span>{labels.class}</span>
        <select value={classId} onChange={(e) => setClassId(e.target.value)}>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="ta-field">
        <span>{labels.concept}</span>
        <select value={conceptId} onChange={(e) => setConceptId(e.target.value)}>
          {concepts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <label className="ta-field">
        <span>{labels.priority}</span>
        <select value={priority} onChange={(e) => setPriority(e.target.value)}>
          {['HIGH', 'NORMAL', 'LOW'].map((p) => (
            <option key={p} value={p}>
              {labels[`priority.${p}`]}
            </option>
          ))}
        </select>
      </label>
      <label className="ta-field">
        <span>{labels.targetDate}</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className="ta-field">
        <span>{labels.period}</span>
        <input type="text" maxLength={60} value={period} onChange={(e) => setPeriod(e.target.value)} />
      </label>
      <button type="submit" className="btn btn-primary" disabled={state === 'busy' || !classId || !conceptId}>
        {labels.submit}
      </button>
      {state === 'saved' && <span className="ta-msg" role="status">{labels.saved}</span>}
      {state === 'error' && <span className="ta-msg" role="alert">{labels.error}</span>}
    </form>
  );
}
