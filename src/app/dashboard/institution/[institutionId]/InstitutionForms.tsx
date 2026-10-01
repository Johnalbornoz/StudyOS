'use client';

/**
 * Track A (A4) -- the institution admin's write controls. Every one posts
 * to an institution-scoped route that re-checks, server-side, that the
 * actor is an APPROVED INSTITUTION_ADMIN of THIS institution and that the
 * grade / class / membership / enrollment belongs to it. These components
 * make no authorization decision themselves.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Msg = { text: string; error?: boolean } | null;

function Feedback({ message }: { message: Msg }) {
  if (!message) return null;
  return (
    <p role={message.error ? 'alert' : 'status'} className={message.error ? 'ta-msg ta-msg-error' : 'ta-msg'}>
      {message.text}
    </p>
  );
}

async function postJson(url: string, body: unknown, method: 'POST' | 'PATCH' = 'POST'): Promise<Response> {
  return fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
}

export function CreateGradeForm({ institutionId, labels }: { institutionId: string; labels: { name: string; submit: string; saved: string; error: string } }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Msg>(null);
  return (
    <form
      className="ta-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        setBusy(true);
        const res = await postJson(`/api/institutions/${institutionId}/grades`, { name: name.trim() });
        setMessage(res.ok ? { text: labels.saved } : { text: labels.error, error: true });
        setBusy(false);
        if (res.ok) {
          setName('');
          router.refresh();
        }
      }}
    >
      <label htmlFor="grade-name">{labels.name}</label>
      <div className="ta-row">
        <input id="grade-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
          {labels.submit}
        </button>
      </div>
      <Feedback message={message} />
    </form>
  );
}

export function CreateClassForm({
  institutionId,
  grades,
  subjects,
  labels,
}: {
  institutionId: string;
  grades: Array<{ id: string; name: string }>;
  /** ACTIVE catalog subjects the class can be linked to. */
  subjects: Array<{ id: string; name: string }>;
  labels: { title: string; name: string; grade: string; noGrade: string; subject: string; noSubject: string; submit: string; saved: string; error: string };
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [gradeId, setGradeId] = useState(grades[0]?.id ?? '');
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Msg>(null);
  return (
    <form
      className="ta-form card ta-card"
      aria-label={labels.title}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        setBusy(true);
        const res = await postJson(`/api/institutions/${institutionId}/classes`, { name: name.trim(), gradeId: gradeId || null, canonicalSubjectId: subjectId || null });
        setMessage(res.ok ? { text: labels.saved } : { text: labels.error, error: true });
        setBusy(false);
        if (res.ok) {
          setName('');
          router.refresh();
        }
      }}
    >
      <h2>{labels.title}</h2>
      <label htmlFor="class-name">{labels.name}</label>
      <input id="class-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      <label htmlFor="class-grade">{labels.grade}</label>
      <select id="class-grade" value={gradeId} onChange={(e) => setGradeId(e.target.value)}>
        <option value="">{labels.noGrade}</option>
        {grades.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
      <label htmlFor="class-subject">{labels.subject}</label>
      <select id="class-subject" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
        <option value="">{labels.noSubject}</option>
        {subjects.map((sub) => (
          <option key={sub.id} value={sub.id}>
            {sub.name}
          </option>
        ))}
      </select>
      <div className="ta-actions">
        <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
          {labels.submit}
        </button>
      </div>
      <Feedback message={message} />
    </form>
  );
}

