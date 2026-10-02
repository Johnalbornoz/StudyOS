'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Track A -- client controls of the Class Learning Plan. Every write goes to
 * the class's Teacher-only routes (server re-checks teaching the class);
 * nothing here touches learner state.
 */

async function post(url: string, body: unknown): Promise<{ ok: boolean; data?: any; error?: string }> {
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
    const json = await r.json().catch(() => ({}));
    return { ok: r.ok, data: json?.data, error: json?.error };
  } catch {
    return { ok: false };
  }
}

export function AddToClassPlanButton({ classId, canonicalConceptId, label, errorLabel }: { classId: string; canonicalConceptId: string; label: string; errorLabel: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  return (
    <span className="ta-actions">
      <button
        type="button"
        className="btn btn-secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(false);
          const r = await post(`/api/teacher/classes/${classId}/plan`, { canonicalConceptId });
          setBusy(false);
          if (r.ok) router.refresh();
          else setError(true);
        }}
      >
        {label}
      </button>
      {error && <span role="alert" className="ta-msg">{errorLabel}</span>}
    </span>
  );
}

export function RemoveFromClassPlanButton({ classId, canonicalConceptId, label, confirmText, errorLabel }: { classId: string; canonicalConceptId: string; label: string; confirmText: string; errorLabel: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  return (
    <span className="ta-actions">
      <button
        type="button"
        className="btn btn-ghost"
        disabled={busy}
        onClick={async () => {
          if (!window.confirm(confirmText)) return;
          setBusy(true);
          setError(false);
          const r = await post(`/api/teacher/classes/${classId}/plan/${canonicalConceptId}/remove`, {});
          setBusy(false);
          if (r.ok) router.refresh();
          else setError(true);
        }}
      >
        {label}
      </button>
      {error && <span role="alert" className="ta-msg">{errorLabel}</span>}
    </span>
  );
}

export function ClassPlanConceptEditor({
  classId,
  canonicalConceptId,
  initial,
  labels,
}: {
  classId: string;
  canonicalConceptId: string;
  initial: { priority: 'HIGH' | 'NORMAL' | 'LOW'; targetDate: string | null; period: string | null; requiredForClass: boolean };
  labels: { priority: string; priorities: Record<'HIGH' | 'NORMAL' | 'LOW', string>; targetDate: string; period: string; required: string; save: string; saved: string; error: string };
}) {
  const router = useRouter();
  const [priority, setPriority] = useState(initial.priority);
  const [targetDate, setTargetDate] = useState(initial.targetDate ?? '');
  const [period, setPeriod] = useState(initial.period ?? '');
  const [required, setRequired] = useState(initial.requiredForClass);
  const [state, setState] = useState<'idle' | 'busy' | 'saved' | 'error'>('idle');
  return (
    <form
      className="ta-form ta-row"
      style={{ alignItems: 'flex-end' }}
      onSubmit={async (e) => {
        e.preventDefault();
        setState('busy');
        const r = await post(`/api/teacher/classes/${classId}/plan`, { canonicalConceptId, priority, targetDate: targetDate || null, period: period.trim() || null, requiredForClass: required });
        setState(r.ok ? 'saved' : 'error');
        if (r.ok) router.refresh();
      }}
    >
      <label className="ta-field">
        <span>{labels.priority}</span>
        <select value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>
          {(['HIGH', 'NORMAL', 'LOW'] as const).map((p) => (
            <option key={p} value={p}>
              {labels.priorities[p]}
            </option>
          ))}
        </select>
      </label>
      <label className="ta-field">
        <span>{labels.targetDate}</span>
        <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
      </label>
      <label className="ta-field">
        <span>{labels.period}</span>
        <input type="text" maxLength={60} value={period} onChange={(e) => setPeriod(e.target.value)} />
      </label>
      <label className="ta-choice">
        <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> {labels.required}
      </label>
      <button type="submit" className="btn btn-secondary" disabled={state === 'busy'}>
        {labels.save}
      </button>
      {state === 'saved' && <span className="ta-msg" role="status">{labels.saved}</span>}
      {state === 'error' && <span className="ta-msg" role="alert">{labels.error}</span>}
    </form>
  );
}

function fill(template: string, values: Record<string, number | string>) {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(values[k] ?? ''));
}

