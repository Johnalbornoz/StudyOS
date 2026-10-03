'use client';

/**
 * Exam V2 -- the submission builder for a portfolio / performance task.
 *
 * Uploads go through a short-lived signed intent; the server scans every
 * file (the declared type is never trusted), makes thumbnails and stores it
 * owner-scoped. Thumbnails are shown through short-lived signed URLs. When
 * the submission is complete (required artifacts + statement) the panel
 * hands the submission id to the runner, which commits it like any answer.
 */
import { useCallback, useEffect, useState } from 'react';

type L = Record<string, string>;

export interface PortfolioRequirements {
  componentKind: string;
  artifacts: Array<{ kind: string; min: number; max: number; label: string }>;
  statementRequired: boolean;
  statementMaxWords?: number;
}

interface SubmissionView {
  submissionId: string;
  status: string;
  artifacts: Array<{ id: string; kind: string; caption: string | null; text: string | null; mime: string | null; name: string | null; thumbUrl: string | null; fileUrl: string | null }>;
  completeness: { complete: boolean; missing: string[] };
}

const ACCEPT: Record<string, string> = {
  IMAGE: 'image/png,image/jpeg,image/webp',
  PORTFOLIO_PAGE: 'image/png,image/jpeg,image/webp,application/pdf',
  PDF: 'application/pdf',
  AUDIO: 'audio/mpeg,audio/wav,audio/mp4',
  VIDEO: 'video/mp4,video/webm',
  PROCESS_EVIDENCE: 'image/png,image/jpeg,image/webp,application/pdf',
  PRESENTATION: 'application/pdf',
};

const words = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

