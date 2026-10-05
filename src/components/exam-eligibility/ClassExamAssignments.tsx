'use client';

/**
 * Exam eligibility -- the class's explicit exam / assessment assignments.
 * Used by the Institution Admin class page and the Teacher class page (each
 * passes its own API base; the server enforces scope and governance). The
 * options offered are only those the class may receive: its curriculum's
 * exams plus assessments outside the curriculum. Hidden when the actor may
 * not manage them (403 from the API).
 */
import { useCallback, useEffect, useState } from 'react';

type L = Record<string, string>;

interface Assignment { id: string; objectiveKey: string; label: string; framework: string | null; assignedByScope: 'INSTITUTION' | 'TEACHER' }
interface Assignable { key: string; label: string; framework: string; kind: string }
interface Data { className: string; curriculum: string | null; assignments: Assignment[]; assignable: Assignable[] }

export function ClassExamAssignments({ apiBase, labels: l }: { apiBase: string; labels: L }) {
  const [data, setData] = useState<Data | null>(null);
  const [hidden, setHidden] = useState(false);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(apiBase, { cache: 'no-store' }).catch(() => null);
    if (!r || r.status === 403 || r.status === 404) return setHidden(true);
    const b = await r.json().catch(() => null);
    if (b?.data) setData(b.data);
  }, [apiBase]);

  useEffect(() => {
    void load();
  }, [load]);

  async function send(url: string, init: RequestInit, okText: string) {
    setBusy(true);
    setMessage(null);
    try {
      const r = await fetch(url, init);
      const b = await r.json().catch(() => null);
      if (!r.ok) throw new Error(b?.error ?? 'generic');
      setMessage({ text: okText, error: false });
      setSelected('');
      await load();
    } catch (e) {
      const code = e instanceof Error ? e.message : 'generic';
      setMessage({ text: l[`elig.assign.error.${code}`] ?? l['elig.assign.error.generic'], error: true });
    } finally {
      setBusy(false);
    }
  }

  if (hidden) return null;

  const groups = new Map<string, Assignable[]>();
  for (const a of data?.assignable ?? []) groups.set(a.framework, [...(groups.get(a.framework) ?? []), a]);

  return (
    <section className="card ta-card" aria-labelledby="class-exams-title" data-class-exam-assignments>
      <h2 id="class-exams-title">{l['elig.assign.title']}</h2>
      <p className="ta-msg">{l['elig.assign.lead']}</p>
      {!data ? (
        <p className="ta-msg">{l['elig.assign.loading']}</p>
      ) : (
        <>
          <p className="ta-msg">{data.curriculum ? l['elig.assign.curriculum'].replace('{curriculum}', data.curriculum) : l['elig.assign.noCurriculum']}</p>
          {data.assignments.length === 0 ? (
            <p className="ta-msg">{l['elig.assign.none']}</p>
          ) : (
            <ul className="role-list">
              {data.assignments.map((a) => (
                <li key={a.id} className="elig-assign-row">
                  <span className="elig-assign-name">
                    <strong>{a.label}</strong>
                    <span className="ta-msg">{[a.framework ? l[`prep.fw.${a.framework}`] : null, l[`elig.assign.by.${a.assignedByScope}`]].filter(Boolean).join(' · ')}</span>
                  </span>
                  <button type="button" className="btn btn-secondary prep-cta" disabled={busy} onClick={() => send(`${apiBase}/${a.id}`, { method: 'DELETE' }, l['elig.assign.removed'])} aria-label={`${l['elig.assign.remove']}: ${a.label}`}>
                    {l['elig.assign.remove']}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {data.assignable.length > 0 ? (
            <form
              className="elig-assign-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (selected) void send(apiBase, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ objectiveKey: selected }) }, l['elig.assign.added']);
              }}
            >
              <label className="ui-field">
                <span className="ui-label">{l['elig.assign.select']}</span>
                <select className="ui-input" value={selected} onChange={(e) => setSelected(e.target.value)} disabled={busy}>
                  <option value="">{l['elig.assign.choose']}</option>
                  {[...groups.entries()].map(([framework, list]) => (
                    <optgroup key={framework} label={l[`prep.fw.${framework}`] ?? framework}>
                      {list.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                    </optgroup>
                  ))}
                </select>
              </label>
              <button type="submit" className="btn btn-primary prep-cta" disabled={busy || !selected}>{l['elig.assign.add']}</button>
            </form>
          ) : null}
          {message ? <p className={message.error ? 'ta-msg ta-msg-error' : 'ta-msg'} role={message.error ? 'alert' : 'status'}>{message.text}</p> : null}
        </>
      )}
    </section>
  );
}
