'use client';

import { useState, useEffect } from 'react';
import { Modal } from '../Modal';

type Mode = 'password' | 'invite';
type Role = '' | 'STUDENT' | 'PARENT' | 'TEACHER' | 'INSTITUTION_ADMIN';

const LOCALE_LABELS: Record<string, string> = { es: 'Español', en: 'English', de: 'Deutsch', fr: 'Français', pt: 'Português' };

export default function CreateUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [mode, setMode] = useState<Mode>('invite');
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [locale, setLocale] = useState('es');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isTest, setIsTest] = useState(false);
  const [role, setRole] = useState<Role>('');
  const [institutions, setInstitutions] = useState<Array<{ id: string; name: string }>>([]);
  const [institutionId, setInstitutionId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ invitationId?: string } | null>(null);
  const [partialClerkId, setPartialClerkId] = useState<string | null>(null);

  const passwordRequirementsMet = password.length >= 8;
  const passwordsMatch = password.length > 0 && password === confirmPassword;

  useEffect(() => {
    if (role === 'INSTITUTION_ADMIN' && institutions.length === 0) {
      fetch('/api/institutions').then((r) => r.json()).then((b) => setInstitutions(b.data.institutions)).catch(() => {});
    }
  }, [role, institutions.length]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/users/create-full', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          firstName: firstName || undefined,
          lastName: lastName || undefined,
          locale,
          isTest,
          initialRole: role || null,
          institutionId: role === 'INSTITUTION_ADMIN' ? institutionId : undefined,
          ...(mode === 'invite' ? { sendInvitation: true } : { temporaryPassword: password }),
        }),
      });
      if (res.ok) {
        const body = await res.json();
        setResult(body.data);
        setTimeout(onCreated, 800);
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (body.error === 'EMAIL_ALREADY_EXISTS') setError('Ya existe una cuenta o invitación con ese correo.');
      else if (body.error === 'INSTITUTION_REQUIRED_FOR_COORDINATOR') setError('Selecciona la institución del coordinador.');
      else if (body.error === 'COORDINATOR_REQUIRES_DIRECT_CREATION') setError('Un coordinador solo puede crearse con contraseña temporal, no por invitación.');
      else if (body.error === 'PARTIAL_CREATION') {
        setPartialClerkId(body.clerkUserId);
        setError('La cuenta se creó en Clerk pero no se completó en StudyUS. Puedes reintentar la reconciliación abajo.');
      } else setError('No se pudo crear la cuenta.');
    } finally {
      setBusy(false);
    }
  }

  async function retryReconciliation() {
    if (!partialClerkId) return;
    setBusy(true);
    const res = await fetch('/api/admin/users/reconcile-creation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clerkUserId: partialClerkId, email, initialRole: role || null, isTest, institutionId: role === 'INSTITUTION_ADMIN' ? institutionId : undefined }),
    });
    setBusy(false);
    if (res.ok) {
      setError(null);
      setPartialClerkId(null);
      onCreated();
    }
  }

  if (result) {
    return (
      <Modal title="Usuario creado" onClose={onClose}>
        <p style={{ fontSize: 14 }}>
          {result.invitationId ? 'La invitación fue enviada correctamente.' : 'La cuenta se creó correctamente.'}
        </p>
      </Modal>
    );
  }

  return (
    <Modal title="Crear usuario" onClose={onClose}>
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
          <button className={`btn ${mode === 'invite' ? '' : 'btn-ghost'}`} onClick={() => setMode('invite')}>Enviar invitación</button>
          <button className={`btn ${mode === 'password' ? '' : 'btn-ghost'}`} onClick={() => setMode('password')}>Establecer contraseña temporal</button>
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
          {mode === 'invite'
            ? 'Recomendado: la persona recibe un correo de Clerk y completa su propio registro.'
            : 'Tú defines una contraseña inicial. Clerk no ofrece una bandera nativa de "cambio obligatorio en el primer acceso" — en su lugar, StudyUS exige el cambio en su propia pantalla antes de permitir el uso del producto: la persona podrá iniciar sesión con esta contraseña temporal, pero no verá nada más hasta establecer una propia.'}
        </p>
      </div>

      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Correo electrónico</label>
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: '100%', padding: 'var(--space-2)', marginBottom: 'var(--space-3)' }} />

      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Nombre (opcional)</label>
          <input value={firstName} onChange={(e) => setFirstName(e.target.value)} style={{ width: '100%', padding: 'var(--space-2)', marginBottom: 'var(--space-3)' }} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Apellido (opcional)</label>
          <input value={lastName} onChange={(e) => setLastName(e.target.value)} style={{ width: '100%', padding: 'var(--space-2)', marginBottom: 'var(--space-3)' }} />
        </div>
      </div>

      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Idioma</label>
      <select value={locale} onChange={(e) => setLocale(e.target.value)} style={{ width: '100%', padding: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
        {Object.entries(LOCALE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>

      {mode === 'password' && (
        <>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Contraseña temporal</label>
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 4 }}>
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ flex: 1, padding: 'var(--space-2)' }}
            />
            <button type="button" className="btn btn-ghost" onClick={() => setShowPassword((s) => !s)}>{showPassword ? 'Ocultar' : 'Mostrar'}</button>
          </div>
          <p style={{ fontSize: 12, color: passwordRequirementsMet ? 'var(--success, #15803d)' : 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>
            Mínimo 8 caracteres. Clerk aplica además su propia política real configurada para esta aplicación.
          </p>

          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Confirmar contraseña temporal</label>
          <input
            type={showPassword ? 'text' : 'password'}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            style={{ width: '100%', padding: 'var(--space-2)', marginBottom: 4 }}
          />
          {confirmPassword.length > 0 && !passwordsMatch && (
            <p style={{ fontSize: 12, color: 'var(--danger, red)', marginBottom: 'var(--space-2)' }}>Las contraseñas no coinciden.</p>
          )}
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 'var(--space-3)' }}>
            La persona deberá cambiarla obligatoriamente al iniciar sesión. StudyUS nunca guarda esta contraseña más allá de este envío.
          </p>
        </>
      )}

      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Rol inicial</label>
      <select value={role} onChange={(e) => setRole(e.target.value as Role)} style={{ width: '100%', padding: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
        <option value="">Sin rol (decide en /role-select)</option>
        <option value="STUDENT">Estudiante</option>
        <option value="PARENT">Padre/Madre/Tutor</option>
        <option value="TEACHER">Profesor</option>
        <option value="INSTITUTION_ADMIN">Coordinador institucional</option>
      </select>

      {role === 'INSTITUTION_ADMIN' && (
        <>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Institución (obligatoria)</label>
          <select value={institutionId} onChange={(e) => setInstitutionId(e.target.value)} style={{ width: '100%', padding: 'var(--space-2)', marginBottom: 4 }}>
            <option value="">Selecciona una institución…</option>
            {institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 'var(--space-3)' }}>
            Un coordinador solo puede crearse con contraseña temporal (no por invitación). La membresía institucional queda registrada y auditada, igual que cualquier otro alta de coordinador.
          </p>
        </>
      )}

      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 'var(--space-3)' }}>
        No es posible crear cuentas Admin StudyUS desde este formulario bajo ninguna circunstancia.
      </p>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 'var(--space-4)' }}>
        <input type="checkbox" checked={isTest} onChange={(e) => setIsTest(e.target.checked)} />
        Marcar como cuenta de prueba
      </label>

      {error && (
        <div role="alert" style={{ fontSize: 13, color: 'var(--danger, #b91c1c)', marginBottom: 'var(--space-3)' }}>
          {error}
          {partialClerkId && (
            <div style={{ marginTop: 'var(--space-2)' }}>
              <button className="btn" disabled={busy} onClick={retryReconciliation}>Reintentar reconciliación</button>
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button
          className="btn"
          disabled={
            busy ||
            !email ||
            (mode === 'password' && (!passwordRequirementsMet || !passwordsMatch)) ||
            (mode === 'invite' && role === 'INSTITUTION_ADMIN') ||
            (role === 'INSTITUTION_ADMIN' && !institutionId)
          }
          onClick={submit}
        >
          {mode === 'invite' ? 'Enviar invitación' : 'Crear cuenta'}
        </button>
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
      </div>
    </Modal>
  );
}
