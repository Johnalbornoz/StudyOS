'use client';

import { useState } from 'react';
import { Modal } from '../Modal';
import { BeneficiaryPicker, type BeneficiarySelection } from './BeneficiaryPicker';

/**
 * Solo para pagos que un humano concilia manualmente (transferencia,
 * depósito, comprobante, convenio) -- nunca para pagos procesados por
 * un proveedor real, cuyo propio webhook sigue siendo la única fuente
 * de verdad. Esta acción nunca convierte al pagador en estudiante ni
 * crea relaciones familiares; el acceso siempre va al beneficiario
 * seleccionado explícitamente.
 */
export function ApprovePaymentModal({ onClose, onDone, adminActorId }: { onClose: () => void; onDone: () => void; adminActorId: string }) {
  const [beneficiary, setBeneficiary] = useState<BeneficiarySelection | null>(null);
  const [plan, setPlan] = useState<'MONTHLY' | 'ANNUAL'>('MONTHLY');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [occurredAt, setOccurredAt] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [reference, setReference] = useState('');
  const [method, setMethod] = useState('');
  const [evidenceReference, setEvidenceReference] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selfApprovalConfirmed, setSelfApprovalConfirmed] = useState(false);

  const isSelf = beneficiary?.ownerUserId === adminActorId;
  const amountCents = Math.round(Number(amount) * 100);
  const canSubmit = beneficiary && amountCents > 0 && currency.length === 3 && occurredAt && validUntil && reference.trim() && method.trim() && (!isSelf || selfApprovalConfirmed);

  async function submit() {
    if (!beneficiary) return;
    setBusy(true);
    setError(null);
    const res = await fetch('/api/admin/memberships/approve-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId: beneficiary.studentId,
        plan,
        amountCents,
        currency,
        occurredAt: new Date(occurredAt).toISOString(),
        reference: reference.trim(),
        method: method.trim(),
        evidenceReference: evidenceReference.trim() || undefined,
        notes: notes.trim() || undefined,
        validUntil: new Date(validUntil).toISOString(),
      }),
    });
    setBusy(false);
    if (res.ok) {
      onDone();
    } else {
      const body = await res.json().catch(() => ({}));
      if (body.error === 'DUPLICATE_REFERENCE') setError('Ya existe un pago registrado con esa referencia. No se puede duplicar.');
      else if (body.error === 'INVALID_TRANSITION') setError(`No es posible activar la licencia desde el estado actual (${body.from} → ${body.to}).`);
      else setError('No se pudo aprobar el pago. Verifica los datos.');
    }
  }

  return (
    <Modal title="Aprobar pago manual" onClose={onClose}>
      <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 'var(--space-3)' }}>
        Usa esto únicamente cuando exista una fuente verificable (transferencia, depósito, comprobante o convenio). Para pagos procesados por el proveedor, su propio webhook es la única fuente de verdad.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <BeneficiaryPicker value={beneficiary} onChange={(v) => { setBeneficiary(v); setSelfApprovalConfirmed(false); }} />

        {isSelf && (
          <label role="alert" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, padding: 'var(--space-2)', background: 'var(--warning-bg, #fff7ed)', border: '1px solid var(--warning-border, #fdba74)', borderRadius: 6 }}>
            <input type="checkbox" checked={selfApprovalConfirmed} onChange={(e) => setSelfApprovalConfirmed(e.target.checked)} style={{ marginTop: 2 }} />
            <span>Estás aprobando un pago para tu propia cuenta. Esta operación quedará registrada en la auditoría administrativa.</span>
          </label>
        )}

        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginBottom: 4 }}>Plan</label>
            <select value={plan} onChange={(e) => setPlan(e.target.value as 'MONTHLY' | 'ANNUAL')} style={{ width: '100%', padding: 'var(--space-2)' }}>
              <option value="MONTHLY">Mensual</option>
              <option value="ANNUAL">Anual</option>
            </select>
          </div>
          <div style={{ width: 120 }}>
            <label style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginBottom: 4 }}>Importe</label>
            <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: '100%', padding: 'var(--space-2)' }} />
          </div>
          <div style={{ width: 90 }}>
            <label style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginBottom: 4 }}>Moneda</label>
            <input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} style={{ width: '100%', padding: 'var(--space-2)' }} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginBottom: 4 }}>Fecha del pago</label>
            <input type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} style={{ width: '100%', padding: 'var(--space-2)' }} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginBottom: 4 }}>Vigencia hasta</label>
            <input type="datetime-local" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} style={{ width: '100%', padding: 'var(--space-2)' }} />
          </div>
        </div>

        <div>
          <label style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginBottom: 4 }}>Referencia (única)</label>
          <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="N.º de comprobante o transferencia" style={{ width: '100%', padding: 'var(--space-2)' }} />
        </div>

        <div>
          <label style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginBottom: 4 }}>Método</label>
          <input value={method} onChange={(e) => setMethod(e.target.value)} placeholder="Transferencia, depósito, convenio…" style={{ width: '100%', padding: 'var(--space-2)' }} />
        </div>

        <div>
          <label style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginBottom: 4 }}>Evidencia (opcional)</label>
          <input value={evidenceReference} onChange={(e) => setEvidenceReference(e.target.value)} placeholder="Enlace o identificador del comprobante" style={{ width: '100%', padding: 'var(--space-2)' }} />
        </div>

        <div>
          <label style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginBottom: 4 }}>Notas (opcional)</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} style={{ width: '100%', padding: 'var(--space-2)' }} />
        </div>
      </div>

      {error && <p role="alert" style={{ fontSize: 12.5, color: 'var(--danger, red)', marginTop: 'var(--space-3)' }}>{error}</p>}

      <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
        <button className="btn" disabled={!canSubmit || busy} onClick={submit}>{busy ? 'Aprobando…' : 'Aprobar pago'}</button>
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
      </div>
    </Modal>
  );
}
