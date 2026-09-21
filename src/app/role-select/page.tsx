'use client';

/**
 * Onboarding/authorization rework (2026-09-21) -- rewrite of F1's own
 * minimal role-selection page. Still deliberately outside `/dashboard`
 * (whose layout now redirects a zero-role account HERE rather than
 * defaulting to Student -- see src/app/dashboard/layout.tsx). Talks
 * only to `/api/identity/*`, `/api/parent/invitations*`,
 * `/api/student/parent-invitations`, `/api/institutions*`, and
 * `/api/teacher/my-memberships` -- every one of them already enforces
 * its own server-side authorization; this page renders their real
 * state, it never decides access itself.
 *
 * Self-service role selection is restricted server-side to STUDENT /
 * PARENT / TEACHER (`/api/identity/roles/select`'s own Zod enum) --
 * INSTITUTION_ADMIN and STUDYUS_ADMIN are never offered here and
 * cannot be requested through this page by construction.
 */
import { useEffect, useState, useCallback } from 'react';

type Workspace = 'STUDENT' | 'PARENT' | 'TEACHER' | 'INSTITUTION' | 'ADMIN';
type SelfServiceRole = 'STUDENT' | 'PARENT' | 'TEACHER';

interface IdentityState {
  roles: string[];
  availableWorkspaces: Workspace[];
  activeWorkspace: Workspace | null;
}

interface ParentInvitation {
  id: string;
  studentId: string;
  studentName: string;
  createdAt: string;
}

interface SentInvitation {
  id: string;
  invitedEmail: string;
  status: 'pending' | 'accepted' | 'declined' | 'revoked';
  createdAt: string;
}

interface TeacherMembership {
  id: string;
  institutionId: string;
  institutionName: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'REVOKED';
}

interface InstitutionOption {
  id: string;
  name: string;
}

const SELF_SERVICE_ROLES: SelfServiceRole[] = ['STUDENT', 'PARENT', 'TEACHER'];
const ROLE_LABELS: Record<SelfServiceRole, string> = {
  STUDENT: 'Estudiante',
  PARENT: 'Padre, madre, tutor o coach',
  TEACHER: 'Profesor',
};
const WORKSPACE_LABELS: Record<Workspace, string> = {
  STUDENT: 'Estudiante',
  PARENT: 'Padre/Madre',
  TEACHER: 'Profesor',
  INSTITUTION: 'Institución',
  ADMIN: 'Administración',
};

function card(): React.CSSProperties {
  return { padding: 'var(--space-3)', border: '1px solid var(--border-color, #ddd)', borderRadius: 8, marginBottom: 'var(--space-2)' };
}

