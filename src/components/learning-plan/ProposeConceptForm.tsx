'use client';

import { useState } from 'react';

/**
 * Track A -- propose a concept that does not exist in the StudyUS catalog.
 * Nobody but catalog governance creates canonical concepts; the response
 * lists likely existing equivalents so an existing concept is reused.
 */

async function post(url: string, body: unknown): Promise<{ ok: boolean; data?: any }> {
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await r.json().catch(() => ({}));
    return { ok: r.ok, data: json?.data };
  } catch {
    return { ok: false };
  }
}

function fill(template: string, values: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (_, k) => values[k] ?? '');
}

export function ProposeConceptForm({
  endpoint,
  subjects,
  labels,
}: {
  endpoint: string;
  /** Optional subject picker (coordinators); a class's Teacher proposes within the class subject. */
  subjects?: Array<{ id: string; name: string }>;
  labels: { title: string; rationale: string; subject?: string; submit: string; done: string; candidates: string; error: string };
}) {
  const [subjectId, setSubjectId] = useState(subjects?.[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [rationale, setRationale] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [candidates, setCandidates] = useState<string[]>([]);
  return (
    <form
      className="ta-form ta-stack"
      style={{ gap: 'var(--space-2)' }}
      onSubmit={async (e) => {
        e.preventDefault();
        setState('busy');
        const r = await post(endpoint, { title, rationale: rationale.trim() || null, ...(subjects ? { canonicalSubjectId: subjectId || null } : {}) });
        if (!r.ok) return setState('error');
        setCandidates((r.data?.candidates ?? []).map((c: { name: string }) => c.name));
        setTitle('');
        setRationale('');
        setState('done');
      }}
    >
      {subjects && (
        <label className="ta-field">
          <span>{labels.subject}</span>
          <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="ta-field">
        <span>{labels.title}</span>
        <input type="text" required minLength={2} maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="ta-field">
        <span>{labels.rationale}</span>
        <textarea maxLength={2000} rows={2} value={rationale} onChange={(e) => setRationale(e.target.value)} />
      </label>
      <span className="ta-actions">
        <button type="submit" className="btn btn-secondary" disabled={state === 'busy' || title.trim().length < 2}>
          {labels.submit}
        </button>
      </span>
      {state === 'done' && (
        <span className="ta-msg" role="status">
          {labels.done}
          {candidates.length > 0 ? ` ${fill(labels.candidates, { list: candidates.join(', ') })}` : ''}
        </span>
      )}
      {state === 'error' && <span className="ta-msg" role="alert">{labels.error}</span>}
    </form>
  );
}
