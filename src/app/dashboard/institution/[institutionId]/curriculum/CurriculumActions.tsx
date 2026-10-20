'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Track A -- Institution Curriculum controls (coordinators only; every route
 * re-checks INSTITUTION_ADMIN of this institution). The global catalog is
 * never modified here and no learner state is touched.
 */

type Classification = 'REQUIRED' | 'RECOMMENDED' | 'OPTIONAL' | 'SUPPLEMENTAL';
const CLASSIFICATIONS: Classification[] = ['REQUIRED', 'RECOMMENDED', 'OPTIONAL', 'SUPPLEMENTAL'];

async function post(url: string, body: unknown): Promise<{ ok: boolean; data?: any; error?: string }> {
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
    const json = await r.json().catch(() => ({}));
    return { ok: r.ok, data: json?.data, error: json?.error };
  } catch {
    return { ok: false };
  }
}

export function AdoptCurriculumForm({
  apiBase,
  subjects,
  grades,
  labels,
}: {
  apiBase: string;
  subjects: Array<{ canonicalSubjectId: string; name: string; bases: Array<{ academicSubjectId: string; label: string }> }>;
  grades: Array<{ id: string; name: string }>;
  labels: { subject: string; base: string; baseGeneral: string; grade: string; anyGrade: string; year: string; title: string; programme: string; submit: string; done: string; errors: Record<string, string>; error: string };
}) {
  const router = useRouter();
  const [subjectId, setSubjectId] = useState(subjects[0]?.canonicalSubjectId ?? '');
  const [baseId, setBaseId] = useState('');
  const [gradeId, setGradeId] = useState('');
  const [year, setYear] = useState('');
  const [title, setTitle] = useState('');
  const [programme, setProgramme] = useState('');
  const [state, setState] = useState<{ kind: 'idle' | 'busy' | 'done' | 'error'; message?: string }>({ kind: 'idle' });
  const subject = subjects.find((s) => s.canonicalSubjectId === subjectId);
  return (
    <form
      className="ta-form ta-stack"
      style={{ gap: 'var(--space-2)' }}
      onSubmit={async (e) => {
        e.preventDefault();
        setState({ kind: 'busy' });
        const r = await post(`${apiBase}/curricula`, {
          canonicalSubjectId: subjectId,
          baseAcademicSubjectId: baseId || null,
          gradeId: gradeId || null,
          academicYear: year.trim() || null,
          programmeLabel: programme.trim() || null,
          title: title.trim() || subject?.name || '',
        });
        if (!r.ok) return setState({ kind: 'error', message: (r.error && labels.errors[r.error]) || labels.error });
        setState({ kind: 'done', message: labels.done });
        router.refresh();
      }}
    >
      <div className="ta-row">
        <label className="ta-field">
          <span>{labels.subject}</span>
          <select value={subjectId} onChange={(e) => { setSubjectId(e.target.value); setBaseId(''); }} required>
            {subjects.map((s) => (
              <option key={s.canonicalSubjectId} value={s.canonicalSubjectId}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="ta-field">
          <span>{labels.base}</span>
          <select value={baseId} onChange={(e) => setBaseId(e.target.value)}>
            <option value="">{labels.baseGeneral}</option>
            {(subject?.bases ?? []).map((b) => (
              <option key={b.academicSubjectId} value={b.academicSubjectId}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
        <label className="ta-field">
          <span>{labels.grade}</span>
          <select value={gradeId} onChange={(e) => setGradeId(e.target.value)}>
            <option value="">{labels.anyGrade}</option>
            {grades.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="ta-row">
        <label className="ta-field">
          <span>{labels.title}</span>
          <input type="text" maxLength={200} value={title} placeholder={subject?.name} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="ta-field">
          <span>{labels.programme}</span>
          <input type="text" maxLength={120} value={programme} onChange={(e) => setProgramme(e.target.value)} />
        </label>
        <label className="ta-field">
          <span>{labels.year}</span>
          <input type="text" maxLength={20} value={year} placeholder="2026-2027" onChange={(e) => setYear(e.target.value)} />
        </label>
      </div>
      <span className="ta-actions">
        <button type="submit" className="btn btn-primary" disabled={state.kind === 'busy' || !subjectId}>
          {labels.submit}
        </button>
      </span>
      {state.message && (
        <span className="ta-msg" role={state.kind === 'error' ? 'alert' : 'status'}>
          {state.message}
        </span>
      )}
    </form>
  );
}

export function CurriculumConceptControls({
  apiBase,
  curriculumId,
  canonicalConceptId,
  classification,
  period,
  removed,
  labels,
}: {
  apiBase: string;
  curriculumId: string;
  canonicalConceptId: string;
  classification: Classification;
  period: string | null;
  removed: boolean;
  labels: { classification: string; classifications: Record<Classification, string>; period: string; save: string; remove: string; restore: string; removeConfirm: string; error: string };
}) {
  const router = useRouter();
  const [value, setValue] = useState(classification);
  const [periodValue, setPeriodValue] = useState(period ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const base = `${apiBase}/curricula/${curriculumId}/concepts`;
  async function run(url: string, body: unknown) {
    setBusy(true);
    setError(false);
    const r = await post(url, body);
    setBusy(false);
    if (r.ok) router.refresh();
    else setError(true);
  }
  if (removed) {
    return (
      <span className="ta-actions">
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => run(base, { canonicalConceptId })}>
          {labels.restore}
        </button>
        {error && <span className="ta-msg" role="alert">{labels.error}</span>}
      </span>
    );
  }
  return (
    <form
      className="ta-form ta-row"
      style={{ alignItems: 'flex-end' }}
      onSubmit={(e) => {
        e.preventDefault();
        run(base, { canonicalConceptId, classification: value, period: periodValue.trim() || null });
      }}
    >
      <label className="ta-field">
        <span>{labels.classification}</span>
        <select value={value} onChange={(e) => setValue(e.target.value as Classification)}>
          {CLASSIFICATIONS.map((c) => (
            <option key={c} value={c}>
              {labels.classifications[c]}
            </option>
          ))}
        </select>
      </label>
      <label className="ta-field">
        <span>{labels.period}</span>
        <input type="text" maxLength={60} value={periodValue} onChange={(e) => setPeriodValue(e.target.value)} />
      </label>
      <button type="submit" className="btn btn-secondary" disabled={busy}>
        {labels.save}
      </button>
      <button
        type="button"
        className="btn btn-ghost"
        disabled={busy}
        onClick={() => {
          if (window.confirm(labels.removeConfirm)) run(`${base}/${canonicalConceptId}/remove`, {});
        }}
      >
        {labels.remove}
      </button>
      {error && <span className="ta-msg" role="alert">{labels.error}</span>}
    </form>
  );
}

export function AddCurriculumConceptForm({
  apiBase,
  curriculumId,
  addable,
  fixedConceptId,
  defaultClassification = 'RECOMMENDED',
  labels,
}: {
  apiBase: string;
  curriculumId: string;
  addable?: Array<{ canonicalConceptId: string; label: string }>;
  /** Add exactly this concept (supplemental suggestion). */
  fixedConceptId?: string;
  defaultClassification?: Classification;
  labels: { concept?: string; classification: string; classifications: Record<Classification, string>; submit: string; error: string };
}) {
  const router = useRouter();
  const [conceptId, setConceptId] = useState(fixedConceptId ?? addable?.[0]?.canonicalConceptId ?? '');
  const [value, setValue] = useState<Classification>(defaultClassification);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  return (
    <form
      className="ta-form ta-row"
      style={{ alignItems: 'flex-end' }}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(false);
        const r = await post(`${apiBase}/curricula/${curriculumId}/concepts`, { canonicalConceptId: conceptId, classification: value });
        setBusy(false);
        if (r.ok) router.refresh();
        else setError(true);
      }}
    >
      {!fixedConceptId && (
        <label className="ta-field">
          <span>{labels.concept}</span>
          <select value={conceptId} onChange={(e) => setConceptId(e.target.value)} required>
            {(addable ?? []).map((c) => (
              <option key={c.canonicalConceptId} value={c.canonicalConceptId}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="ta-field">
        <span>{labels.classification}</span>
        <select value={value} onChange={(e) => setValue(e.target.value as Classification)}>
          {CLASSIFICATIONS.map((c) => (
            <option key={c} value={c}>
              {labels.classifications[c]}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="btn btn-secondary" disabled={busy || !conceptId}>
        {labels.submit}
      </button>
      {error && <span className="ta-msg" role="alert">{labels.error}</span>}
    </form>
  );
}
