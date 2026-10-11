'use client';

/**
 * L9 IN-1 -- bulk add from an email list (coordinator): paste the list or upload a .csv / .txt,
 * submit once, and read one outcome per address. The server runs the existing single add for each
 * address; nothing here creates an account or re-opens a closed relation.
 * Labels come from the irost.* catalog (`l`).
 */
import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BULK_EMAIL_LIMIT, normalizeEmailList, parseEmailText } from '@/lib/institution/email-list';
import { fillRosterMessage as fill } from '@/lib/i18n/institution-roster-messages';

type L = Record<string, string>;
type Result = { results: Array<{ email: string; outcome: string }>; summary: Record<string, number> };
const MAX_FILE_BYTES = 200_000;
const GOOD = new Set(['ENROLLED', 'INVITED']);

function BulkEmailForm({
  kind,
  url,
  classes,
  fixedClassId,
  l,
}: {
  kind: 'students' | 'teachers';
  url: string;
  classes?: Array<{ id: string; label: string }>;
  fixedClassId?: string;
  l: L;
}) {
  const router = useRouter();
  const uid = useId();
  const needsClass = kind === 'students';
  const [text, setText] = useState('');
  const [classId, setClassId] = useState(fixedClassId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const entries = parseEmailText(text);
  const count = normalizeEmailList(entries).emails.length;
  const tooMany = entries.length > BULK_EMAIL_LIMIT;
  const ready = entries.length > 0 && !tooMany && (!needsClass || !!classId);

  return (
    <form
      className="ta-form"
      aria-labelledby={`${uid}-title`}
      data-bulk={kind}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ready) return;
        setBusy(true);
        setError(null);
        setResult(null);
        try {
          const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(needsClass ? { classId, emails: entries } : { emails: entries }) });
          const j = await r.json().catch(() => ({}));
          if (r.ok && j?.data?.results) {
            setResult(j.data as Result);
            setText('');
            router.refresh();
          } else setError(r.status === 403 ? l['irost.bulk.forbidden'] : l['irost.bulk.error']);
        } catch {
          setError(l['irost.bulk.error']);
        }
        setBusy(false);
      }}
    >
      <h2 id={`${uid}-title`}>{l[`irost.bulk.${kind}.title`]}</h2>
      <label className="ta-field">
        <span>{l['irost.bulk.list']}</span>
        <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} aria-describedby={`${uid}-hint ${uid}-count`} spellCheck={false} autoCapitalize="off" />
      </label>
      <span id={`${uid}-hint`} className="ta-msg">
        {fill(l['irost.bulk.listHint'], { max: BULK_EMAIL_LIMIT })}
      </span>
      <label className="ta-field">
        <span>{l['irost.bulk.file']}</span>
        <input
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            if (file.size > MAX_FILE_BYTES) return setError(l['irost.bulk.fileTooLarge']);
            setError(null);
            const found = parseEmailText(await file.text());
            setText((prev) => [prev.trim(), ...found].filter(Boolean).join('\n'));
          }}
        />
      </label>
      {needsClass && !fixedClassId && (
        <label className="ta-field">
          <span>{l['irost.bulk.class']}</span>
          <select required value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="" disabled>
              {l['irost.bulk.chooseClass']}
            </option>
            {(classes ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <span className="ta-msg">{l[`irost.bulk.${kind}.hint`]}</span>
      <div className="ta-row">
        <button className="btn btn-primary" type="submit" disabled={busy || !ready} aria-busy={busy}>
          {l[`irost.bulk.${kind}.submit`]}
        </button>
        <span id={`${uid}-count`} className="ta-msg" role={tooMany ? 'alert' : 'status'}>
          {tooMany ? fill(l['irost.bulk.tooMany'], { n: entries.length, max: BULK_EMAIL_LIMIT }) : entries.length > 0 ? fill(l['irost.bulk.count'], { n: count }) : ''}
        </span>
      </div>
      {error ? (
        <span className="ta-msg" role="alert">
          {error}
        </span>
      ) : null}
      {result ? (
        <div role="status" data-bulk-result>
          <strong>{l['irost.bulk.result']}</strong>
          <ul>
            {Object.entries(result.summary).map(([outcome, n]) => (
              <li key={outcome} data-outcome={outcome}>
                {l[`irost.bulk.outcome.${outcome}`] ?? outcome}: {n}
              </li>
            ))}
          </ul>
          {result.results.some((r) => !GOOD.has(r.outcome)) ? (
            <details className="ui-disclosure">
              <summary>{l['irost.bulk.details']}</summary>
              <ul>
                {result.results
                  .filter((r) => !GOOD.has(r.outcome))
                  .map((r) => (
                    <li key={r.email} style={{ overflowWrap: 'anywhere' }}>
                      {r.email} — {l[`irost.bulk.outcome.${r.outcome}`] ?? r.outcome}
                    </li>
                  ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}

export function BulkAddStudentsForm({ institutionId, classes, fixedClassId, l }: { institutionId: string; classes: Array<{ id: string; label: string }>; fixedClassId?: string; l: L }) {
  if (!fixedClassId && classes.length === 0) return null;
  return <BulkEmailForm kind="students" url={`/api/institutions/${institutionId}/students/bulk`} classes={classes} fixedClassId={fixedClassId} l={l} />;
}

export function BulkInviteTeachersForm({ institutionId, l }: { institutionId: string; l: L }) {
  return <BulkEmailForm kind="teachers" url={`/api/institutions/${institutionId}/teachers/bulk`} l={l} />;
}