/** Link (or change) the catalog subject of one class. */
export function SetClassSubjectForm({
  institutionId,
  classId,
  currentSubjectId,
  subjects,
  labels,
}: {
  institutionId: string;
  classId: string;
  currentSubjectId: string | null;
  subjects: Array<{ id: string; name: string }>;
  labels: { label: string; submit: string; saved: string; error: string };
}) {
  const router = useRouter();
  const [subjectId, setSubjectId] = useState(currentSubjectId ?? subjects[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Msg>(null);
  return (
    <form
      className="ta-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!subjectId) return;
        setBusy(true);
        const res = await postJson(`/api/institutions/${institutionId}/classes/${classId}`, { canonicalSubjectId: subjectId }, 'PATCH');
        setMessage(res.ok ? { text: labels.saved } : { text: labels.error, error: true });
        setBusy(false);
        if (res.ok) router.refresh();
      }}
    >
      <label htmlFor={`class-subject-${classId}`}>{labels.label}</label>
      <div className="ta-row">
        <select id={`class-subject-${classId}`} value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
          {subjects.map((sub) => (
            <option key={sub.id} value={sub.id}>
              {sub.name}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-primary" disabled={busy || !subjectId || subjectId === currentSubjectId}>
          {labels.submit}
        </button>
      </div>
      <Feedback message={message} />
    </form>
  );
}

export function InviteStudentForm({
  institutionId,
  classId,
  endpoint,
  labels,
}: {
  institutionId: string;
  classId: string;
  /** Defaults to the institution-admin route; the Teacher passes its own class-scoped route. */
  endpoint?: string;
  labels: { label: string; body: string; submit: string; sent: string; noAccount: string; already: string; error: string };
}) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Msg>(null);
  return (
    <form
      className="ta-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!email.trim()) return;
        setBusy(true);
        const res = await postJson(endpoint ?? `/api/institutions/${institutionId}/classes/${classId}/enrollments`, { email: email.trim() });
        const body = await res.json().catch(() => ({}));
        if (res.status === 404 && body?.error === 'NO_STUDENT_ACCOUNT') setMessage({ text: labels.noAccount, error: true });
        else if (!res.ok) setMessage({ text: labels.error, error: true });
        else if (body?.data?.outcome === 'INVITED') {
          setMessage({ text: labels.sent });
          setEmail('');
          router.refresh();
        } else setMessage({ text: labels.already });
        setBusy(false);
      }}
    >
      <label htmlFor="invite-email">{labels.label}</label>
      <p className="ta-msg">{labels.body}</p>
      <div className="ta-row">
        <input id="invite-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="correo@ejemplo.com" />
        <button type="submit" className="btn btn-primary" disabled={busy || !email.trim()}>
          {labels.submit}
        </button>
      </div>
      <Feedback message={message} />
    </form>
  );
}

export function AssignTeacherForm({
  institutionId,
  teachers,
  scopes,
  fixedScope,
  labels,
}: {
  institutionId: string;
  teachers: Array<{ membershipId: string; email: string | null; name?: string | null }>;
  /** Selectable scopes (class or whole grade); omitted when `fixedScope` is given. */
  scopes?: Array<{ value: string; label: string }>;
  fixedScope?: { classId: string };
  labels: { title: string; selectTeacher: string; scope?: string; submit: string; none: string; saved: string; error: string; scopeRequired: string };
}) {
  const router = useRouter();
  const [membershipId, setMembershipId] = useState(teachers[0]?.membershipId ?? '');
  const [scope, setScope] = useState(scopes?.[0]?.value ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Msg>(null);
  if (teachers.length === 0) return <p className="ta-msg">{labels.none}</p>;
  return (
    <form
      className="ta-form"
      onSubmit={async (e) => {
        e.preventDefault();
        let body: Record<string, string>;
        if (fixedScope) body = { institutionMembershipId: membershipId, classId: fixedScope.classId };
        else if (scope.startsWith('class:')) body = { institutionMembershipId: membershipId, classId: scope.slice(6) };
        else if (scope.startsWith('grade:')) body = { institutionMembershipId: membershipId, gradeId: scope.slice(6) };
        else {
          setMessage({ text: labels.scopeRequired, error: true });
          return;
        }
        setBusy(true);
        const res = await postJson(`/api/institutions/${institutionId}/assignments`, body);
        setMessage(res.ok ? { text: labels.saved } : { text: labels.error, error: true });
        setBusy(false);
        if (res.ok) router.refresh();
      }}
    >
      <label htmlFor={`assign-teacher-${fixedScope?.classId ?? 'any'}`}>{labels.title}</label>
      <div className="ta-row">
        <select id={`assign-teacher-${fixedScope?.classId ?? 'any'}`} aria-label={labels.selectTeacher} value={membershipId} onChange={(e) => setMembershipId(e.target.value)}>
          {teachers.map((tch) => (
            <option key={tch.membershipId} value={tch.membershipId}>
              {tch.name && tch.email ? `${tch.name} · ${tch.email}` : (tch.name ?? tch.email ?? tch.membershipId)}
            </option>
          ))}
        </select>
        {!fixedScope && scopes && (
          <select aria-label={labels.scope} value={scope} onChange={(e) => setScope(e.target.value)}>
            {scopes.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy || !membershipId}>
          {labels.submit}
        </button>
      </div>
      <Feedback message={message} />
    </form>
  );
}

/** A single confirmed POST (remove from class, end assignment, revoke...). */
export function PostActionButton({ url, label, errorLabel, confirmText }: { url: string; label: string; errorLabel: string; confirmText?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  return (
    <span className="ta-actions">
      <button
        type="button"
        className="btn btn-ghost"
        disabled={busy}
        onClick={async () => {
          if (confirmText && !window.confirm(confirmText)) return;
          setBusy(true);
          setError(false);
          const res = await postJson(url, {});
          setBusy(false);
          if (res.ok) router.refresh();
          else setError(true);
        }}
      >
        {label}
      </button>
      {error && (
        <span role="alert" className="ta-msg ta-msg-error">
          {errorLabel}
        </span>
      )}
    </span>
  );
}
