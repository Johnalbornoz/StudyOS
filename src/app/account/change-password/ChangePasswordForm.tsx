'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Server-controlled password change (Alternative B -- see
 * F15_ADMIN_USER_MANAGEMENT.md §26). This form no longer calls Clerk
 * directly from the browser: it posts the current and new password to
 * StudyUS's own `/api/account/change-password`, which verifies the
 * current credential and performs the real change against Clerk's
 * Backend API itself, only then clearing the server-side requirement.
 * The earlier design (browser calls Clerk, then separately tells this
 * server "it worked") let any authenticated caller skip the first step
 * and forge the second -- this form cannot do that, because there is
 * no second step: a single request either verifiably changes the
 * password or it does not.
 */
export default function ChangePasswordForm() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;
  const meetsMinimumLength = newPassword.length >= 8;
  const canSubmit = currentPassword.length > 0 && meetsMinimumLength && passwordsMatch && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);

    const res = await fetch('/api/account/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword, confirmNewPassword: confirmPassword }),
    });

    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');

    if (res.ok) {
      router.push('/dashboard');
      router.refresh();
      return;
    }

    setBusy(false);
    const body = await res.json().catch(() => ({}));
    if (body.error === 'CURRENT_PASSWORD_INVALID') setError('La contraseña actual no es correcta.');
    else if (body.error === 'PASSWORD_UPDATE_FAILED') setError(body.message || 'Clerk rechazó la nueva contraseña. Prueba con una diferente.');
    else if (body.error === 'RATE_LIMITED') setError('Demasiados intentos. Espera un minuto e inténtalo de nuevo.');
    else if (body.error === 'ACCOUNT_NOT_ACTIVE') setError('Esta cuenta no está activa. Contacta a soporte.');
    else setError('No se pudo cambiar la contraseña. Inténtalo de nuevo.');
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div>
        <label htmlFor="currentPassword" style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginBottom: 4 }}>
          Contraseña actual (la temporal que recibiste, o tu contraseña si ya la cambiaste por recuperación)
        </label>
        <input
          id="currentPassword"
          type={showPasswords ? 'text' : 'password'}
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          autoComplete="current-password"
          required
          style={{ width: '100%', padding: 'var(--space-2)' }}
        />
      </div>

      <div>
        <label htmlFor="newPassword" style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginBottom: 4 }}>
          Nueva contraseña
        </label>
        <input
          id="newPassword"
          type={showPasswords ? 'text' : 'password'}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
          required
          style={{ width: '100%', padding: 'var(--space-2)' }}
        />
        <p style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>
          Mínimo 8 caracteres. Clerk aplicará además su propia política de contraseñas al procesarla.
        </p>
      </div>

      <div>
        <label htmlFor="confirmPassword" style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginBottom: 4 }}>
          Confirmar nueva contraseña
        </label>
        <input
          id="confirmPassword"
          type={showPasswords ? 'text' : 'password'}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
          required
          style={{ width: '100%', padding: 'var(--space-2)' }}
        />
        {confirmPassword.length > 0 && !passwordsMatch && (
          <p style={{ fontSize: 11.5, color: 'var(--danger, red)', marginTop: 4 }}>Las contraseñas no coinciden.</p>
        )}
      </div>

      <label style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 6 }}>
        <input type="checkbox" checked={showPasswords} onChange={(e) => setShowPasswords(e.target.checked)} />
        Mostrar contraseñas
      </label>

      {error && <p role="alert" style={{ fontSize: 12.5, color: 'var(--danger, red)' }}>{error}</p>}

      <button type="submit" className="btn" disabled={!canSubmit}>
        {busy ? 'Cambiando…' : 'Cambiar contraseña y continuar'}
      </button>

      <p style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
        ¿No recuerdas la contraseña temporal?{' '}
        <a href="/sign-in" style={{ textDecoration: 'underline' }}>Usa la recuperación de cuenta</a> y vuelve aquí para confirmar con tu contraseña ya restablecida.
      </p>
    </form>
  );
}
