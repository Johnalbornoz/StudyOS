'use client';

/**
 * Track A -- Institution workspace: the operational controls (coordinator).
 * Every control calls a tenant-scoped, audited route and refreshes the server page.
 * Labels come from the iops.* catalog (`l`); server errors are shown with their own message.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

type L = Record<string, string>;
type Res = { ok: boolean; data?: any; error?: string };

export async function send(url: string, method: string, body?: unknown): Promise<Res> {
  try {
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, data: j?.data, error: j?.error };
  } catch {
    return { ok: false };
  }
}
const errText = (l: L, code?: string) => (code && l[`iops.err.${code}`]) || l['iops.common.error'];

function Msg({ state, l }: { state: null | { ok: boolean; text: string }; l: L }) {
  void l;
  if (!state) return null;
  return (
    <span className="ta-msg" role={state.ok ? 'status' : 'alert'}>
      {state.text}
    </span>
  );
}

// ---------------------------------------------------------------------------- ⋯ row menu

export interface MenuItem {
  label: string;
  href?: string;
  action?: { url: string; method?: string; body?: unknown; confirm?: string };
  danger?: boolean;
}

/** "⋯" menu of a row: only the actions valid for the entity and its state are passed in. */
export function RowMenu({ items, label, l }: { items: MenuItem[]; label: string; l: L }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (items.length === 0) return null;
  return (
    <span className="ta-rowmenu">
      <details className="ta-menu">
        <summary aria-label={`${l['iops.common.menu']}: ${label}`} title={l['iops.common.menu']}>
          ⋯
        </summary>
        <ul role="menu">
          {items.map((it) => (
            <li key={it.label} role="none">
              {it.href ? (
                <Link role="menuitem" href={it.href} className="ta-menu-item">
                  {it.label}
                </Link>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  className={`ta-menu-item${it.danger ? ' is-danger' : ''}`}
                  disabled={busy}
                  onClick={async () => {
                    if (!it.action) return;
                    if (it.action.confirm && !window.confirm(it.action.confirm)) return;
                    setBusy(true);
                    setError(null);
                    const r = await send(it.action.url, it.action.method ?? 'POST', it.action.body);
                    setBusy(false);
                    if (r.ok) router.refresh();
                    else setError(errText(l, r.error));
                  }}
                >
                  {it.label}
                </button>
              )}
            </li>
          ))}
        </ul>
      </details>
      {error && (
        <span className="ta-msg" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------- grades

export function GradeForm({
  institutionId,
  programmes,
  initial,
  gradeId,
  l,
  id = 'grade-form',
}: {
  institutionId: string;
  programmes: Array<{ id: string; name: string }>;
  initial?: { name: string; academicLevel: string | null; programmeLabel: string | null; academicProgrammeId: string | null; academicYear: string | null };
  gradeId?: string;
  l: L;
  id?: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? '');
  const [level, setLevel] = useState(initial?.academicLevel ?? '');
  const [programme, setProgramme] = useState(initial?.academicProgrammeId ?? '');
  const [programmeLabel, setProgrammeLabel] = useState(initial?.academicProgrammeId ? '' : initial?.programmeLabel ?? '');
  const [year, setYear] = useState(initial?.academicYear ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<null | { ok: boolean; text: string }>(null);
  return (
    <form
      className="ta-form"
      aria-labelledby={`${id}-title`}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        setBusy(true);
        const body = { name: name.trim(), academicLevel: level.trim() || null, academicProgrammeId: programme || null, programmeLabel: programme ? null : programmeLabel.trim() || null, academicYear: year.trim() || null };
        const r = gradeId ? await send(`/api/institutions/${institutionId}/grades/${gradeId}`, 'PATCH', body) : await send(`/api/institutions/${institutionId}/grades`, 'POST', body);
        setBusy(false);
        setMsg(r.ok ? { ok: true, text: l['iops.common.saved'] } : { ok: false, text: errText(l, r.error) });
        if (r.ok) {
          if (!gradeId) setName('');
          router.refresh();
        }
      }}
    >
      <h2 id={`${id}-title`}>{gradeId ? l['iops.common.edit'] : l['iops.grades.create']}</h2>
      <label className="ta-field">
        <span>{l['iops.grades.name']}</span>
        <input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="ta-field">
        <span>
          {l['iops.grades.level']} <span className="ta-msg">({l['iops.common.optional']})</span>
        </span>
        <input maxLength={120} value={level} placeholder={l['iops.grades.levelPlaceholder']} onChange={(e) => setLevel(e.target.value)} />
      </label>
      <label className="ta-field">
        <span>
          {l['iops.grades.programme']} <span className="ta-msg">({l['iops.common.optional']})</span>
        </span>
        <select value={programme} onChange={(e) => setProgramme(e.target.value)}>
          <option value="">—</option>
          {programmes.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      {!programme && (
        <label className="ta-field">
          <span className="sr-only">{l['iops.grades.programme']}</span>
          <input maxLength={120} value={programmeLabel} placeholder={l['iops.grades.programme']} onChange={(e) => setProgrammeLabel(e.target.value)} />
        </label>
      )}
      <label className="ta-field">
        <span>
          {l['iops.grades.year']} <span className="ta-msg">({l['iops.common.optional']})</span>
        </span>
        <input maxLength={20} value={year} placeholder="2026-2027" onChange={(e) => setYear(e.target.value)} />
      </label>
      <div className="ta-row">
        <button className="btn btn-primary" type="submit" disabled={busy || !name.trim()} aria-busy={busy}>
          {gradeId ? l['iops.common.save'] : l['iops.grades.create']}
        </button>
        <Msg state={msg} l={l} />
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------- classes

export interface CurriculumOption {
  id: string;
  label: string;
  gradeId: string | null;
  academicDomain: string | null;
}

export function ClassForm({
  institutionId,
  grades,
  domains,
  curricula,
  teachers,
  initial,
  classId,
  l,
  id = 'class-form',
}: {
  institutionId: string;
  grades: Array<{ id: string; name: string }>;
  domains: Array<{ code: string; label: string }>;
  curricula: CurriculumOption[];
  teachers: Array<{ membershipId: string; label: string }>;
  initial?: { name: string; gradeId: string | null; academicDomain: string | null; period: string | null };
  classId?: string;
  l: L;
  id?: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? '');
  const [gradeId, setGradeId] = useState(initial?.gradeId ?? '');
  const [domain, setDomain] = useState(initial?.academicDomain ?? '');
  const [curriculumId, setCurriculumId] = useState(''); // never preselected
  const [period, setPeriod] = useState(initial?.period ?? '');
  const [teacher, setTeacher] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<null | { ok: boolean; text: string }>(null);
  // Same area (or class without area) and usable for the grade: a suggestion list, nothing chosen.
  const compatible = curricula.filter((c) => (!gradeId || !c.gradeId || c.gradeId === gradeId) && (!domain || !c.academicDomain || c.academicDomain === domain));
  if (grades.length === 0 && !classId) return <p className="ta-msg">{l['iops.classes.needGrade']}</p>;
  return (
    <form
      className="ta-form"
      aria-labelledby={`${id}-title`}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim() || !gradeId) return;
        setBusy(true);
        const r = classId
          ? await send(`/api/institutions/${institutionId}/classes/${classId}`, 'PATCH', { name: name.trim(), gradeId, academicDomainCode: domain || null, period: period.trim() || null })
          : await send(`/api/institutions/${institutionId}/classes`, 'POST', {
              name: name.trim(),
              gradeId,
              academicDomainCode: domain || null,
              institutionCurriculumId: curriculumId && compatible.some((c) => c.id === curriculumId) ? curriculumId : null,
              period: period.trim() || null,
              teacherMembershipId: teacher || null,
            });
        setBusy(false);
        setMsg(r.ok ? { ok: true, text: l['iops.common.saved'] } : { ok: false, text: errText(l, r.error) });
        if (r.ok) {
          if (!classId) {
            setName('');
            setCurriculumId('');
            setTeacher('');
          }
          router.refresh();
        }
      }}
    >
      <h2 id={`${id}-title`}>{classId ? l['iops.classes.edit'] : l['iops.classes.create']}</h2>
      <label className="ta-field">
        <span>{l['iops.classes.name']}</span>
        <input required maxLength={80} value={name} placeholder={l['iops.classes.namePlaceholder']} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="ta-field">
        <span>{l['iops.classes.grade']}</span>
        <select required value={gradeId} onChange={(e) => setGradeId(e.target.value)}>
          <option value="" disabled>
            {l['iops.classes.chooseGrade']}
          </option>
          {grades.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </label>
      <label className="ta-field">
        <span>{l['iops.classes.domain']}</span>
        <select value={domain} onChange={(e) => setDomain(e.target.value)}>
          <option value="">{l['iops.classes.noDomain']}</option>
          {domains.map((d) => (
            <option key={d.code} value={d.code}>
              {d.label}
            </option>
          ))}
        </select>
      </label>
      {!classId && (
        <label className="ta-field">
          <span>
            {l['iops.classes.curriculum']} <span className="ta-msg">({l['iops.common.optional']})</span>
          </span>
          <select value={curriculumId} onChange={(e) => setCurriculumId(e.target.value)} aria-describedby={`${id}-cur-hint`}>
            <option value="">{l['iops.classes.noCurriculum']}</option>
            {compatible.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <span id={`${id}-cur-hint`} className="ta-msg">
            {l['iops.classes.curriculumHint']}
          </span>
        </label>
      )}
      <label className="ta-field">
        <span>
          {l['iops.classes.period']} <span className="ta-msg">({l['iops.common.optional']})</span>
        </span>
        <input maxLength={40} value={period} placeholder={l['iops.classes.periodPlaceholder']} onChange={(e) => setPeriod(e.target.value)} />
      </label>
      {!classId && (
        <label className="ta-field">
          <span>
            {l['iops.classes.teacher']} <span className="ta-msg">({l['iops.common.optional']})</span>
          </span>
          <select value={teacher} onChange={(e) => setTeacher(e.target.value)}>
            <option value="">{l['iops.classes.noTeacher']}</option>
            {teachers.map((t) => (
              <option key={t.membershipId} value={t.membershipId}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="ta-row">
        <button className="btn btn-primary" type="submit" disabled={busy || !name.trim() || !gradeId} aria-busy={busy}>
          {classId ? l['iops.common.save'] : l['iops.classes.create']}
        </button>
        <Msg state={msg} l={l} />
      </div>
    </form>
  );
}

/** The class's teacher (atomic change). */
export function ClassTeacherSelect({ institutionId, classId, current, teachers, l }: { institutionId: string; classId: string; current: string | null; teachers: Array<{ membershipId: string; label: string }>; l: L }) {
  const router = useRouter();
  const [value, setValue] = useState(current ?? '');
  const [msg, setMsg] = useState<null | { ok: boolean; text: string }>(null);
  return (
    <span className="ta-form ta-row" style={{ alignItems: 'flex-end' }}>
      <label className="ta-field">
        <span>{l['iops.classes.teacher']}</span>
        <select value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="">{l['iops.classes.noTeacher']}</option>
          {teachers.map((t) => (
            <option key={t.membershipId} value={t.membershipId}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="btn btn-secondary"
        disabled={value === (current ?? '')}
        onClick={async () => {
          const r = await send(`/api/institutions/${institutionId}/classes/${classId}/teacher`, 'POST', { membershipId: value || null });
          setMsg(r.ok ? { ok: true, text: l['iops.common.saved'] } : { ok: false, text: errText(l, r.error) });
          if (r.ok) router.refresh();
        }}
      >
        {current ? l['iops.classes.changeTeacher'] : l['iops.classes.assignTeacher']}
      </button>
      <Msg state={msg} l={l} />
    </span>
  );
}

// ---------------------------------------------------------------------------- teachers

export function InviteTeacherForm({ institutionId, l }: { institutionId: string; l: L }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<null | { ok: boolean; text: string }>(null);
  return (
    <form
      className="ta-form"
      aria-labelledby="invite-teacher-title"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const r = await send(`/api/institutions/${institutionId}/teachers`, 'POST', { email: email.trim() });
        setBusy(false);
        setMsg(r.ok ? { ok: true, text: r.data?.status === 'APPROVED' ? l['iops.teachers.approvedNow'] : l['iops.teachers.invited'] } : { ok: false, text: errText(l, r.error) });
        if (r.ok) {
          setEmail('');
          router.refresh();
        }
      }}
    >
      <h2 id="invite-teacher-title">{l['iops.teachers.invite']}</h2>
      <label className="ta-field">
        <span>{l['iops.teachers.email']}</span>
        <input type="email" required maxLength={320} value={email} onChange={(e) => setEmail(e.target.value)} aria-describedby="invite-teacher-hint" />
      </label>
      <span id="invite-teacher-hint" className="ta-msg">
        {l['iops.teachers.inviteHint']}
      </span>
      <div className="ta-row">
        <button className="btn btn-primary" type="submit" disabled={busy || !email.trim()} aria-busy={busy}>
          {l['iops.teachers.invite']}
        </button>
        <Msg state={msg} l={l} />
      </div>
    </form>
  );
}

/** Assign an approved teacher to one more class (class-scoped assignment). */
export function AssignClassForm({ institutionId, membershipId, classes, l }: { institutionId: string; membershipId: string; classes: Array<{ id: string; label: string }>; l: L }) {
  const router = useRouter();
  const [classId, setClassId] = useState('');
  const [msg, setMsg] = useState<null | { ok: boolean; text: string }>(null);
  if (!classes.length) return null;
  return (
    <span className="ta-form ta-row" style={{ alignItems: 'flex-end' }}>
      <label className="ta-field">
        <span className="sr-only">{l['iops.teachers.assignClass']}</span>
        <select value={classId} onChange={(e) => setClassId(e.target.value)}>
          <option value="">{l['iops.teachers.assignClass']}</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="btn btn-secondary"
        disabled={!classId}
        onClick={async () => {
          const r = await send(`/api/institutions/${institutionId}/assignments`, 'POST', { institutionMembershipId: membershipId, classId });
          setMsg(r.ok ? { ok: true, text: l['iops.common.saved'] } : { ok: false, text: errText(l, r.error) });
          if (r.ok) {
            setClassId('');
            router.refresh();
          }
        }}
      >
        {l['iops.teachers.assignClass']}
      </button>
      <Msg state={msg} l={l} />
    </span>
  );
}

// ---------------------------------------------------------------------------- students

export function AddStudentForm({ institutionId, classes, fixedClassId, l }: { institutionId: string; classes: Array<{ id: string; label: string }>; fixedClassId?: string; l: L }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [classId, setClassId] = useState(fixedClassId ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<null | { ok: boolean; text: string }>(null);
  if (!fixedClassId && classes.length === 0) return <p className="ta-msg">{l['iops.students.needClass']}</p>;
  return (
    <form
      className="ta-form"
      aria-labelledby="add-student-title"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!email.trim() || !classId) return;
        setBusy(true);
        const r = await send(`/api/institutions/${institutionId}/students`, 'POST', { email: email.trim(), classId });
        setBusy(false);
        setMsg(r.ok ? { ok: true, text: r.data?.outcome === 'ENROLLED' ? l['iops.students.enrolled'] : l['iops.students.invitedOk'] } : { ok: false, text: errText(l, r.error) });
        if (r.ok) {
          setEmail('');
          router.refresh();
        }
      }}
    >
      <h2 id="add-student-title">{l['iops.students.add']}</h2>
      <label className="ta-field">
        <span>{l['iops.students.email']}</span>
        <input type="email" required maxLength={320} value={email} onChange={(e) => setEmail(e.target.value)} aria-describedby="add-student-hint" />
      </label>
      {!fixedClassId && (
        <label className="ta-field">
          <span>{l['iops.students.class']}</span>
          <select required value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="" disabled>
              {l['iops.students.chooseClass']}
            </option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <span id="add-student-hint" className="ta-msg">
        {l['iops.students.addHint']}
      </span>
      <div className="ta-row">
        <button className="btn btn-primary" type="submit" disabled={busy || !email.trim() || !classId} aria-busy={busy}>
          {l['iops.students.add']}
        </button>
        <Msg state={msg} l={l} />
      </div>
    </form>
  );
}

/** Move a student between classes, or enroll in one more class. */
export function StudentClassAction({
  institutionId,
  studentId,
  mode,
  fromOptions,
  toOptions,
  l,
}: {
  institutionId: string;
  studentId: string;
  mode: 'move' | 'enroll';
  fromOptions: Array<{ id: string; label: string }>;
  toOptions: Array<{ id: string; label: string }>;
  l: L;
}) {
  const router = useRouter();
  const [from, setFrom] = useState(fromOptions[0]?.id ?? '');
  const [to, setTo] = useState('');
  const [msg, setMsg] = useState<null | { ok: boolean; text: string }>(null);
  if (!toOptions.length || (mode === 'move' && !fromOptions.length)) return null;
  return (
    <span className="ta-form ta-row" style={{ alignItems: 'flex-end' }}>
      {mode === 'move' && (
        <label className="ta-field">
          <span>{l['iops.students.from']}</span>
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            {fromOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="ta-field">
        <span>{mode === 'move' ? l['iops.students.to'] : l['iops.students.enrollIn']}</span>
        <select value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">—</option>
          {toOptions.filter((c) => c.id !== from || mode === 'enroll').map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="btn btn-secondary"
        disabled={!to}
        onClick={async () => {
          const r =
            mode === 'move'
              ? await send(`/api/institutions/${institutionId}/students/${studentId}/move`, 'POST', { fromClassId: from, toClassId: to })
              : await send(`/api/institutions/${institutionId}/students/${studentId}/enroll`, 'POST', { classId: to });
          setMsg(r.ok ? { ok: true, text: l['iops.common.saved'] } : { ok: false, text: errText(l, r.error) });
          if (r.ok) {
            setTo('');
            router.refresh();
          }
        }}
      >
        {mode === 'move' ? l['iops.students.move'] : l['iops.students.enrollIn']}
      </button>
      <Msg state={msg} l={l} />
    </span>
  );
}

// ---------------------------------------------------------------------------- teacher side

export function TeacherInvitationActions({ membershipId, l }: { membershipId: string; l: L }) {
  const router = useRouter();
  const [msg, setMsg] = useState<null | { ok: boolean; text: string }>(null);
  const respond = async (accept: boolean) => {
    const r = await send(`/api/teacher/institution-invitations/${membershipId}/respond`, 'POST', { accept });
    setMsg(r.ok ? { ok: true, text: l['iops.common.saved'] } : { ok: false, text: errText(l, r.error) });
    if (r.ok) router.refresh();
  };
  return (
    <span className="ta-row">
      <button type="button" className="btn btn-primary" onClick={() => respond(true)}>
        {l['iops.tinv.accept']}
      </button>
      <button type="button" className="btn btn-secondary" onClick={() => respond(false)}>
        {l['iops.tinv.decline']}
      </button>
      <Msg state={msg} l={l} />
    </span>
  );
}
