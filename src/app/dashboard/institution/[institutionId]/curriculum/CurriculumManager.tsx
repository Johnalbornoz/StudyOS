'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Track A -- Institution Curriculum Management V2 (coordinator client pieces).
 * Governed dropdowns only (no free text, no ids): every option comes from the
 * published catalog the server listed; the server re-validates everything.
 */

export interface SourceOption {
  academicSubjectId: string;
  versionId: string;
  subject: string;
  level: string | null;
  qualification: string | null;
  code: string | null;
  versionLabel: string;
  programmeId: string;
  programme: string;
  stage: string | null;
  authority: string;
  parentAuthority: string | null;
  jurisdiction: string | null;
  country: string | null;
  sourceType: string;
  structureImported: boolean;
  objectives: number;
}

type L = Record<string, string>;
export function fill(template: string, values: Record<string, string | number>): string {
  return template
    .replace(/\{(\w+):([^|{}]*)\|([^{}]*)\}/g, (_m, k: string, one: string, other: string) => (Number(values[k]) === 1 ? one : other))
    .replace(/\{(\w+)\}/g, (_m, k: string) => String(values[k] ?? ''));
}
async function send(url: string, method: string, body?: unknown): Promise<{ ok: boolean; data?: any; error?: string }> {
  try {
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, data: j?.data, error: j?.error };
  } catch {
    return { ok: false };
  }
}
const optionLabel = (o: SourceOption) => [o.code, o.level, o.versionLabel !== `${o.code} ${o.level}` ? o.versionLabel : null].filter(Boolean).join(' · ') || o.versionLabel;
const countryName = (code: string | null, labels: L) => (code === 'MX' ? 'México' : code === 'CO' ? 'Colombia' : code ? code : labels.international);

/**
 * Wizard: País → Autoridad / Programa → Grado → Asignaturas (multi) + nivel/versión → Revisión.
 * With a preset programme + grade (the "Añadir asignatura" button of a group) it opens at step 4.
 */
