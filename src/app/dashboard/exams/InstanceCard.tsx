'use client';

/**
 * Exam V2 -- one exam instance: what it is (papers, mode), how faithful its
 * form is to the official paper, and the actions its state allows. Deleting
 * an instance that was started asks for an explicit in-page confirmation
 * (no browser dialog) and says what happens to the result.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

type L = Record<string, string>;

export interface InstanceView {
  id: string;
  mode: 'PRACTICE' | 'MOCK' | 'CHALLENGE';
  rigor: string;
  practiceLevel: string | null;
  timingMode: string;
  status: 'DRAFT' | 'READY' | 'IN_PROGRESS' | 'COMPLETED' | 'ARCHIVED' | 'DELETED';
  exam: { definitionName: string; family: string; versionLabel: string };
  components: Array<{ id: string; name: string }>;
  form: null | {
    fidelity: 'FULL' | 'REDUCED';
    coveragePercent: number;
    difficultyIndex: number | null;
    targetDifficulty: number;
    difficultyBandMet: boolean;
    notes: string[];
    positions: number;
    filled: number;
  };
  frozen: boolean;
  simulationAttemptId: string | null;
  createdAt: string;
  completedAt: string | null;
}

const fmt = (s: string, vars: Record<string, string | number>) => Object.entries(vars).reduce((acc, [k, v]) => acc.replace(`{${k}}`, String(v)), s);

export function InstanceCard({ instance: initial, labels: l, language, highlight = false }: { instance: InstanceView; labels: L; language: string; highlight?: boolean }) {
  const router = useRouter();
  const [instance, setInstance] = useState(initial);
  const [busy, setBusy] = useState<null | 'start' | 'retake' | 'delete'>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);

  async function post(url: string, body: unknown, kind: 'start' | 'retake') {
    setBusy(kind);
    setError(null);
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const b = await r.json().catch(() => null);
      if (!r.ok) {
        setError(l[`exv2.error.${b?.error}`] ?? l['exv2.error.generic']);
        return null;
      }
      return b.data.instance as InstanceView;
    } finally {
      setBusy(null);
    }
  }

  async function start() {
    const next = await post(`/api/exams/instances/${instance.id}/start`, { language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }, 'start');
    if (next?.simulationAttemptId) router.push(`/dashboard/exam-prep/attempt/${next.simulationAttemptId}`);
  }

  async function retake() {
    const next = await post(`/api/exams/instances/${instance.id}/retake`, {}, 'retake');
    if (next) {
      router.refresh();
      setInstance(next);
    }
  }

  async function remove() {
    const needsConfirm = instance.status === 'IN_PROGRESS' || instance.status === 'COMPLETED';
    if (needsConfirm && !confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setBusy('delete');
    setError(null);
    try {
      const r = await fetch(`/api/exams/instances/${instance.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: needsConfirm }) });
      if (!r.ok) {
        setError(l['exv2.error.generic']);
        return;
      }
      setGone(true);
      router.refresh();
    } finally {
      setBusy(null);
      setConfirmDelete(false);
    }
  }

  async function newMock() {
    const next = await post(`/api/exams/instances/${instance.id}/retake`, {}, 'retake');
    if (next) {
      setInstance(next);
      setGone(false);
      router.refresh();
    }
  }

  if (gone)
    return (
      <div className="card exv2-instance" role="status">
        <p className="ui-hint">{l['exv2.instance.deleted']}</p>
        <div className="xr-next-actions">
          <button type="button" className="btn btn-primary" onClick={newMock} disabled={busy !== null}>{instance.mode === 'PRACTICE' ? l['exv2.action.newPractice'] : l['exv2.action.newMock']}</button>
        </div>
        {error && <p role="alert" className="xr-error">{error}</p>}
      </div>
    );
  const f = instance.form;

  return (
    <article className={`card exv2-instance${highlight ? ' is-new' : ''}`}>
      <div className="exv2-instance-head">
        <div>
          <p className="xr-kicker">{l[`exv2.family.${instance.exam.family}`] ?? instance.exam.family}</p>
          <h3 className="exv2-instance-name">{instance.exam.definitionName}</h3>
          <p className="ex-card-meta">{instance.components.map((c) => c.name).join(' + ')}</p>
        </div>
        <div className="exv2-badges">
          <span className={`xr-pill${instance.mode === 'CHALLENGE' ? ' is-warn' : instance.mode === 'MOCK' ? ' is-good' : ''}`}>
            {instance.mode === 'MOCK' && instance.form ? l[instance.form.fidelity === 'FULL' ? 'exv2.mode.MOCK.full' : 'exv2.mode.MOCK.reduced'] : l[`exv2.mode.${instance.mode}`]}
          </span>
          <span className="xr-pill">{l[`exv2.status.${instance.status}`] ?? instance.status}</span>
        </div>
      </div>

      {instance.mode === 'CHALLENGE' && <p className="exv2-note is-warn">{l['exv2.challenge.label']}</p>}
      {instance.mode === 'PRACTICE' && instance.practiceLevel && <p className="ui-hint">{fmt(l['exv2.instance.level'], { level: l[`exv2.level.${instance.practiceLevel}`] ?? instance.practiceLevel })}</p>}
      {instance.frozen && <p className="ui-hint">{l['exv2.instance.frozen']}</p>}

      {f && (
        <div className="exv2-fidelity">
          <p className="exv2-fidelity-main">
            {f.fidelity === 'FULL' ? l['exv2.fidelity.full'] : fmt(l['exv2.fidelity.reduced'], { pct: f.coveragePercent, n: f.filled })}
          </p>
          {f.notes.includes('UNFILLED_POSITIONS') && <p className="ui-hint">{fmt(l['exv2.fidelity.unfilled'], { n: f.positions - f.filled })}</p>}
          {instance.mode !== 'PRACTICE' && (
            <p className="ui-hint">{!f.difficultyBandMet ? l['exv2.difficulty.bandNotMet'] : instance.mode === 'CHALLENGE' ? l['exv2.difficulty.challenge'] : l['exv2.difficulty.mock']}</p>
          )}
        </div>
      )}
      <p className="ui-hint">{fmt(l['exv2.origin.notice'], { framework: l[`exv2.family.${instance.exam.family}`] ?? instance.exam.family })}</p>

      {confirmDelete && (
        <div className="exv2-confirm" role="alertdialog" aria-labelledby={`exv2-del-${instance.id}`}>
          <p id={`exv2-del-${instance.id}`}>{instance.status === 'COMPLETED' ? l['exv2.delete.confirmCompleted'] : l['exv2.delete.confirmInProgress']}</p>
          <div className="xr-next-actions">
            <button type="button" className="btn btn-danger" onClick={remove} disabled={busy === 'delete'}>{l['exv2.delete.yes']}</button>
            <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>{l['exv2.delete.no']}</button>
          </div>
        </div>
      )}

      <div className="xr-next-actions">
        {instance.status === 'READY' && (
          <button type="button" className="btn btn-primary" onClick={start} disabled={busy !== null}>{busy === 'start' ? l['exv2.action.starting'] : l['exv2.action.start']}</button>
        )}
        {instance.status === 'IN_PROGRESS' && instance.simulationAttemptId && (
          <Link className="btn btn-primary" href={`/dashboard/exam-prep/attempt/${instance.simulationAttemptId}`}>{l['exv2.action.continue']}</Link>
        )}
        {instance.status === 'COMPLETED' && instance.simulationAttemptId && (
          <Link className="btn btn-primary" href={`/dashboard/exam-prep/attempt/${instance.simulationAttemptId}/result`}>{l['exv2.action.results']}</Link>
        )}
        {(instance.status === 'COMPLETED' || instance.status === 'ARCHIVED') && (
          <button type="button" className="btn" onClick={retake} disabled={busy !== null}>{l['exv2.action.retake']}</button>
        )}
        {!confirmDelete && (
          <button type="button" className="btn btn-ghost" onClick={remove} disabled={busy !== null}>{l['exv2.action.delete']}</button>
        )}
      </div>
      {error && <p role="alert" className="xr-error">{error}</p>}
    </article>
  );
}
