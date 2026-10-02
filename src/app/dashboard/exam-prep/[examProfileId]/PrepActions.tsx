'use client';

/**
 * Preparation home -- the few actions that write: "Añadir a mi plan" for ONE
 * requirement concept, "Diagnosticar mi preparación" and the goal details.
 * Each goes to a server route that re-checks ownership and capabilities.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

type L = Record<string, string>;

export function AddConceptButton({ profileId, learningObjectiveId, canonicalConceptId, language, label, labels: l }: { profileId: string; learningObjectiveId: string; canonicalConceptId: string; language: string; label: string; labels: L }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [href, setHref] = useState<string | null>(null);
  const [already, setAlready] = useState(false);
  async function add() {
    if (state === 'busy') return;
    setState('busy');
    const r = await fetch(`/api/exam-preparation/${profileId}/concepts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ learningObjectiveId, canonicalConceptId, language }) }).catch(() => null);
    const b = r ? await r.json().catch(() => null) : null;
    if (!r?.ok || !b?.data?.href) {
      setState('error');
      return;
    }
    setHref(b.data.href);
    setAlready(!!b.data.alreadyStudying);
    setState('done');
    router.refresh();
  }
  if (state === 'done' && href) {
    return (
      <span className="prep-action-done">
        <span className="xr-pill is-good">{already ? l['prep.action.alreadyWorking'] : l['prep.action.added']}</span>
        <Link className="btn btn-secondary prep-cta" href={href}>{l['prep.action.CONTINUE_CONCEPT']}</Link>
      </span>
    );
  }
  return (
    <span className="prep-action-done">
      <button type="button" className="btn btn-primary prep-cta" onClick={add} disabled={state === 'busy'} aria-busy={state === 'busy'} aria-label={`${l['prep.action.ADD_TO_PLAN']}: ${label}`}>
        {l['prep.action.ADD_TO_PLAN']}
      </button>
      {state === 'error' ? <span className="ui-hint" role="alert">{l['prep.error']}</span> : null}
    </span>
  );
}

export function DiagnosticButton({ profileId, language, labels: l, primary = true }: { profileId: string; language: string; labels: L; primary?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function go() {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      const r = await fetch(`/api/exam-preparation/${profileId}/diagnostic`, { method: 'POST' });
      const b = await r.json().catch(() => null);
      if (!r.ok || !b?.data?.instanceId) throw new Error();
      let attemptId: string | null = b.data.simulationAttemptId;
      if (!attemptId) {
        const s = await fetch(`/api/exams/instances/${b.data.instanceId}/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }) });
        const sb = await s.json().catch(() => null);
        attemptId = sb?.data?.instance?.simulationAttemptId ?? null;
      }
      if (!attemptId) throw new Error();
      router.push(`/dashboard/exam-prep/attempt/${attemptId}`);
    } catch {
      setError(true);
      setBusy(false);
    }
  }
  return (
    <span className="prep-action-done">
      <button type="button" className={primary ? 'btn btn-primary prep-cta' : 'btn btn-secondary prep-cta'} onClick={go} disabled={busy} aria-busy={busy}>
        {busy ? l['prep.diag.starting'] : l['prep.action.DIAGNOSTIC']}
      </button>
      {error ? <span className="ui-hint" role="alert">{l['prep.error']}</span> : null}
    </span>
  );
}

export function GoalDetailsForm({ profileId, initial, labels: l }: { profileId: string; initial: { examDate: string | null; targetInstitutionName: string | null; targetQualification: string | null }; labels: L }) {
  const router = useRouter();
  const [examDate, setExamDate] = useState(initial.examDate ?? '');
  const [institution, setInstitution] = useState(initial.targetInstitutionName ?? '');
  const [qualification, setQualification] = useState(initial.targetQualification ?? '');
  const [state, setState] = useState<'idle' | 'busy' | 'saved' | 'error'>('idle');
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setState('busy');
    const r = await fetch(`/api/exam-preparation/${profileId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ examDate: examDate || null, targetInstitutionName: institution.trim() || null, targetQualification: qualification.trim() || null }),
    }).catch(() => null);
    setState(r?.ok ? 'saved' : 'error');
    if (r?.ok) router.refresh();
  }
  return (
    <form className="ui-form prep-goal-form" onSubmit={save}>
      <div className="ui-form-grid">
        <label className="ui-field">
          <span className="ui-label">{l['prep.goal.date']} <span className="ui-optional">({l['prep.goal.optional']})</span></span>
          <input className="ui-input" type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} />
        </label>
        <label className="ui-field">
          <span className="ui-label">{l['prep.goal.institution']} <span className="ui-optional">({l['prep.goal.optional']})</span></span>
          <input className="ui-input" maxLength={200} value={institution} onChange={(e) => setInstitution(e.target.value)} />
        </label>
        <label className="ui-field">
          <span className="ui-label">{l['prep.goal.qualification']} <span className="ui-optional">({l['prep.goal.optional']})</span></span>
          <input className="ui-input" maxLength={200} value={qualification} onChange={(e) => setQualification(e.target.value)} />
        </label>
      </div>
      <div className="ui-form-actions">
        <button className="btn btn-secondary prep-cta" type="submit" disabled={state === 'busy'} aria-busy={state === 'busy'}>{l['prep.goal.save']}</button>
        {state === 'saved' ? <span className="ui-hint" role="status">{l['prep.goal.saved']}</span> : state === 'error' ? <span className="ui-hint" role="alert">{l['prep.error']}</span> : null}
      </div>
    </form>
  );
}