export function AddSubjectsWizard({
  institutionId,
  sources,
  grades,
  preset,
  labels,
}: {
  institutionId: string;
  sources: SourceOption[];
  grades: Array<{ id: string; name: string }>;
  preset?: { programmeId: string; gradeId: string | null };
  labels: L;
}) {
  const router = useRouter();
  const presetSource = preset ? sources.find((s) => s.programmeId === preset.programmeId) : undefined;
  const [step, setStep] = useState(preset ? 4 : 1);
  const [country, setCountry] = useState<string | null>(presetSource ? presetSource.country ?? '' : null);
  const [programmeId, setProgrammeId] = useState<string>(preset?.programmeId ?? '');
  const [gradeId, setGradeId] = useState<string>(preset ? preset.gradeId ?? '' : grades[0]?.id ?? '');
  const [year, setYear] = useState('');
  const [picked, setPicked] = useState<Record<string, string>>({}); // subject name → academicSubjectId|versionId
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const countries = useMemo(() => [...new Set(sources.map((s) => s.country ?? ''))], [sources]);
  const programmes = useMemo(() => {
    const m = new Map<string, SourceOption>();
    for (const s of sources) if ((s.country ?? '') === country && !m.has(s.programmeId)) m.set(s.programmeId, s);
    return [...m.values()];
  }, [sources, country]);
  const subjects = useMemo(() => {
    const m = new Map<string, SourceOption[]>();
    for (const s of sources.filter((x) => x.programmeId === programmeId)) m.set(s.subject, [...(m.get(s.subject) ?? []), s]);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [sources, programmeId]);
  const optionFor = (key: string) => sources.find((s) => `${s.academicSubjectId}|${s.versionId}` === key);
  const chosen = Object.values(picked).map(optionFor).filter(Boolean) as SourceOption[];
  const total = 5;

  async function confirm() {
    setBusy(true);
    const r = await send(`/api/institutions/${institutionId}/curriculum/subjects`, 'POST', {
      gradeId: gradeId || null,
      academicYear: year.trim() || null,
      items: chosen.map((c) => ({ academicSubjectId: c.academicSubjectId, versionId: c.versionId })),
    });
    setBusy(false);
    if (!r.ok) return setMessage({ text: labels.error, error: true });
    const results: Array<{ created: boolean }> = r.data?.results ?? [];
    setMessage({ text: fill(labels.done, { created: results.filter((x) => x.created).length, existing: results.filter((x) => !x.created).length }) });
    setPicked({});
    router.refresh();
  }

  return (
    <div className="ta-form ta-stack cur2-wizard" style={{ gap: 'var(--space-3)' }} aria-label={labels.addSubjects}>
      <p className="ta-msg" aria-live="polite">
        {fill(labels.step, { n: step, total })}
      </p>
      {step === 1 && (
        <fieldset className="ta-choices">
          <legend>{labels.country}</legend>
          {countries.map((c) => (
            <label key={c || 'intl'} className="ta-choice">
              <input type="radio" name="cur2-country" checked={country === c} onChange={() => { setCountry(c); setProgrammeId(''); }} /> {countryName(c || null, labels)}
            </label>
          ))}
        </fieldset>
      )}
      {step === 2 && (
        <fieldset className="ta-choices">
          <legend>{labels.authority}</legend>
          {programmes.map((p) => (
            <label key={p.programmeId} className="ta-choice">
              <input type="radio" name="cur2-programme" checked={programmeId === p.programmeId} onChange={() => setProgrammeId(p.programmeId)} />
              <span>
                <strong>{p.programme}</strong>
                <span className="ta-msg">
                  {' '}
                  · {p.authority}
                  {p.jurisdiction ? ` · ${p.jurisdiction}` : ''}
                  {p.stage ? ` · ${p.stage}` : ''} <span className="chip">{labels[`source.${p.sourceType}`] ?? p.sourceType}</span>
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {step === 3 && (
        <div className="ta-row">
          <label className="ta-field">
            <span>{labels.grade}</span>
            <select value={gradeId} onChange={(e) => setGradeId(e.target.value)}>
              <option value="">{labels.allGrades}</option>
              {grades.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ta-field">
            <span>{labels.year}</span>
            <input type="text" maxLength={20} placeholder="2026-2027" value={year} onChange={(e) => setYear(e.target.value)} />
          </label>
        </div>
      )}
      {step === 4 && (
        <fieldset className="ta-choices">
          <legend>{labels.subjects}</legend>
          <p className="ta-msg">{labels.subjectsHelp}</p>
          {subjects.length === 0 && <p className="ta-msg">{labels.noOptions}</p>}
          {subjects.map(([name, options]) => {
            const value = picked[name];
            return (
              <div key={name} className="cur2-subject-pick">
                <label className="ta-choice">
                  <input
                    type="checkbox"
                    checked={Boolean(value)}
                    onChange={(e) =>
                      setPicked((p) => {
                        const next = { ...p };
                        if (e.target.checked) next[name] = `${options[0].academicSubjectId}|${options[0].versionId}`;
                        else delete next[name];
                        return next;
                      })
                    }
                  />{' '}
                  <strong>{name}</strong>
                </label>
                {value && options.length > 1 && (
                  <label className="ta-field">
                    <span>{labels.version}</span>
                    <select value={value} onChange={(e) => setPicked((p) => ({ ...p, [name]: e.target.value }))}>
                      {options.map((o) => (
                        <option key={o.versionId} value={`${o.academicSubjectId}|${o.versionId}`}>
                          {optionLabel(o)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {value && options.length === 1 && <span className="ta-msg">{optionLabel(options[0])}</span>}
                {value && !optionFor(value)?.structureImported && <span className="ta-msg">{labels.structureNotImported}</span>}
              </div>
            );
          })}
        </fieldset>
      )}
      {step === 5 && (
        <div className="ta-stack" style={{ gap: 'var(--space-1)' }}>
          <strong>{labels.review}</strong>
          <span className="ta-msg">
            {chosen[0]?.programme} · {grades.find((g) => g.id === gradeId)?.name ?? labels.allGrades}
            {year ? ` · ${year}` : ''}
          </span>
          <ul className="role-list ta-compact">
            {chosen.map((c) => (
              <li key={c.versionId}>
                {c.subject} · {optionLabel(c)}
              </li>
            ))}
          </ul>
        </div>
      )}
      <span className="ta-actions">
        {step > (preset ? 4 : 1) && (
          <button type="button" className="btn btn-ghost" onClick={() => setStep((s) => s - 1)}>
            {labels.back}
          </button>
        )}
        {step < total && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={(step === 1 && country === null) || (step === 2 && !programmeId) || (step === 4 && chosen.length === 0)}
            onClick={() => setStep((s) => s + 1)}
          >
            {labels.next}
          </button>
        )}
        {step === total && (
          <button type="button" className="btn btn-primary" disabled={busy || chosen.length === 0} onClick={confirm}>
            {labels.confirm}
          </button>
        )}
      </span>
      {message && (
        <span className="ta-msg" role={message.error ? 'alert' : 'status'}>
          {message.text}
        </span>
      )}
    </div>
  );
}

/** Edit: level / version (with impact preview before saving), grade, academic year, display name. */
export function EditSubjectPanel({
  institutionId,
  row,
  alternatives,
  grades,
  labels,
}: {
  institutionId: string;
  row: { curriculumId: string; academicSubjectId: string | null; versionId: string | null; gradeId: string | null; academicYear: string | null; title: string };
  alternatives: SourceOption[];
  grades: Array<{ id: string; name: string }>;
  labels: L;
}) {
  const router = useRouter();
  const currentKey = `${row.academicSubjectId}|${row.versionId}`;
  const [versionKey, setVersionKey] = useState(currentKey);
  const [gradeId, setGradeId] = useState(row.gradeId ?? '');
  const [year, setYear] = useState(row.academicYear ?? '');
  const [title, setTitle] = useState(row.title);
  const [impact, setImpact] = useState<any>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const base = `/api/institutions/${institutionId}/curriculum/subjects/${row.curriculumId}`;

  async function preview(key: string) {
    setVersionKey(key);
    setImpact(null);
    if (key === currentKey) return;
    const [academicSubjectId, versionId] = key.split('|');
    const r = await send(`${base}/preview?academicSubjectId=${academicSubjectId}&versionId=${versionId}`, 'GET');
    if (r.ok) setImpact(r.data);
  }
  async function save() {
    setBusy(true);
    const body: Record<string, unknown> = { title, academicYear: year.trim() || null, gradeId: gradeId || null };
    if (versionKey !== currentKey) {
      const [academicSubjectId, versionId] = versionKey.split('|');
      Object.assign(body, { academicSubjectId, versionId });
    }
    const r = await send(base, 'PATCH', body);
    setBusy(false);
    setMessage(r.ok ? { text: labels.saved } : { text: labels.error, error: true });
    if (r.ok) router.refresh();
  }

  return (
    <div className="ta-form ta-stack" style={{ gap: 'var(--space-2)' }}>
      {alternatives.length > 1 && (
        <label className="ta-field">
          <span>{labels.levelVersion}</span>
          <select value={versionKey} onChange={(e) => preview(e.target.value)}>
            {alternatives.map((o) => (
              <option key={o.versionId} value={`${o.academicSubjectId}|${o.versionId}`}>
                {optionLabel(o)}
              </option>
            ))}
          </select>
        </label>
      )}
      {impact && (
        <p className="ta-preview" role="status">
          {fill(labels.impact, { added: impact.added, retired: impact.retired, classes: impact.classes, students: impact.students })}
        </p>
      )}
      <div className="ta-row">
        <label className="ta-field">
          <span>{labels.grade}</span>
          <select value={gradeId} onChange={(e) => setGradeId(e.target.value)}>
            <option value="">{labels.allGrades}</option>
            {grades.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label className="ta-field">
          <span>{labels.year}</span>
          <input type="text" maxLength={20} value={year} onChange={(e) => setYear(e.target.value)} />
        </label>
        <label className="ta-field">
          <span>{labels.titleField}</span>
          <input type="text" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
      </div>
      <span className="ta-actions">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>
          {versionKey !== currentKey ? labels.updateVersion : labels.save}
        </button>
      </span>
      {message && (
        <span className="ta-msg" role={message.error ? 'alert' : 'status'}>
          {message.text}
        </span>
      )}
    </div>
  );
}

/** Archive with an impact confirmation (classes + students using it); never a hard delete. */
export function ArchiveSubjectButton({ institutionId, curriculumId, labels }: { institutionId: string; curriculumId: string; labels: L }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  return (
    <span className="ta-actions">
      <button
        type="button"
        className="btn btn-ghost cur2-danger"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(false);
          const base = `/api/institutions/${institutionId}/curriculum/subjects/${curriculumId}`;
          const usage = await send(`${base}/preview`, 'GET');
          const classes = usage.data?.usage?.classes?.length ?? 0;
          const students = usage.data?.usage?.students ?? 0;
          const text = classes > 0 ? fill(labels.archiveConfirm, { classes, students }) : labels.archiveConfirmUnused;
          if (!window.confirm(text)) return setBusy(false);
          const r = await send(`${base}/archive`, 'POST', {});
          setBusy(false);
          if (r.ok) router.refresh();
          else setError(true);
        }}
      >
        {labels.archive}
      </button>
      {error && (
        <span className="ta-msg" role="alert">
          {labels.error}
        </span>
      )}
    </span>
  );
}

/**
 * "Currículo asociado" of a class: an EXPLICIT choice, never preselected or inferred from the
 * class name. Candidates come ranked by the server: the class's academic domain first ("Compatibles
 * con Matemáticas"), the rest shown for context but not selectable. Changing or removing an existing
 * binding shows its impact first and needs a confirmation.
 */
export function ClassCurriculumSelect({
  institutionId,
  classId,
  current,
  options,
  domainLabel,
  labels,
}: {
  institutionId: string;
  classId: string;
  current: string | null;
  options: Array<{ id: string; label: string; compatible: boolean }>;
  domainLabel: string | null;
  labels: L;
}) {
  const router = useRouter();
  const [value, setValue] = useState(current ?? '');
  const [state, setState] = useState<'idle' | 'busy' | 'saved' | 'error' | 'mismatch'>('idle');
  const [impact, setImpact] = useState<null | { from: string; to: string; students: number; plan: number; outside: number }>(null);
  const compatible = options.filter((o) => o.compatible);
  const others = options.filter((o) => !o.compatible);
  const url = `/api/institutions/${institutionId}/classes/${classId}/curriculum`;

  async function submit(confirmImpact: boolean, target: string | null) {
    setState('busy');
    const r = await send(url, 'POST', { curriculumId: target, ...(confirmImpact ? { confirmImpact: true } : {}) });
    if (r.ok) {
      setImpact(null);
      setState('saved');
      router.refresh();
      return;
    }
    if (r.error === 'IMPACT_CONFIRMATION_REQUIRED') {
      const res = await fetch(`${url}?curriculumId=${target ?? ''}`, { cache: 'no-store' }).then((x) => x.json()).catch(() => null);
      const i = res?.data?.impact;
      if (i) {
        setImpact({ from: i.current?.label ?? labels.none, to: i.next?.label ?? labels.none, students: i.activeStudents, plan: i.planConcepts, outside: i.planConceptsOutsideNext });
        setState('idle');
        return;
      }
    }
    setState(r.error === 'DOMAIN_MISMATCH' ? 'mismatch' : 'error');
  }

  return (
    <span className="ta-stack" style={{ gap: 'var(--space-2)' }} data-class-curriculum-select={classId}>
      <span className="ta-msg">
        {labels.domain}: <strong>{domainLabel ?? labels.noDomain}</strong>
      </span>
      <span className="ta-form ta-row" style={{ alignItems: 'flex-end' }}>
        <label className="ta-field">
          <span>{labels.associated}</span>
          <select value={value} onChange={(e) => setValue(e.target.value)}>
            <option value="">{current ? labels.none : labels.select}</option>
            {compatible.length > 0 && (
              <optgroup label={domainLabel ? labels.compatibleGroup.replace('{domain}', domainLabel) : labels.associated}>
                {compatible.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            )}
            {others.length > 0 && (
              <optgroup label={labels.otherGroup}>
                {others.map((o) => (
                  <option key={o.id} value={o.id} disabled>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        <button type="button" className="btn btn-secondary" disabled={!value || value === current || state === 'busy'} onClick={() => submit(false, value)}>
          {labels.assign}
        </button>
        {current && (
          <button type="button" className="btn btn-ghost" disabled={state === 'busy'} onClick={() => submit(false, null)}>
            {labels.remove}
          </button>
        )}
      </span>
      {impact && (
        <span className="card ta-card" role="alertdialog" aria-labelledby={`impact-${classId}`}>
          <strong id={`impact-${classId}`}>{labels.impactTitle}</strong>
          <span className="ta-msg">
            {labels.impactBody.replace('{from}', impact.from).replace('{to}', impact.to).replace('{students}', String(impact.students)).replace('{outside}', String(impact.outside)).replace('{plan}', String(impact.plan))}
          </span>
          <span className="ta-row">
            <button type="button" className="btn btn-primary" onClick={() => submit(true, value || null)}>
              {labels.confirmChange}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setImpact(null)}>
              {labels.cancel}
            </button>
          </span>
        </span>
      )}
      <span className="ta-msg">{labels.explicitNote}</span>
      {state === 'saved' && <span className="ta-msg" role="status">{labels.saved}</span>}
      {state === 'mismatch' && <span className="ta-msg" role="alert">{labels.domainMismatch}</span>}
      {state === 'error' && <span className="ta-msg" role="alert">{labels.error}</span>}
    </span>
  );
}
