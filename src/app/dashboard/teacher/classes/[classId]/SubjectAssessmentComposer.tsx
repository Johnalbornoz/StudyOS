'use client';

/**
 * Overnight 2026-10-16 -- the Teacher's composer for a subject Test ("Prueba por materia") / Mock ("Simulacro por
 * materia"): type, the class subject's concepts (all ON by default; select all / deselect all; >= 1), difficulty
 * (Básico / Intermedio / Avanzado / Mixto -> the governed LOW / MEDIUM / HIGH / MIXED bands), application window
 * (DATES ONLY -- the close is 21:00 of the end date in the INSTITUTION's timezone, computed by the server, never from
 * this browser's clock), max attempts, timing (Test: timed or untimed; Mock: always timed, "Recomendado por StudyUs"
 * duration adjustable before assigning), recipients. The preview is the server's (POST .../preview); publishing goes to
 * the class-scoped route, which re-authorizes everything and writes nothing on a refusal.
 */
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getMessages, type Locale } from '@/lib/i18n/messages';
import { fillMessage } from '@/lib/i18n/roles-messages';

type Kind = 'TEST' | 'MOCK';
type UiDifficulty = 'BASICO' | 'INTERMEDIO' | 'AVANZADO' | 'MIXTO';
interface Preview {
  plan: { questionCount: number; distribution: Record<string, number> };
  timing: { timed: boolean; durationMinutes: number | null; recommendedDurationMinutes: number | null };
  window: { startDate: string; endDate: string; closesAt: string; timezone: string };
  closesAtLocal: { time: string; timezone: string };
}

