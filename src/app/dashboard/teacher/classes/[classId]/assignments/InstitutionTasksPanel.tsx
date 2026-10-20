'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Track A -- the Teacher's view of institution tasks: every institution field
 * is read-only with "Definido por …"; the only action is choosing recipients
 * (whole class or selected ACTIVE learners) when the institution delegated it.
 * The server enforces the same locks.
 */
type L = Record<string, string>;
function fill(template: string, values: Record<string, string | number>) {
  return template
    .replace(/\{(\w+):([^|{}]*)\|([^{}]*)\}/g, (_m, k: string, one: string, other: string) => (Number(values[k]) === 1 ? one : other))
    .replace(/\{(\w+)\}/g, (_m, k: string) => String(values[k] ?? ''));
}
async function send(url: string, method: string, body: unknown) {
  try {
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, data: j?.data };
  } catch {
    return { ok: false, data: null };
  }
}

export interface TeacherInstitutionTask {
  id: string;
  title: string;
  conceptLabel: string;
  instructions: string | null;
  startsAt: string | null;
  dueAt: string | null;
  period: string | null;
  priority: string;
  required: boolean;
  deliveryMode: 'TEACHER_SELECTS_RECIPIENTS' | 'DIRECT_ALL_STUDENTS';
  recipientIds: string[];
}

export function InstitutionTaskCard({
  classId,
  task,
  learners,
  institutionName,
  locale,
  labels,
}: {
  classId: string;
  task: TeacherInstitutionTask;
  learners: Array<{ studentId: string; name: string }>;
  institutionName: string;
  locale: string;
  labels: L;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<'idle' | 'select'>('idle');
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  const pending = learners.filter((l) => !task.recipientIds.includes(l.studentId));
  const lockedBy = fill(labels.badge, { institution: institutionName });

  async function assign(studentIds: string[] | null) {
    setBusy(true);
    const r = await send(`/api/teacher/classes/${classId}/institution-assignments/${task.id}/recipients`, 'POST', studentIds ? { studentIds } : {});
    setBusy(false);
    if (!r.ok) return setMessage({ text: labels.error, error: true });
    setMessage({ text: fill(labels.assigned, { n: r.data?.assigned?.length ?? 0 }) });
    setMode('idle');
    setSelected([]);
    router.refresh();
  }

  return (
    <article className="card ta-card cur2-institution-task" aria-label={task.title} data-institution-task={task.id}>
      <div className="ta-coordinator">
        <strong>{task.title}</strong>
        <span className="chip chip-warn">🔒 {labels.institutionTask}</span>
      </div>
      <p className="ta-msg">{task.deliveryMode === 'DIRECT_ALL_STUDENTS' ? labels.explainDirect : labels.explain}</p>
      <dl className="ta-facts">
        <dt>{labels.concept}</dt>
        <dd>{task.conceptLabel}</dd>
        <dt>{labels.startsAt}</dt>
        <dd>
          {fmt(task.startsAt)} <span className="ta-msg">🔒 {lockedBy}</span>
        </dd>
        <dt>{labels.dueAt}</dt>
        <dd data-locked-due>
          {fmt(task.dueAt)} <span className="ta-msg">🔒 {labels.date} · {lockedBy}</span>
        </dd>
        <dt>{labels.priority}</dt>
        <dd>
          {labels[`priority.${task.priority}`]}
          {task.required ? ` · ${labels.required}` : ''}
          {task.period ? ` · ${task.period}` : ''}
        </dd>
        {task.instructions && (
          <>
            <dt>{labels.instructions}</dt>
            <dd>{task.instructions}</dd>
          </>
        )}
      </dl>
      <p className="ta-msg">{fill(labels.already, { n: task.recipientIds.length })}</p>
      {task.deliveryMode === 'TEACHER_SELECTS_RECIPIENTS' && pending.length > 0 && (
        <div className="ta-form ta-stack" style={{ gap: 'var(--space-2)' }}>
          {mode === 'idle' ? (
            <span className="ta-actions">
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => assign(null)}>
                {labels.assignAll}
              </button>
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setMode('select')}>
                {labels.assignSelected}
              </button>
            </span>
          ) : (
            <fieldset className="ta-choices">
              <legend>{labels.assignSelected}</legend>
              {pending.map((l) => (
                <label key={l.studentId} className="ta-choice">
                  <input type="checkbox" checked={selected.includes(l.studentId)} onChange={(e) => setSelected((s) => (e.target.checked ? [...s, l.studentId] : s.filter((x) => x !== l.studentId)))} /> {l.name}
                </label>
              ))}
              <span className="ta-actions">
                <button type="button" className="btn btn-primary" disabled={busy || selected.length === 0} onClick={() => assign(selected)}>
                  {labels.assignSelected}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setMode('idle')}>
                  {labels.cancel}
                </button>
              </span>
            </fieldset>
          )}
        </div>
      )}
      {message && (
        <span className="ta-msg" role={message.error ? 'alert' : 'status'}>
          {message.text}
        </span>
      )}
    </article>
  );
}

/** The Teacher's own task: due date stays editable (institution tasks never reach this control). */
export function EditOwnTaskDue({ classId, groupId, current, labels }: { classId: string; groupId: string; current: string | null; labels: L }) {
  const router = useRouter();
  const [value, setValue] = useState(current ? new Date(current).toISOString().slice(0, 16) : '');
  const [state, setState] = useState<'idle' | 'busy' | 'saved' | 'error'>('idle');
  return (
    <span className="ta-form ta-row" style={{ alignItems: 'flex-end' }}>
      <label className="ta-field">
        <span>{labels.editOwn}</span>
        <input type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      <button
        type="button"
        className="btn btn-secondary"
        disabled={state === 'busy'}
        onClick={async () => {
          setState('busy');
          const r = await send(`/api/teacher/classes/${classId}/assignments/${groupId}`, 'PATCH', { dueAt: value ? new Date(value).toISOString() : null });
          setState(r.ok ? 'saved' : 'error');
          if (r.ok) router.refresh();
        }}
      >
        {labels.save}
      </button>
      {state === 'saved' && <span className="ta-msg" role="status">{labels.ownSaved}</span>}
      {state === 'error' && <span className="ta-msg" role="alert">{labels.error}</span>}
    </span>
  );
}