export function PortfolioPanel({ instanceId, targetIndex, requirements, labels: l, onReady }: { instanceId: string; targetIndex: number; requirements: PortfolioRequirements; labels: L; onReady: (submissionId: string | null) => void }) {
  const base = `/api/exams/instances/${instanceId}/submissions/${targetIndex}`;
  const [view, setView] = useState<SubmissionView | null>(null);
  const [statement, setStatement] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await fetch(base, { cache: 'no-store' }).catch(() => null);
    const b = r ? await r.json().catch(() => null) : null;
    if (!r?.ok || !b) {
      setError(l['exv2.portfolio.loadError']);
      return;
    }
    const v: SubmissionView = b.data.submission;
    setView(v);
    const st = v.artifacts.find((a) => a.kind === 'STATEMENT');
    setStatement((s) => (s ? s : st?.text ?? ''));
    onReady(v.completeness.complete ? v.submissionId : null);
  }, [base, l, onReady]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function upload(kind: string, file: File) {
    setBusy(kind);
    setError(null);
    try {
      const i = await fetch(`${base}/upload-intent`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind }) });
      const ib = await i.json().catch(() => null);
      if (!i.ok) {
        setError(l[`exv2.portfolio.error.${ib?.error}`] ?? l['exv2.portfolio.uploadError']);
        return;
      }
      if (file.size > ib.data.maxBytes) {
        setError(l['exv2.portfolio.error.TOO_LARGE']);
        return;
      }
      const fd = new FormData();
      fd.set('token', ib.data.token);
      fd.set('file', file);
      const u = await fetch(`${base}/artifacts`, { method: 'POST', body: fd });
      const ub = await u.json().catch(() => null);
      if (!u.ok) {
        setError(ub?.error === 'FILE_REJECTED' ? (l[`exv2.portfolio.rejected.${ub.reason}`] ?? l['exv2.portfolio.rejected']) : (l[`exv2.portfolio.error.${ub?.error}`] ?? l['exv2.portfolio.uploadError']));
        return;
      }
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function saveStatement() {
    if (!statement.trim()) return;
    setBusy('STATEMENT');
    setError(null);
    try {
      const r = await fetch(`${base}/artifacts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'STATEMENT', text: statement }) });
      const b = await r.json().catch(() => null);
      if (!r.ok) setError(l[`exv2.portfolio.error.${b?.error}`] ?? l['exv2.portfolio.uploadError']);
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    setBusy(id);
    try {
      await fetch(`${base}/artifacts/${id}`, { method: 'DELETE' });
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  const count = (kind: string) => view?.artifacts.filter((a) => a.kind === kind).length ?? 0;
  const maxWords = requirements.statementMaxWords;
  const tooLong = !!maxWords && words(statement) > maxWords;
  const locked = view ? view.status !== 'DRAFT' : false;

  return (
    <div className="exv2-portfolio">
      <ul className="exv2-reqs">
        {requirements.artifacts.map((a) => (
          <li key={a.kind} className={count(a.kind) >= a.min ? 'is-done' : ''}>
            {(l['exv2.portfolio.requirement'] ?? '{label}: {n} / {min}-{max}').replace('{label}', a.label).replace('{n}', String(count(a.kind))).replace('{min}', String(a.min)).replace('{max}', String(a.max))}
          </li>
        ))}
        {requirements.statementRequired && (
          <li className={view?.artifacts.some((a) => a.kind === 'STATEMENT') ? 'is-done' : ''}>{l['exv2.portfolio.statementRequired']}</li>
        )}
      </ul>

      {view && view.artifacts.filter((a) => a.kind !== 'STATEMENT').length > 0 && (
        <ul className="exv2-artifacts">
          {view.artifacts.filter((a) => a.kind !== 'STATEMENT').map((a) => (
            <li key={a.id} className="exv2-artifact">
              {a.thumbUrl ? <img src={a.thumbUrl} alt={a.caption ?? a.name ?? a.kind} /> : <span className="xr-pill">{a.mime === 'application/pdf' ? 'PDF' : a.kind}</span>}
              <span>{a.name ?? l[`exv2.portfolio.kind.${a.kind}`] ?? a.kind}</span>
              {!locked && <button type="button" className="btn btn-ghost" disabled={busy !== null} onClick={() => remove(a.id)}>{l['exv2.portfolio.remove']}</button>}
            </li>
          ))}
        </ul>
      )}

      {!locked && (
        <div className="exv2-upload">
          {requirements.artifacts.filter((a) => count(a.kind) < a.max && ACCEPT[a.kind]).map((a) => (
            <label key={a.kind} className="btn">
              {busy === a.kind ? l['exv2.portfolio.uploading'] : (l['exv2.portfolio.add'] ?? '+ {label}').replace('{label}', a.label)}
              <input type="file" accept={ACCEPT[a.kind]} hidden disabled={busy !== null} onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) upload(a.kind, f);
              }} />
            </label>
          ))}
        </div>
      )}
      <p className="ui-hint">{l['exv2.portfolio.privacy']}</p>

      {requirements.statementRequired && (
        <div className="exv2-math">
          <label htmlFor={`exv2-st-${targetIndex}`} className="exv2-legend">{l['exv2.portfolio.statement']}</label>
          <textarea id={`exv2-st-${targetIndex}`} className="ui-input" rows={6} value={statement} disabled={locked} onChange={(e) => setStatement(e.target.value)} onBlur={saveStatement} />
          <p className={`ui-hint${tooLong ? ' xr-error' : ''}`}>{(l['exv2.portfolio.words'] ?? '{n}/{max}').replace('{n}', String(words(statement))).replace('{max}', String(maxWords ?? '—'))}</p>
          {!locked && <button type="button" className="btn" disabled={busy !== null || tooLong || !statement.trim()} onClick={saveStatement}>{busy === 'STATEMENT' ? l['exv2.portfolio.saving'] : l['exv2.portfolio.saveStatement']}</button>}
        </div>
      )}

      {view && !view.completeness.complete && <p className="ui-hint">{l['exv2.portfolio.incomplete']}</p>}
      {view && view.completeness.complete && <p className="xr-notice" role="status">{l['exv2.portfolio.ready']}</p>}
      {error && <p role="alert" className="xr-error">{error}</p>}
    </div>
  );
}
