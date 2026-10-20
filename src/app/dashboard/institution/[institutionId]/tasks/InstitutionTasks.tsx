'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Track A -- institution tasks (coordinator): create with locked fields + delivery mode; edit its own due date (propagated, audited). */
type L = Record<string, string>;

async function send(url: string, method: string, body: unknown) {
  try {
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return r.ok;
  } catch {
    return false;
  }
}
const toIso = (local: string) => (local ? new Date(local).toISOString() : null);

export function CreateInstitutionTask({
  institutionId,
  classes,
  concepts,
  labels,
}: {
  institutionId: string;
  classes: Array<{ id: string; name: string; subjectId: string | null }>;
  concepts: Array<{ id: string; label: string; subjectId: string }>;
  labels: L;
}) {
  const router = useRouter();
  const [conceptId, setConceptId] = useState(concepts[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [period, setPeriod] = useState('');
  const [priority, setPriority] = useState('HIGH');
  const [required, setRequired] = useState(true);
  const [mode, setMode] = useState<'TEACHER_SELECTS_RECIPIENTS' | 'DIRECT_ALL_STUDENTS'>('TEACHER_SELECTS_RECIPIENTS');
  const [classIds, setClassIds] = useState<string[]>([]);
  const [state, setState] = useState<'idle' | 'busy' | 'saved' | 'error'>('idle');
  const [requestId, setRequestId] = useState(() => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : null));
  const subjectId = concepts.find((c) => c.id === conceptId)?.subjectId;
  const eligible = classes.filter((k) => k.subjectId === subjectId);
  return (
    <form
      className="ta-form ta-stack"
      style={{ gap: 'var(--space-2)' }}
      onSubmit={async (e) => {
        e.preventDefault();
        setState('busy');
        const ok = await send(`/api/institutions/${institutionId}/institution-assignments`, 'POST', {
          canonicalConceptId: conceptId,
          title: title.trim() || concepts.find((c) => c.id === conceptId)?.label,
          instructions: instructions.trim() || null,
          startsAt: toIso(startsAt),
          dueAt: toIso(dueAt),
          period: period.trim() || null,
          priority,
          required,
          deliveryMode: mode,
          classIds: classIds.filter((id) => eligible.some((k) => k.id === id)),
          requestId,
        });
        setState(ok ? 'saved' : 'error');
        if (ok) {
          setRequestId(typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : null);
          setTitle('');
          setInstructions('');
          setClassIds([]);
          router.refresh();
        }
      }}
    >
      <div className="ta-row">
        <label className="ta-field">
          <span>{labels.concept}</span>
          <select value={conceptId} onChange={(e) => { setConceptId(e.target.value); setClassIds([]); }}>
            {concepts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="ta-field">
          <span>{labels.titleField}</span>
          <input type="text" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
      </div>
      <label className="ta-field">
        <span>{labels.instructions}</span>
        <textarea maxLength={1000} rows={2} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
      </label>
      <div className="ta-row">
        <label className="ta-field">
          <span>{labels.startsAt}</span>
          <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        </label>
        <label className="ta-field">
          <span>{labels.dueAt}</span>
          <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
        </label>
        <label className="ta-field">
          <span>{labels.period}</span>
          <input type="text" maxLength={60} value={period} onChange={(e) => setPeriod(e.target.value)} />
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
      </div>
      <label className="ta-choice">
        <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> {labels.required}
      </label>
      <fieldset className="ta-choices">
        <legend>{labels.mode}</legend>
        {(['TEACHER_SELECTS_RECIPIENTS', 'DIRECT_ALL_STUDENTS'] as const).map((m) => (
          <label key={m} className="ta-choice">
            <input type="radio" name="task-mode" checked={mode === m} onChange={() => setMode(m)} /> {labels[`mode.${m}`]}
          </label>
        ))}
      </fieldset>
      <fieldset className="ta-choices">
        <legend>{labels.classes}</legend>
        {eligible.map((k) => (
          <label key={k.id} className="ta-choice">
            <input type="checkbox" checked={classIds.includes(k.id)} onChange={(e) => setClassIds((s) => (e.target.checked ? [...s, k.id] : s.filter((x) => x !== k.id)))} /> {k.name}
          </label>
        ))}
      </fieldset>
      <span className="ta-actions">
        <button type="submit" className="btn btn-primary" disabled={state === 'busy' || !conceptId || classIds.length === 0}>
          {labels.submit}
        </button>
      </span>
      {state === 'saved' && <span className="ta-msg" role="status">{labels.created}</span>}
      {state === 'error' && <span className="ta-msg" role="alert">{labels.error}</span>}
    </form>
  );
}

export function EditTaskDue({ institutionId, assignmentId, current, labels }: { institutionId: string; assignmentId: string; current: string | null; labels: L }) {
  const router = useRouter();
  const [value, setValue] = useState(current ? new Date(current).toISOString().slice(0, 16) : '');
  const [state, setState] = useState<'idle' | 'busy' | 'saved' | 'error'>('idle');
  return (
    <span className="ta-form ta-row" style={{ alignItems: 'flex-end' }}>
      <label className="ta-field">
        <span>{labels.editDue}</span>
        <input type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      <button
        type="button"
        className="btn btn-secondary"
        disabled={state === 'busy'}
        onClick={async () => {
          setState('busy');
          const ok = await send(`/api/institutions/${institutionId}/institution-assignments/${assignmentId}`, 'PATCH', { dueAt: toIso(value) });
          setState(ok ? 'saved' : 'error');
          if (ok) router.refresh();
        }}
      >
        {labels.save}
      </button>
      {state === 'saved' && <span className="ta-msg" role="status">{labels.saved}</span>}
      {state === 'error' && <span className="ta-msg" role="alert">{labels.error}</span>}
    </span>
  );
}
