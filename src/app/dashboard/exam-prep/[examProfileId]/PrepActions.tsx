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

export interface ExamSessionChoice {
  /** Controlled options from the governed session catalogue ("ES:MAY:2027" -> "May 2027"). */
  options: Array<{ key: string; label: string }>;
  /** The stored session key, or null when none is chosen yet. */
  value: string | null;
}

/**
 * T1 final delta (C): an exam with governed sessions is configured with its SERIES + YEAR, asked right
 * after the exam is chosen. Shown until a session is saved; nothing else on the page is blocked by it.
 */
export function ExamSessionPrompt({ profileId, session, labels: l }: { profileId: string; session: ExamSessionChoice; labels: L }) {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle');
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!value) return;
    setState('busy');
    const r = await fetch(`/api/exam-preparation/${profileId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ examSession: value }) }).catch(() => null);
    if (r?.ok) router.refresh();
    setState(r?.ok ? 'idle' : 'error');
  }
  return (
    <form className="ui-form prep-session-prompt" onSubmit={save} data-session-required>
      <label className="ui-field">
        <span className="ui-label">{l['acp.goal.session']}</span>
        <select className="ui-select" value={value} onChange={(e) => setValue(e.target.value)} required>
          <option value="">{l['acp.goal.session.choose']}</option>
          {session.options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        <span className="ui-hint">{l['acp.goal.session.help']}</span>
      </label>
      <div className="ui-form-actions">
        <button className="btn btn-primary prep-cta" type="submit" disabled={state === 'busy' || !value} aria-busy={state === 'busy'}>{l['acp.goal.session.save']}</button>
        {state === 'error' ? <span className="ui-hint" role="alert">{l['prep.error']}</span> : null}
      </div>
    </form>
  );
}

/**
 * "Tu examen" (timing) apart from "Tu objetivo académico (opcional)" (aspiration).
 *   - governed sessions (IB, Cambridge): a controlled session, never a free date as the configuration;
 *   - every other exam: the Student's own exam date.
 * The aspiration is optional and never gates the preparation.
 */
export function GoalDetailsForm({ profileId, initial, session, areas, labels: l }: {
  profileId: string;
  initial: { examDate: string | null; targetInstitutionName: string | null; interestArea: string | null; interestAreaDetail: string | null };
  /** Non-null when the exam has governed sessions. */
  session: ExamSessionChoice | null;
  areas: Array<{ id: string; label: string }>;
  labels: L;
}) {
  const router = useRouter();
  const [examDate, setExamDate] = useState(initial.examDate ?? '');
  const [examSession, setExamSession] = useState(session?.value ?? '');
  const [institution, setInstitution] = useState(initial.targetInstitutionName ?? '');
  const [area, setArea] = useState(initial.interestArea ?? '');
  const [areaDetail, setAreaDetail] = useState(initial.interestAreaDetail ?? '');
  const [state, setState] = useState<'idle' | 'busy' | 'saved' | 'error'>('idle');
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setState('busy');
    const timing = session ? { examSession: examSession || null } : { examDate: examDate || null };
    const r = await fetch(`/api/exam-preparation/${profileId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...timing, targetInstitutionName: institution.trim() || null, interestArea: area || null, interestAreaDetail: area === 'OTHER' ? areaDetail.trim() || null : null }),
    }).catch(() => null);
    setState(r?.ok ? 'saved' : 'error');
    if (r?.ok) router.refresh();
  }
  const optional = <span className="ui-optional">({l['acp.goal.optional']})</span>;
  return (
    <form className="ui-form prep-goal-form" onSubmit={save}>
      <fieldset className="prep-goal-group" data-goal-exam>
        <legend className="ui-label">{l['acp.goal.exam.title']}</legend>
        {session ? (
          <label className="ui-field">
            <span className="ui-label">{l['acp.goal.session']}</span>
            <select className="ui-select" value={examSession} onChange={(e) => setExamSession(e.target.value)} data-exam-session>
              <option value="">{l['acp.goal.session.choose']}</option>
              {session.options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
            <span className="ui-hint">{l['acp.goal.session.help']}</span>
          </label>
        ) : (
          <label className="ui-field">
            <span className="ui-label">{l['acp.goal.examDate']} {optional}</span>
            <input className="ui-input" type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} />
          </label>
        )}
      </fieldset>
      <fieldset className="prep-goal-group" data-goal-aspiration>
        <legend className="ui-label">{l['acp.goal.aspiration.title']} {optional}</legend>
        <p className="ui-hint">{l['acp.goal.aspiration.lead']}</p>
        <div className="ui-form-grid">
          <label className="ui-field">
            <span className="ui-label">{l['acp.goal.institution']} {optional}</span>
            <input className="ui-input" maxLength={200} value={institution} onChange={(e) => setInstitution(e.target.value)} />
          </label>
          <label className="ui-field">
            <span className="ui-label">{l['acp.goal.area']} {optional}</span>
            <select className="ui-select" value={area} onChange={(e) => setArea(e.target.value)} data-interest-area>
              <option value="">{l['acp.goal.area.none']}</option>
              {areas.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </label>
          {area === 'OTHER' ? (
            <label className="ui-field">
              <span className="ui-label">{l['acp.goal.area.otherDetail']} {optional}</span>
              <input className="ui-input" maxLength={200} value={areaDetail} onChange={(e) => setAreaDetail(e.target.value)} data-interest-area-detail />
            </label>
          ) : null}
        </div>
      </fieldset>
      <div className="ui-form-actions">
        <button className="btn btn-secondary prep-cta" type="submit" disabled={state === 'busy'} aria-busy={state === 'busy'}>{l['prep.goal.save']}</button>
        {state === 'saved' ? <span className="ui-hint" role="status">{l['prep.goal.saved']}</span> : state === 'error' ? <span className="ui-hint" role="alert">{l['prep.error']}</span> : null}
      </div>
    </form>
  );
}