/**
 * Assign a concept to the whole class or to selected learners, after an
 * explicit preview (X have / Y will add / Z advanced). Learners who already
 * have it keep their state; nobody is reset.
 */
export function AssignConceptControl({
  classId,
  canonicalConceptId,
  learners,
  fixedStudentIds,
  labels,
}: {
  classId: string;
  canonicalConceptId: string;
  learners: Array<{ studentId: string; name: string }>;
  /** When set, the control assigns exactly these learners (detected needs: "Asignar a estos N"). */
  fixedStudentIds?: string[];
  labels: { assignAll: string; assignSelected: string; assignThese?: string; selectStudents: string; preview: string; confirm: string; cancel: string; assigning: string; done: string; error: string };
}) {
  const router = useRouter();
  const [mode, setMode] = useState<'idle' | 'select' | 'preview'>('idle');
  const [selected, setSelected] = useState<string[]>(fixedStudentIds ?? []);
  const [preview, setPreview] = useState<{ have: number; willAdd: number; advanced: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function loadPreview(ids: string[]) {
    setBusy(true);
    setMessage(null);
    try {
      const qs = new URLSearchParams({ canonicalConceptId });
      if (ids.length) qs.set('studentIds', ids.join(','));
      const r = await fetch(`/api/teacher/classes/${classId}/assignment-preview?${qs}`);
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error();
      setPreview(json.data);
      setMode('preview');
    } catch {
      setMessage(labels.error);
    } finally {
      setBusy(false);
    }
  }

  async function assign() {
    setBusy(true);
    const r = await post(`/api/teacher/classes/${classId}/plan/${canonicalConceptId}/assign`, { studentIds: selected.length ? selected : null });
    setBusy(false);
    if (!r.ok) return setMessage(labels.error);
    setMessage(fill(labels.done, { added: r.data.added, alreadyHad: r.data.alreadyHad }));
    setMode('idle');
    setPreview(null);
    router.refresh();
  }

  return (
    <div className="ta-form ta-stack" style={{ gap: 'var(--space-2)' }}>
      {mode === 'idle' && (
        <span className="ta-actions">
          {fixedStudentIds ? (
            <button type="button" className="btn btn-secondary" disabled={busy || learners.length === 0} onClick={() => loadPreview(fixedStudentIds)}>
              {labels.assignThese}
            </button>
          ) : (
            <>
              <button type="button" className="btn btn-secondary" disabled={busy || learners.length === 0} onClick={() => { setSelected([]); loadPreview([]); }}>
                {labels.assignAll}
              </button>
              <button type="button" className="btn btn-ghost" disabled={busy || learners.length === 0} onClick={() => setMode('select')}>
                {labels.assignSelected}
              </button>
            </>
          )}
        </span>
      )}
      {mode === 'select' && (
        <fieldset className="ta-choices">
          <legend>{labels.selectStudents}</legend>
          {learners.map((l) => (
            <label key={l.studentId} className="ta-choice">
              <input
                type="checkbox"
                checked={selected.includes(l.studentId)}
                onChange={(e) => setSelected((s) => (e.target.checked ? [...s, l.studentId] : s.filter((x) => x !== l.studentId)))}
              />{' '}
              {l.name}
            </label>
          ))}
          <span className="ta-actions">
            <button type="button" className="btn btn-secondary" disabled={busy || selected.length === 0} onClick={() => loadPreview(selected)}>
              {labels.assignSelected}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setMode('idle')}>
              {labels.cancel}
            </button>
          </span>
        </fieldset>
      )}
      {mode === 'preview' && preview && (
        <div className="ta-stack" style={{ gap: 'var(--space-1)' }}>
          <span className="ta-msg" role="status">{fill(labels.preview, preview)}</span>
          <span className="ta-actions">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={assign}>
              {busy ? labels.assigning : labels.confirm}
            </button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => { setMode('idle'); setPreview(null); }}>
              {labels.cancel}
            </button>
          </span>
        </div>
      )}
      {message && <span className="ta-msg" role="status">{message}</span>}
    </div>
  );
}
