'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FileUp } from 'lucide-react';
import { getMessages, type Locale } from '@/lib/i18n/messages';

/**
 * "Subir documento o examen" -- the restored document import, inline in
 * Aprender (and the first-run "¿Qué quieres aprender en …?" card).
 *
 * upload -> the server parses and PROPOSES topics -> the Student reviews and
 * explicitly selects -> only then are concepts added (existing ones reused).
 * Nothing is pre-selected; cancel removes the uploaded material. A document
 * never counts as evidence.
 */
interface Candidate {
  key: string;
  label: string;
  existingConceptId: string | null;
}
type Phase =
  | { kind: 'closed' }
  | { kind: 'pick' }
  | { kind: 'analyzing'; fileName: string }
  | { kind: 'review'; fileName: string; sourceId: string; candidates: Candidate[] }
  | { kind: 'confirming'; fileName: string; sourceId: string; candidates: Candidate[] }
  | { kind: 'done'; items: { conceptId: string; label: string }[] };

const ERROR_KEYS = ['UNSUPPORTED_FILE', 'FILE_TOO_LARGE', 'EMPTY_FILE', 'NO_CONCEPTS', 'EXTRACTION_FAILED'] as const;
type ErrorKey = (typeof ERROR_KEYS)[number] | 'network' | 'import';

