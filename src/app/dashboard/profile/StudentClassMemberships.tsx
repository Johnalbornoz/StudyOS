'use client';

/**
 * L9 IN-3 -- "Tus clases": the Student's own ACTIVE classes, each with "Salir de la clase".
 * Self-loading (GET /api/student/class-enrollments) so the card that mounts it needs no new
 * props; renders nothing until there is at least one class. Leaving asks for confirmation in
 * place, says what changes (teachers stop seeing progress through the class; history is kept)
 * and calls POST /api/student/class-enrollments/[id]/leave.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fillRosterMessage as fill, rosterMessages } from '@/lib/i18n/institution-roster-messages';

interface Enrollment {
  enrollmentId: string;
  classId: string;
  className: string;
  institutionName: string;
}

export function StudentClassMemberships() {
  const router = useRouter();
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [l, setL] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<null | { ok: boolean; text: string }>(null);

  useEffect(() => {
    let live = true;
    fetch('/api/student/class-enrollments')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!live || !j?.data) return;
        setL(rosterMessages(j.data.locale));
        setEnrollments(j.data.enrollments ?? []);
      })
      .catch(() => null);
    return () => {
      live = false;
    };
  }, []);

  if (enrollments.length === 0 && !msg) return null;

  const leave = async (e: Enrollment) => {
    setBusy(true);
    let ok = false;
    try {
      ok = (await fetch(`/api/student/class-enrollments/${e.enrollmentId}/leave`, { method: 'POST' })).ok;
    } catch {
      ok = false;
    }
    setBusy(false);
    setConfirming(null);
    setMsg({ ok, text: ok ? fill(l['irost.leave.done'], { className: e.className }) : l['irost.leave.error'] });
    if (ok) {
      setEnrollments((prev) => prev.filter((x) => x.enrollmentId !== e.enrollmentId));
      router.refresh();
    }
  };

  return (
    <div data-student-classes role="group" aria-labelledby="irost-leave-title">
      <h3 id="irost-leave-title" className="ex-status-title">
        {l['irost.leave.title']}
      </h3>
      {enrollments.length > 0 ? <p className="ui-hint">{l['irost.leave.lead']}</p> : null}
      <ul className="jx-subjects">
        {enrollments.map((e) => (
          <li key={e.enrollmentId} data-enrollment={e.enrollmentId}>
            <span style={{ overflowWrap: 'anywhere' }}>
              {e.className} · {e.institutionName}
            </span>{' '}
            {confirming === e.enrollmentId ? (
              <span role="group" aria-label={l['irost.leave.action']}>
                <span className="ui-hint" style={{ display: 'block' }}>
                  {fill(l['irost.leave.confirmBody'], { className: e.className })}
                </span>
                <button type="button" className="btn btn-secondary" disabled={busy} aria-busy={busy} onClick={() => leave(e)}>
                  {l['irost.leave.confirm']}
                </button>{' '}
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setConfirming(null)}>
                  {l['irost.leave.cancel']}
                </button>
              </span>
            ) : (
              <button type="button" className="btn btn-ghost" aria-label={`${l['irost.leave.action']}: ${e.className}`} onClick={() => { setMsg(null); setConfirming(e.enrollmentId); }}>
                {l['irost.leave.action']}
              </button>
            )}
          </li>
        ))}
      </ul>
      {msg ? (
        <p className="ui-hint" role={msg.ok ? 'status' : 'alert'}>
          {msg.text}
        </p>
      ) : null}
    </div>
  );
}