export default function RoleSelectPage() {
  const [state, setState] = useState<IdentityState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [parentInvitations, setParentInvitations] = useState<ParentInvitation[] | null>(null);
  const [sentInvitations, setSentInvitations] = useState<SentInvitation[] | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [teacherMemberships, setTeacherMemberships] = useState<TeacherMembership[] | null>(null);
  const [institutions, setInstitutions] = useState<InstitutionOption[] | null>(null);
  const [selectedInstitutionId, setSelectedInstitutionId] = useState('');

  const refresh = useCallback(async () => {
    const res = await fetch('/api/identity/me');
    if (res.status === 401) {
      window.location.href = '/sign-in';
      return;
    }
    const body = await res.json();
    setState(body.data);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!state) return;
    if (state.roles.includes('PARENT')) {
      fetch('/api/parent/invitations').then((r) => r.json()).then((b) => setParentInvitations(b.data?.invitations ?? []));
    }
    if (state.roles.includes('STUDENT')) {
      fetch('/api/student/parent-invitations').then((r) => r.json()).then((b) => setSentInvitations(b.data?.invitations ?? []));
    }
    if (state.roles.includes('TEACHER')) {
      fetch('/api/teacher/my-memberships').then((r) => r.json()).then((b) => setTeacherMemberships(b.data?.memberships ?? []));
    }
  }, [state]);

  async function selectRole(role: SelfServiceRole) {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/identity/roles/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    if (!res.ok) {
      setError('No se pudo asignar ese rol. Intenta de nuevo.');
    } else {
      await refresh();
    }
    setBusy(false);
  }

  async function switchWorkspace(workspace: Workspace) {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/identity/workspace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace }),
    });
    if (!res.ok) {
      setError('Ese espacio de trabajo no está disponible para tu cuenta.');
    } else {
      await refresh();
    }
    setBusy(false);
  }

  async function sendParentInvite() {
    if (!inviteEmail.trim()) return;
    setBusy(true);
    setError(null);
    const res = await fetch('/api/student/parent-invitations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: inviteEmail.trim() }),
    });
    if (res.ok) {
      setInviteEmail('');
      const b = await fetch('/api/student/parent-invitations').then((r) => r.json());
      setSentInvitations(b.data?.invitations ?? []);
    } else {
      setError('No se pudo enviar la invitación. Verifica el correo.');
    }
    setBusy(false);
  }

  async function respondInvitation(id: string, decision: 'accept' | 'decline') {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/parent/invitations/${id}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision }),
    });
    if (res.ok) {
      const b = await fetch('/api/parent/invitations').then((r) => r.json());
      setParentInvitations(b.data?.invitations ?? []);
    } else {
      setError('No se pudo procesar la invitación.');
    }
    setBusy(false);
  }

  async function loadInstitutions() {
    const b = await fetch('/api/institutions').then((r) => r.json());
    setInstitutions(b.data?.institutions ?? []);
  }

  async function requestMembership() {
    if (!selectedInstitutionId) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/institutions/${selectedInstitutionId}/membership`, { method: 'POST' });
    if (res.ok) {
      const b = await fetch('/api/teacher/my-memberships').then((r) => r.json());
      setTeacherMemberships(b.data?.memberships ?? []);
    } else {
      setError('No se pudo enviar la solicitud a esa institución.');
    }
    setBusy(false);
  }

  if (!state) return <div style={{ padding: 'var(--space-8)' }}>Cargando…</div>;

  const rolesNotYetHeld = SELF_SERVICE_ROLES.filter((r) => !state.roles.includes(r));

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: 'var(--space-8) var(--space-4)' }}>
      <h1 style={{ fontSize: 20, marginBottom: 'var(--space-4)' }}>Tu cuenta en StudyUS</h1>

      {state.roles.length === 0 ? (
        <>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}>
            ¿Cómo vas a usar StudyUS? Elige una opción para continuar.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {SELF_SERVICE_ROLES.map((role) => (
              <button key={role} disabled={busy} onClick={() => selectRole(role)} className="card" style={{ padding: 'var(--space-3)', cursor: 'pointer', textAlign: 'left' }}>
                {ROLE_LABELS[role]}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 'var(--space-2)' }}>
            Roles activos: {state.roles.map((r) => ROLE_LABELS[r as SelfServiceRole] ?? r).join(', ')}
          </p>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}>
            Espacio activo: {state.activeWorkspace ? WORKSPACE_LABELS[state.activeWorkspace] : '(ninguno seleccionado)'}
          </p>

          {state.availableWorkspaces.length > 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
              {state.availableWorkspaces.map((ws) => (
                <button
                  key={ws}
                  disabled={busy || ws === state.activeWorkspace}
                  onClick={() => switchWorkspace(ws)}
                  className="card"
                  style={{ padding: 'var(--space-3)', cursor: 'pointer' }}
                >
                  Cambiar a {WORKSPACE_LABELS[ws]}
                </button>
              ))}
            </div>
          )}

          {state.availableWorkspaces.includes('STUDENT') && (
            <p style={{ marginBottom: 'var(--space-4)' }}>
              <a href="/dashboard">Ir a tu panel →</a>
            </p>
          )}

          {/* PARENT: pending invitations addressed to my own verified email */}
          {state.roles.includes('PARENT') && (
            <section style={card()}>
              <h2 style={{ fontSize: 16, marginBottom: 'var(--space-2)' }}>Invitaciones de estudiantes</h2>
              {parentInvitations === null ? (
                <p>Cargando…</p>
              ) : parentInvitations.length === 0 ? (
                <p style={{ color: 'var(--text-secondary)' }}>
                  Todavía no tienes ninguna invitación. Un estudiante debe invitarte usando exactamente tu correo
                  para que puedas ver su progreso. No puedes buscar ni vincular a un estudiante por tu cuenta.
                </p>
              ) : (
                parentInvitations.map((inv) => (
                  <div key={inv.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
                    <span>{inv.studentName} te invitó a ver su progreso.</span>
                    <span>
                      <button disabled={busy} onClick={() => respondInvitation(inv.id, 'accept')} style={{ marginRight: 8 }}>Aceptar</button>
                      <button disabled={busy} onClick={() => respondInvitation(inv.id, 'decline')}>Rechazar</button>
                    </span>
                  </div>
                ))
              )}
            </section>
          )}

          {/* STUDENT: invite a parent by email */}
          {state.roles.includes('STUDENT') && (
            <section style={card()}>
              <h2 style={{ fontSize: 16, marginBottom: 'var(--space-2)' }}>Invitar a un padre, madre, tutor o coach</h2>
              <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
                <input
                  type="email"
                  placeholder="correo@ejemplo.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  style={{ flex: 1, padding: 'var(--space-2)' }}
                />
                <button disabled={busy || !inviteEmail.trim()} onClick={sendParentInvite}>Invitar</button>
              </div>
              {sentInvitations && sentInvitations.length > 0 && (
                <ul>
                  {sentInvitations.map((inv) => (
                    <li key={inv.id}>
                      {inv.invitedEmail} —{' '}
                      {inv.status === 'pending' ? 'invitación pendiente' : inv.status === 'accepted' ? 'aceptada' : inv.status === 'declined' ? 'rechazada' : 'revocada'}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* TEACHER: membership status + request */}
          {state.roles.includes('TEACHER') && (
            <section style={card()}>
              <h2 style={{ fontSize: 16, marginBottom: 'var(--space-2)' }}>Autorización institucional</h2>
              {teacherMemberships === null ? (
                <p>Cargando…</p>
              ) : teacherMemberships.length === 0 ? (
                <>
                  <p style={{ color: 'var(--text-secondary)', marginBottom: 'var(--space-2)' }}>
                    Todavía no has solicitado autorización en ninguna institución. Elige tu institución para enviar una solicitud.
                  </p>
                  {institutions === null ? (
                    <button disabled={busy} onClick={loadInstitutions}>Ver instituciones</button>
                  ) : (
                    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                      <select value={selectedInstitutionId} onChange={(e) => setSelectedInstitutionId(e.target.value)} style={{ flex: 1, padding: 'var(--space-2)' }}>
                        <option value="">Selecciona una institución…</option>
                        {institutions.map((inst) => (
                          <option key={inst.id} value={inst.id}>{inst.name}</option>
                        ))}
                      </select>
                      <button disabled={busy || !selectedInstitutionId} onClick={requestMembership}>Solicitar</button>
                    </div>
                  )}
                </>
              ) : (
                teacherMemberships.map((m) => (
                  <p key={m.id} style={{ color: 'var(--text-secondary)' }}>
                    {m.institutionName}:{' '}
                    {m.status === 'PENDING'
                      ? 'tu solicitud está pendiente de revisión por un coordinador. No tendrás acceso a clases ni estudiantes hasta que sea aprobada.'
                      : m.status === 'APPROVED'
                        ? 'aprobado. Un coordinador debe asignarte clases o grados antes de que puedas ver estudiantes.'
                        : m.status === 'REJECTED'
                          ? 'tu solicitud fue rechazada por la institución.'
                          : 'tu acceso a esta institución fue revocado.'}
                  </p>
                ))
              )}
            </section>
          )}

          {rolesNotYetHeld.length > 0 && (
            <section style={card()}>
              <h2 style={{ fontSize: 16, marginBottom: 'var(--space-2)' }}>Añadir otro rol</h2>
              <p style={{ color: 'var(--text-secondary)', marginBottom: 'var(--space-2)' }}>
                Una misma cuenta puede tener más de un rol. Solo puedes añadir roles de autoservicio (Estudiante, Padre/Madre, Profesor).
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {rolesNotYetHeld.map((role) => (
                  <button key={role} disabled={busy} onClick={() => selectRole(role)} className="card" style={{ padding: 'var(--space-3)', cursor: 'pointer', textAlign: 'left' }}>
                    Añadir rol: {ROLE_LABELS[role]}
                  </button>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {error && <p style={{ color: 'var(--danger, red)', marginTop: 'var(--space-3)' }}>{error}</p>}
    </div>
  );
}