export default function DocumentImport({ subjectId, subjectName, locale }: { subjectId: string; subjectName: string; locale: Locale }) {
  const t = getMessages(locale);
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: 'closed' });
  const [file, setFile] = useState<File | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<ErrorKey | null>(null);
  const inFlight = useRef(false);
  const errText = (k: ErrorKey) => (k === 'network' ? t['di.err.network'] : k === 'import' ? t['di.err.import'] : t[`di.err.${k}`]);

  async function analyze() {
    if (!file || inFlight.current) return;
    inFlight.current = true;
    setError(null);
    setPhase({ kind: 'analyzing', fileName: file.name });
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('subjectId', subjectId);
      const res = await fetch('/api/content/import/analyze', { method: 'POST', body: form });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.data) {
        const code = body?.error;
        setError((ERROR_KEYS as readonly string[]).includes(code) ? (code as ErrorKey) : 'EXTRACTION_FAILED');
        setPhase({ kind: 'pick' });
        return;
      }
      setSelected(new Set());
      setPhase({ kind: 'review', fileName: file.name, sourceId: body.data.sourceId, candidates: body.data.candidates });
    } catch {
      setError('network');
      setPhase({ kind: 'pick' });
    } finally {
      inFlight.current = false;
    }
  }

  async function cancelReview(sourceId: string) {
    // Remove the uploaded material; no concept was created.
    fetch(`/api/content/import/${sourceId}`, { method: 'DELETE' }).catch(() => {});
    setPhase({ kind: 'closed' });
    setFile(null);
    setSelected(new Set());
  }

  async function confirm() {
    if (phase.kind !== 'review' || selected.size === 0 || inFlight.current) return;
    inFlight.current = true;
    setError(null);
    const { fileName, sourceId, candidates } = phase;
    setPhase({ kind: 'confirming', fileName, sourceId, candidates });
    try {
      const res = await fetch('/api/content/import/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjectId, sourceId, keys: [...selected] }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.data) throw new Error('import');
      setPhase({ kind: 'done', items: [...body.data.added, ...body.data.reused] });
      router.refresh();
    } catch {
      setError('import');
      setPhase({ kind: 'review', fileName, sourceId, candidates });
    } finally {
      inFlight.current = false;
    }
  }

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (phase.kind === 'closed') {
    return (
      <button type="button" className="btn btn-secondary di-open" onClick={() => setPhase({ kind: 'pick' })}>
        <FileUp size={16} strokeWidth={2} aria-hidden />
        {t['di.open']}
      </button>
    );
  }

  if (phase.kind === 'done') {
    return (
      <section className="di" aria-labelledby="di-done" role="status">
        <h3 id="di-done" className="di-title">{t['di.doneTitle'].replace('{n}', String(phase.items.length)).replace('{subject}', subjectName)}</h3>
        <ul className="di-list">
          {phase.items.map((c) => (
            <li key={c.conceptId}>
              <Link href={`/dashboard/subjects/${subjectId}/concepts/${c.conceptId}`} className="di-row di-row--link">
                <span className="di-row-label">{c.label}</span>
                <span className="di-row-go">{t['di.start']}</span>
              </Link>
            </li>
          ))}
        </ul>
        <button type="button" className="btn btn-ghost" onClick={() => { setPhase({ kind: 'pick' }); setFile(null); }}>{t['di.again']}</button>
      </section>
    );
  }

  if (phase.kind === 'review' || phase.kind === 'confirming') {
    const busy = phase.kind === 'confirming';
    const existing = phase.candidates.filter((c) => c.existingConceptId);
    const fresh = phase.candidates.filter((c) => !c.existingConceptId);
    const nNew = fresh.filter((c) => selected.has(c.key)).length;
    const nReuse = existing.filter((c) => selected.has(c.key)).length;
    const group = (title: string, items: Candidate[], id: string) =>
      items.length > 0 && (
        <fieldset className="di-group" aria-labelledby={id}>
          <legend id={id} className="di-group-title">{title}</legend>
          <ul className="di-list">
            {items.map((c) => (
              <li key={c.key}>
                <label className="di-row">
                  <input type="checkbox" checked={selected.has(c.key)} onChange={() => toggle(c.key)} disabled={busy} />
                  <span className="di-row-label">{c.label}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      );
    return (
      <section className="di" aria-labelledby="di-review" aria-busy={busy || undefined}>
        <h3 id="di-review" className="di-title">{t['di.reviewTitle'].replace('{file}', phase.fileName)}</h3>
        <p className="di-lead">{t['di.reviewLead'].replace('{subject}', subjectName)}</p>
        <div className="di-bulk">
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setSelected(new Set(phase.candidates.map((c) => c.key)))}>{t['di.selectAll']}</button>
          <button type="button" className="btn btn-ghost" disabled={busy || selected.size === 0} onClick={() => setSelected(new Set())}>{t['di.selectNone']}</button>
        </div>
        {group(t['di.newTitle'], fresh, 'di-new')}
        {group(t['di.existingTitle'], existing, 'di-existing')}
        <p className="di-summary" aria-live="polite">
          {selected.size === 0
            ? t['di.summaryNone']
            : [
                nNew > 0 ? (nNew === 1 ? t['di.summaryNewOne'] : t['di.summaryNew']).replace('{n}', String(nNew)).replace('{subject}', subjectName) : null,
                nReuse > 0 ? (nReuse === 1 ? t['di.summaryReuseOne'] : t['di.summaryReuse']).replace('{n}', String(nReuse)) : null,
              ].filter(Boolean).join(' ')}
        </p>
        {error && <p className="sp-error" role="alert">{errText(error)}</p>}
        <p className="di-note">{t['di.note']}</p>
        <div className="di-actions">
          <button type="button" className="btn btn-primary" onClick={confirm} disabled={busy || selected.size === 0} aria-busy={busy || undefined}>
            {busy ? t['di.adding'] : t['di.confirm'].replace('{subject}', subjectName)}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => cancelReview(phase.sourceId)} disabled={busy}>{t['di.cancel']}</button>
        </div>
      </section>
    );
  }

  const analyzing = phase.kind === 'analyzing';
  return (
    <section className="di" aria-labelledby="di-pick" aria-busy={analyzing || undefined}>
      <h3 id="di-pick" className="di-title">{t['di.open']}</h3>
      <p className="di-lead">{t['di.lead']}</p>
      <label className="di-file">
        <span className="sr-only">{t['di.choose']}</span>
        <input
          type="file"
          accept=".pdf,.txt,.md,.jpg,.jpeg,.png,.webp,.gif,application/pdf,text/plain,image/*"
          onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(null); }}
          disabled={analyzing}
        />
      </label>
      <p className="di-note">{t['di.types']}</p>
      {analyzing && <p className="cf-hint" role="status">{t['di.analyzing']}</p>}
      {error && <p className="sp-error" role="alert">{errText(error)}</p>}
      <p className="di-note">{t['di.note']}</p>
      <div className="di-actions">
        <button type="button" className="btn btn-primary" onClick={analyze} disabled={!file || analyzing} aria-busy={analyzing || undefined}>
          {t['di.analyze']}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => { setPhase({ kind: 'closed' }); setFile(null); setError(null); }} disabled={analyzing}>
          {t['di.cancel']}
        </button>
      </div>
    </section>
  );
}
