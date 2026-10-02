'use client';

/**
 * Exam Prep -- the profile's exam history. Every row says what it is (exam,
 * type), its status, date and result, offers "Continuar" / "Ver resultado"
 * when they apply, and the "⋯" menu to delete it (ExamDeleteMenu ->
 * DELETE /api/exams/attempts/[id]). Nothing here needs an id or a URL typed.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ExamDeleteMenu, type ExamDeleteKind } from '../../exams/ExamDeleteMenu';

type L = Record<string, string>;

export interface AttemptHistoryRow {
  id: string;
  /** Exam + kind of attempt, already localized ("PAA · Simulacro de formato reducido"). */
  name: string;
  status: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ABANDONED' | string;
  createdAt: string;
  /** Localized result ("31/36") when scored. */
  result: string | null;
}

const kindFor = (status: string): ExamDeleteKind => (status === 'ACTIVE' || status === 'PAUSED' ? 'IN_PROGRESS' : status === 'COMPLETED' ? 'COMPLETED' : 'ENDED');

export function AttemptHistory({ rows: initial, labels: l, locale }: { rows: AttemptHistoryRow[]; labels: L; locale: string }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [notice, setNotice] = useState<string | null>(null);

  if (rows.length === 0)
    return (
      <>
        {notice && <p role="status" className="ui-hint">{notice}</p>}
        <p className="ui-hint" style={{ margin: 0 }}>{l['examPrep.history.empty']}</p>
      </>
    );

  return (
    <>
      {notice && <p role="status" className="ui-hint">{notice}</p>}
      <ul className="exv2-history">
        {rows.map((a) => (
          <li key={a.id} className="exv2-history-row">
            <div className="exv2-history-main">
              <p className="exv2-history-name">{a.name}</p>
              <p className="ex-card-meta">
                <span className="xr-pill">{l[`examPrep.attempt.status.${a.status}`] ?? a.status}</span>{' '}
                {new Date(a.createdAt).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}
                {a.result ? ` · ${l['exv2.history.score'].replace('{score}', a.result)}` : ''}
              </p>
            </div>
            <div className="xr-next-actions">
              {a.status === 'COMPLETED' && (
                <Link className="btn btn-secondary" href={`/dashboard/exam-prep/attempt/${a.id}/result`}>{l['examPrep.history.view']}</Link>
              )}
              {(a.status === 'ACTIVE' || a.status === 'PAUSED') && (
                <Link className="btn btn-primary" href={`/dashboard/exam-prep/attempt/${a.id}`}>{l['exv2.action.continue']}</Link>
              )}
              <ExamDeleteMenu
                kind={kindFor(a.status)}
                endpoint={`/api/exams/attempts/${a.id}`}
                examName={a.name}
                labels={l}
                onDeleted={() => {
                  setRows((r) => r.filter((x) => x.id !== a.id));
                  setNotice(l['exv2.delete.done']);
                  router.refresh();
                }}
              />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
