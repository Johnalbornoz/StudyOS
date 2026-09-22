'use client';

import { useState } from 'react';
import { Modal } from '../Modal';
import { BeneficiaryPicker, type BeneficiarySelection } from './BeneficiaryPicker';

const SOURCE_LABELS: Record<string, string> = {
  INSTITUTIONAL_LICENSE: 'Licencia institucional',
  ADMIN_PROMOTION: 'Promoción / cortesía administrativa',
  TRIAL: 'Prueba (trial)',
};

/**
 * Concede acceso sin pago directo (beca, promoción, cortesía,
 * compensación, prueba administrativa). La fecha de vencimiento es
 * obligatoria en este formulario -- nunca se envía la solicitud sin
 * ella, para que jamás exista una licencia administrativa indefinida
 * por defecto (el servidor también la exige, en `grantAdminLicense`).
 */
export function GrantLicenseModal({ onClose, onDone, adminActorId }: { onClose: () => void; onDone: () => void; adminActorId: string }) {
  const [beneficiary, setBeneficiary] = useState<BeneficiarySelection | null>(null);
  const [reason, setReason] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [source, setSource] = useState<'INSTITUTIONAL_LICENSE' | 'ADMIN_PROMOTION' | 'TRIAL'>('ADMIN_PROMOTION');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selfApprovalConfirmed, setSelfApprovalConfirmed] = useState(false);

  const isSelf = beneficiary?.ownerUserId === adminActorId;
  const canSubmit = beneficiary && reason.trim().length > 0 && expiresAt && (!isSelf || selfApprovalConfirmed);

  async function submit() {
    if (!beneficiary || !expiresAt) return;
    setBusy(true);
    setError(null);
    const res = await fetch('/api/admin/memberships/grant-license', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId: beneficiary.studentId,
        reason: reason.trim(),
        expiresAt: new Date(expiresAt).toISOString(),
        source,
      }),
    });
    setBusy(false);
    if (res.ok) {
      onDone();
    } else {
      const body = await res.json().catch(() => ({}));
      if (body.error === 'MISSING_EXPIRATION') setError('La fecha de vencimiento es obligatoria.');
      else if (body.error === 'INVALID_TRANSITION') setError(`No es posible activar la licencia desde el estado actual (${body.from} → ${body.to}).`);
      else setError('No se pudo conceder la licencia.');
    }
  }

  return (
    <Modal title="Conceder licencia sin pago directo" onClose={onClose}>
      <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 'var(--space-3)' }}>
        Para becas, licencias institucionales, promociones o pruebas administrativas. Nunca se concede sin fecha de vencimiento.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <BeneficiaryPicker value={beneficiary} onChange={(v) => { setBeneficiary(v); setSelfApprovalConfirmed(false); }} />

        {isSelf && (
          <label role="alert" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, padding: 'var(--space-2)', background: 'var(--warning-bg, #fff7ed)', border: '1px solid var(--warning-border, #fdba74)', borderRadius: 6 }}>
            <input type="checkbox" checked={selfApprovalConfirmed} onChange={(e) => setSelfApprovalConfirmed(e.target.checked)} style={{ marginTop: 2 }} />
            <span>Estás concediendo una licencia a tu propia cuenta. Esta operación quedará registrada en la auditoría administrativa.</span>
          </label>
        )}

        <div>
          <label style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginBottom: 4 }}>Fuente</label>
          <select value={source} onChange={(e) => setSource(e.target.value as typeof source)} style={{ width: '100%', padding: 'var(--space-2)' }}>
            {Object.entries(SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>

        <div>
          <label style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginBottom: 4 }}>Motivo</label>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} style={{ width: '100%', padding: 'var(--space-2)' }} placeholder="Por qué se concede este acceso" />
        </div>

        <div>
          <label style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginBottom: 4 }}>
            Fecha de vencimiento <span style={{ color: 'var(--danger, red)' }}>(obligatoria)</span>
          </label>
          <input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} required style={{ width: '100%', padding: 'var(--space-2)' }} />
        </div>
      </div>

      {error && <p role="alert" style={{ fontSize: 12.5, color: 'var(--danger, red)', marginTop: 'var(--space-3)' }}>{error}</p>}

      <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
        <button className="btn" disabled={!canSubmit || busy} onClick={submit}>{busy ? 'Concediendo…' : 'Conceder licencia'}</button>
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
      </div>
    </Modal>
  );
}
