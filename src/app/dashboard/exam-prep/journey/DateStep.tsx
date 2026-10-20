'use client';
/**
 * J3.4 -- the date step: ONE choice, then ONE input. It asks only for the missing
 * scheduling information -- never the exam, the level or the curriculum again.
 * Each choice writes its own field (Student-reported exam date / personal target date /
 * month), never an official session. Options that need the J3.2 columns are offered
 * only where the database has them. "Todavía no lo sé" writes nothing: the target stays valid.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type L = Record<string, string>;
type Choice = 'EXAM_DATE' | 'PERSONAL' | 'MONTH' | 'UNKNOWN';

export function DateStep({ profileId, labels: l, newFieldsAvailable, defaultOpen = true }: { profileId: string; labels: L; newFieldsAvailable: boolean; defaultOpen?: boolean }) {
  const router = useRouter();
  const [choice, setChoice] = useState<Choice | null>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choices: Choice[] = newFieldsAvailable ? ['EXAM_DATE', 'PERSONAL', 'MONTH', 'UNKNOWN'] : ['EXAM_DATE', 'UNKNOWN'];

  async function save() {
    if (!choice || choice === 'UNKNOWN' || !value) return;
    setBusy(true);
    setError(null);
    // The chosen fact replaces the Student's other own scheduling facts; nothing official is touched.
    const body =
      choice === 'EXAM_DATE'
        ? { examDate: value, ...(newFieldsAvailable ? { personalTargetDate: null, estimatedMonth: null } : {}) }
        : choice === 'PERSONAL'
          ? { personalTargetDate: value, estimatedMonth: null }
          : { estimatedMonth: value, personalTargetDate: null, examDate: null };
    try {
      const r = await fetch(`/api/exam-preparation/${profileId}/schedule`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const b = await r.json().catch(() => null);
      if (!r.ok) throw new Error(b?.error ?? 'error');
      router.refresh();
    } catch (e) {
      const code = (e as Error).message;
      setError(l[`jx.date.error.${code}`] ?? l['jx.date.error']);
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="ui-disclosure jx-date" id="jx-date" open={defaultOpen}>
      <summary className="jx-summary">{defaultOpen ? l['jx.date.ask.title'] : l['jx.date.change']}</summary>
      <div className="ui-disclosure-body">
        <p className="ui-hint">{l['jx.date.ask.lead']}</p>
        <fieldset className="jx-choices">
          <legend className="sr-only">{l['jx.date.ask.title']}</legend>
          {choices.map((c) => (
            <label key={c} className="jx-choice">
              <input type="radio" name={`jx-date-${profileId}`} value={c} checked={choice === c} onChange={() => { setChoice(c); setValue(''); setError(null); }} />
              <span>{l[`jx.date.opt.${c}`]}</span>
            </label>
          ))}
        </fieldset>
        {choice && choice !== 'UNKNOWN' ? (
          <div className="jx-date-input">
            <label>
              <span>{choice === 'MONTH' ? l['jx.date.input.month'] : l['jx.date.input.date']}</span>
              <input className="ui-input" type={choice === 'MONTH' ? 'month' : 'date'} value={value} onChange={(e) => setValue(e.target.value)} />
            </label>
            <button type="button" className="btn btn-primary prep-cta" disabled={busy || !value} onClick={save}>{busy ? l['jx.date.saving'] : l['jx.date.save']}</button>
          </div>
        ) : null}
        {choice === 'UNKNOWN' ? <p className="ui-hint" role="status">{l['jx.date.unknownNote']}</p> : null}
        {error ? <p className="ui-hint" role="alert">{error}</p> : null}
      </div>
    </details>
  );
}