const newRequestId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}`);

export function SubjectAssessmentComposer({
  classId, locale, subjectName, concepts, learners, timezone, timezoneBlocker, today,
}: {
  classId: string;
  locale: Locale;
  subjectName: string | null;
  concepts: Array<{ id: string; name: string }>;
  learners: Array<{ id: string; name: string }>;
  timezone: string | null;
  timezoneBlocker: boolean;
  /** Today in the institution's timezone (server-computed), the default window. */
  today: string | null;
}) {
  const t = getMessages(locale);
  const router = useRouter();
  const [kind, setKind] = useState<Kind>('TEST');
  const [selected, setSelected] = useState<string[]>(() => concepts.map((c) => c.id));
  const [difficulty, setDifficulty] = useState<UiDifficulty>('MIXTO');
  const [startDate, setStartDate] = useState(today ?? '');
  const [endDate, setEndDate] = useState(today ?? '');
  const [maxAttempts, setMaxAttempts] = useState(1);
  const [timed, setTimed] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const [wholeClass, setWholeClass] = useState(true);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [requestId, setRequestId] = useState(newRequestId);
  const isTimed = kind === 'MOCK' || timed;
  const names = useMemo(() => new Map(concepts.map((c) => [c.id, c.name])), [concepts]);

  const errorText = (code: string | undefined) => (code && t[`tsa.err.${code}` as keyof typeof t]) || (code === 'TIMEZONE_AUTHORITY_BLOCKER' ? t['tsa.timezoneBlocker'] : t['tsa.error']);
  const draft = { kind, conceptIds: selected, difficulty, startDate, endDate, maxAttempts, timing: { timed: isTimed, durationMinutes: isTimed ? duration : null } };

  // the server's plan for the current draft (count, distribution, recommended duration, close in the institution tz)
  useEffect(() => {
    if (timezoneBlocker || selected.length === 0 || !startDate || !endDate) { setPreview(null); return; }
    let cancelled = false;
    const h = setTimeout(async () => {
      try {
        const res = await fetch(`/api/teacher/classes/${classId}/subject-assessments/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) { setPreview(null); setPreviewError(errorText(body?.error)); return; }
        setPreviewError(null);
        setPreview(body.data);
      } catch {
        if (!cancelled) setPreviewError(t['tsa.error']);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(h); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId, kind, selected.join(','), difficulty, startDate, endDate, maxAttempts, isTimed, duration, timezoneBlocker]);

  if (timezoneBlocker) {
    return (
      <section className="card ta-card" aria-labelledby="tsa-compose-title">
        <h2 id="tsa-compose-title" style={{ fontSize: 18 }}>{t['tsa.title']}</h2>
        <p role="alert" className="ta-msg ta-msg-error" data-code="TIMEZONE_AUTHORITY_BLOCKER">{t['tsa.timezoneBlocker']}</p>
      </section>
    );
  }
  if (!subjectName || concepts.length === 0) {
    return (
      <section className="card ta-card" aria-labelledby="tsa-compose-title">
        <h2 id="tsa-compose-title" style={{ fontSize: 18 }}>{t['tsa.title']}</h2>
        <p className="ta-msg">{t['tsa.noSubject']}</p>
      </section>
    );
  }

  async function publish(e: React.FormEvent) {
    e.preventDefault();
    if (busy || selected.length === 0) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/teacher/classes/${classId}/subject-assessments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...draft, studentIds: wholeClass ? [] : recipients, requestId, title: title.trim() || null, instructions: instructions.trim() || null }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) { setMessage({ text: errorText(body?.error), error: true }); return; }
      const parts = [fillMessage(t['tsa.published'], { n: body.data.assigned.length })];
      if (body.data.skipped.length > 0) parts.push(fillMessage(t['tsa.skipped'], { n: body.data.skipped.length }));
      setMessage({ text: parts.join(' '), error: false });
      setRequestId(newRequestId());
      router.refresh();
    } catch {
      setMessage({ text: t['tsa.error'], error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card ta-card" aria-labelledby="tsa-compose-title" data-testid="subject-assessment-composer">
      <h2 id="tsa-compose-title" style={{ fontSize: 18 }}>{t['tsa.title']}</h2>
      <p className="ta-msg">{t['tsa.subtitle']}</p>
      <form className="ta-form" onSubmit={publish}>
        <fieldset className="ta-choices">
          <legend>{t['tsa.kind']}</legend>
          {(['TEST', 'MOCK'] as const).map((k) => (
            <label key={k} className="ta-choice">
              <input type="radio" name="tsa-kind" checked={kind === k} onChange={() => setKind(k)} /> {t[`tsa.kind.${k}`]}
            </label>
          ))}
        </fieldset>
        <p className="ta-msg">{t['tsa.subject']}: <strong>{subjectName}</strong></p>

        <fieldset className="ta-choices">
          <legend>{t['tsa.concepts']} · {fillMessage(t['tsa.conceptsSelected'], { n: selected.length, total: concepts.length })}</legend>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected(concepts.map((c) => c.id))}>{t['tsa.selectAll']}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected([])}>{t['tsa.deselectAll']}</button>
          </div>
          <div className="ta-choices-list" style={{ maxHeight: 240, overflowY: 'auto' }}>
            {concepts.map((c) => (
              <label key={c.id} className="ta-choice">
                <input type="checkbox" checked={selected.includes(c.id)} onChange={(e) => setSelected((s) => (e.target.checked ? [...s, c.id] : s.filter((x) => x !== c.id)))} /> {c.name}
              </label>
            ))}
          </div>
          {selected.length === 0 && <p role="alert" className="ta-msg ta-msg-error">{t['tsa.err.NO_CONCEPTS_SELECTED']}</p>}
        </fieldset>

        <fieldset className="ta-choices">
          <legend>{t['tsa.difficulty']}</legend>
          {(['BASICO', 'INTERMEDIO', 'AVANZADO', 'MIXTO'] as const).map((d) => (
            <label key={d} className="ta-choice">
              <input type="radio" name="tsa-difficulty" checked={difficulty === d} onChange={() => setDifficulty(d)} /> {t[`tsa.difficulty.${d}`]}
            </label>
          ))}
        </fieldset>

        <fieldset className="ta-choices">
          <legend>{t['tsa.window']}</legend>
          <div className="ta-row">
            <label className="ta-field">{t['tsa.startDate']} <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required /></label>
            <label className="ta-field">{t['tsa.endDate']} <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} required /></label>
          </div>
          <p className="ta-msg">{fillMessage(t['tsa.closesAt'], { time: '21:00', tz: timezone ?? '' })}</p>
        </fieldset>

        <div className="ta-row">
          <label className="ta-field">{t['tsa.maxAttempts']} <input type="number" min={1} max={10} value={maxAttempts} onChange={(e) => setMaxAttempts(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} /></label>
        </div>

        <fieldset className="ta-choices">
          <legend>{t['tsa.timing']}</legend>
          {kind === 'TEST' ? (
            <>
              <label className="ta-choice"><input type="radio" name="tsa-timed" checked={!timed} onChange={() => setTimed(false)} /> {t['tsa.untimed']}</label>
              <label className="ta-choice"><input type="radio" name="tsa-timed" checked={timed} onChange={() => setTimed(true)} /> {t['tsa.timed']}</label>
            </>
          ) : (
            <p className="ta-msg">{t['tsa.mockAlwaysTimed']}</p>
          )}
          {isTimed && (
            <label className="ta-field">
              {t['tsa.duration']}{' '}
              <input type="number" min={1} max={600} value={duration ?? preview?.timing.recommendedDurationMinutes ?? ''} onChange={(e) => setDuration(e.target.value ? Math.max(1, Math.min(600, Number(e.target.value))) : null)} />
              {preview?.timing.recommendedDurationMinutes != null && (
                <span className="ta-msg" data-testid="tsa-recommended"> {fillMessage(t['tsa.recommended'], { n: preview.timing.recommendedDurationMinutes })}</span>
              )}
            </label>
          )}
        </fieldset>

        <fieldset className="ta-choices">
          <legend>{t['tsa.recipients']}</legend>
          <label className="ta-choice"><input type="radio" name="tsa-recipients" checked={wholeClass} onChange={() => setWholeClass(true)} /> {t['tsa.wholeClass']}</label>
          <label className="ta-choice"><input type="radio" name="tsa-recipients" checked={!wholeClass} onChange={() => setWholeClass(false)} /> {t['tsa.someStudents']}</label>
          {!wholeClass && (
            <div className="ta-choices-list">
              {learners.map((l) => (
                <label key={l.id} className="ta-choice">
                  <input type="checkbox" checked={recipients.includes(l.id)} onChange={(e) => setRecipients((r) => (e.target.checked ? [...r, l.id] : r.filter((x) => x !== l.id)))} /> {l.name}
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <label className="ta-field">{t['tsa.titleField']} <input type="text" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="ta-field">{t['tsa.instructions']} <textarea maxLength={500} value={instructions} onChange={(e) => setInstructions(e.target.value)} /></label>

        <div role="status" aria-live="polite" className="ta-preview" data-testid="tsa-preview">
          <strong>{t['tsa.preview']}</strong>
          {previewError && <p className="ta-msg ta-msg-error">{previewError}</p>}
          {preview && (
            <>
              <p className="ta-msg">{t[`tsa.kind.${kind}`]} · {fillMessage(t['tsa.previewCount'], { n: preview.plan.questionCount })}{preview.timing.timed && preview.timing.durationMinutes ? ` · ${preview.timing.durationMinutes} min` : ` · ${t['tsa.untimed']}`}</p>
              <p className="ta-msg">{t['tsa.previewDistribution']}: {Object.entries(preview.plan.distribution).map(([id, n]) => `${names.get(id) ?? id} ${n}`).join(' · ')}</p>
              <p className="ta-msg">{fillMessage(t['tsa.student.windowLine'], { start: preview.window.startDate, end: preview.window.endDate, tz: preview.closesAtLocal.timezone })}</p>
              <p className="ta-msg">{t['tsa.previewEquivalence']}</p>
            </>
          )}
        </div>
        <div className="ta-actions">
          <button type="submit" className="btn btn-primary" disabled={busy || selected.length === 0 || !preview || (!wholeClass && recipients.length === 0)}>
            {busy ? t['tsa.publishing'] : t['tsa.publish']}
          </button>
        </div>
      </form>
      {message && <p role={message.error ? 'alert' : 'status'} className={message.error ? 'ta-msg ta-msg-error' : 'ta-msg'}>{message.text}</p>}
    </section>
  );
}
