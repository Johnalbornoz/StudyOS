'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '../../Modal';
import type { MembershipDetail } from '@/services/membership-admin.service';

const STATUS_LABELS: Record<string, string> = {
  unpaid: 'Pago pendiente',
  payment_under_review: 'Pago en revisión',
  active: 'Activa',
  past_due: 'Pago vencido',
  suspended: 'Suspendida',
  reactivated: 'Reactivada',
  canceled: 'Cancelada',
  cancelled_at_period_end: 'Cancelada (fin de periodo)',
  expired: 'Vencida',
  refunded: 'Reembolsada',
  disputed: 'En disputa',
};

const STATUS_CHIP: Record<string, string> = {
  active: 'chip-good',
  reactivated: 'chip-good',
  unpaid: 'chip-warn',
  payment_under_review: 'chip-warn',
  past_due: 'chip-warn',
  suspended: 'chip-critical',
  disputed: 'chip-critical',
  refunded: 'chip-critical',
  canceled: 'chip-warn',
  cancelled_at_period_end: 'chip-warn',
  expired: 'chip-warn',
};

const EVENT_LABELS: Record<string, string> = {
  CREATED: 'Creada',
  PAYMENT_INITIATED: 'Pago iniciado',
  PAYMENT_CONFIRMED: 'Pago confirmado',
  LICENSE_ACTIVATED: 'Licencia activada',
  RENEWED: 'Renovada',
  SUSPENDED: 'Suspendida',
  REACTIVATED: 'Reactivada',
  CANCELLED: 'Cancelada',
  EXPIRED: 'Vencida',
  REFUNDED: 'Reembolsada',
  DISPUTED: 'En disputa',
  RECONCILED: 'Reconciliada',
};

type ActionKind = 'suspend' | 'reactivate' | 'cancel' | 'revoke-grant' | 'refund' | 'dispute';

const ACTION_META: Record<ActionKind, { title: string; endpoint: string; body: (reason: string) => unknown; disclosure?: string }> = {
  suspend: {
    title: 'Suspender membresía',
    endpoint: 'suspend',
    body: (reason) => ({ reason }),
    disclosure: 'Suspender membresía elimina el acceso premium, pero el usuario todavía puede entrar y utilizar las funciones gratuitas permitidas. Esto no bloquea la cuenta ni afecta relaciones familiares, roles ni pagos ya registrados.',
  },
  reactivate: {
    title: 'Reactivar membresía',
    endpoint: 'reactivate',
    body: (reason) => ({ reason }),
    disclosure: 'Reactivar restablece únicamente el acceso premium correspondiente. No añade roles, perfiles ni relaciones. Úsalo solo con una causa válida: pago confirmado, disputa resuelta, renovación o corrección administrativa.',
  },
  cancel: {
    title: 'Cancelar membresía',
    endpoint: 'cancel',
    body: (reason) => ({ reason }),
    disclosure: 'Cancelar evita renovaciones futuras. El acceso se conserva hasta el fin del periodo vigente, según la política aplicable.',
  },
  'revoke-grant': {
    title: 'Revocar concesión',
    endpoint: 'revoke-grant',
    body: (reason) => ({ reason }),
    disclosure: 'Revoca el acceso otorgado administrativamente (beca, promoción o cortesía) antes de su vencimiento.',
  },
  refund: {
    title: 'Registrar reembolso',
    endpoint: 'refund-dispute',
    body: (reason) => ({ type: 'REFUND', notes: reason }),
    disclosure: 'Esto solo registra y concilia el reembolso en StudyUS. Acción requerida en el proveedor de pagos: el reembolso real debe emitirse allí.',
  },
  dispute: {
    title: 'Registrar disputa',
    endpoint: 'refund-dispute',
    body: (reason) => ({ type: 'DISPUTE', notes: reason }),
    disclosure: 'Esto solo registra la disputa en StudyUS para su seguimiento. Acción requerida en el proveedor de pagos.',
  },
};

export default function MembershipDetailConsole({ initialDetail }: { initialDetail: MembershipDetail }) {
  const router = useRouter();
  const [detail, setDetail] = useState(initialDetail);
  const [activeAction, setActiveAction] = useState<ActionKind | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selfApprovalConfirmed, setSelfApprovalConfirmed] = useState(false);

  async function refresh() {
    const res = await fetch(`/api/admin/memberships/${detail.subscriptionId}`);
    if (res.ok) {
      const body = await res.json();
      setDetail(body.data);
    }
    router.refresh();
  }

  async function runAction() {
    if (!activeAction || !reason.trim()) return;
    const meta = ACTION_META[activeAction];
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/admin/memberships/${detail.subscriptionId}/${meta.endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(meta.body(reason.trim())),
    });
    setBusy(false);
    if (res.ok) {
      const body = await res.json().catch(() => ({}));
      setActiveAction(null);
      setReason('');
      if (body?.data?.providerActionRequired) {
        setNotice('Registrado en StudyUS. Acción requerida en el proveedor de pagos para completar el reembolso o resolver la disputa.');
      } else {
        setNotice(`${meta.title}: hecho.`);
      }
      refresh();
    } else {
      const body = await res.json().catch(() => ({}));
      if (body.error === 'INVALID_TRANSITION') setError(`No es posible aplicar esta acción desde el estado actual (${body.from} → ${body.to}).`);
      else setError('No se pudo completar la acción.');
    }
  }

  async function reconcile() {
    setBusy(true);
    await fetch(`/api/admin/memberships/${detail.subscriptionId}/reconcile`, { method: 'POST' });
    setBusy(false);
    setNotice('Revisión de reconciliación registrada en la auditoría. No se aplicó ninguna reparación automática.');
    refresh();
  }

  return (
    <div>
      {notice && <p role="status" className="card" style={{ padding: 'var(--space-3)', marginBottom: 'var(--space-4)', background: 'var(--success-bg, #f0fdf4)' }}>{notice}</p>}

      {detail.isSelfApproval && (
        <div role="alert" className="card" style={{ padding: 'var(--space-3) var(--space-4)', marginBottom: 'var(--space-4)', background: 'var(--warning-bg, #fff7ed)', border: '1px solid var(--warning-border, #fdba74)' }}>
          <strong style={{ fontSize: 13.5 }}>Esta es tu propia membresía</strong>
          <p style={{ fontSize: 12.5, margin: '4px 0 0' }}>Actor y beneficiario son la misma persona. Puedes administrarla, pero cada acción quedará marcada en la auditoría como autoaprobación.</p>
        </div>
      )}

      <div className="card" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
        <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
          <span className={`chip ${STATUS_CHIP[detail.status] ?? ''}`} style={{ fontSize: 13 }}>{STATUS_LABELS[detail.status] ?? detail.statusLabel}</span>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Plan: {detail.plan ?? '—'}</span>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Fuente: {detail.source ?? '—'}</span>
          {detail.manuallySetByAdmin && <span className="chip chip-warn">Concesión administrativa</span>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-3)', fontSize: 13 }}>
          <div><strong>Próximo vencimiento</strong><div style={{ color: 'var(--text-muted)' }}>{detail.currentPeriodEnd ? new Date(detail.currentPeriodEnd).toLocaleString('es') : '—'}</div></div>
          <div><strong>Vencimiento de concesión</strong><div style={{ color: 'var(--text-muted)' }}>{detail.grantExpiresAt ? new Date(detail.grantExpiresAt).toLocaleString('es') : '—'}</div></div>
          <div><strong>Motivo de concesión</strong><div style={{ color: 'var(--text-muted)' }}>{detail.grantReason ?? '—'}</div></div>
          <div><strong>Creada</strong><div style={{ color: 'var(--text-muted)' }}>{new Date(detail.createdAt).toLocaleString('es')}</div></div>
        </div>
      </div>

      <div className="card" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
        <h2 style={{ fontSize: 15, marginBottom: 'var(--space-3)' }}>Acciones</h2>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <button className="btn btn-ghost" disabled={detail.status === 'suspended'} onClick={() => { setActiveAction('suspend'); setReason(''); setError(null); setSelfApprovalConfirmed(false); }}>Suspender membresía</button>
          <button className="btn btn-ghost" disabled={detail.status !== 'suspended'} onClick={() => { setActiveAction('reactivate'); setReason(''); setError(null); setSelfApprovalConfirmed(false); }}>Reactivar</button>
          <button className="btn btn-ghost" onClick={() => { setActiveAction('cancel'); setReason(''); setError(null); setSelfApprovalConfirmed(false); }}>Cancelar</button>
          {detail.manuallySetByAdmin && (
            <button className="btn btn-ghost" onClick={() => { setActiveAction('revoke-grant'); setReason(''); setError(null); setSelfApprovalConfirmed(false); }}>Revocar concesión</button>
          )}
          <button className="btn btn-ghost" onClick={() => { setActiveAction('refund'); setReason(''); setError(null); setSelfApprovalConfirmed(false); }}>Registrar reembolso</button>
          <button className="btn btn-ghost" onClick={() => { setActiveAction('dispute'); setReason(''); setError(null); setSelfApprovalConfirmed(false); }}>Registrar disputa</button>
          <button className="btn btn-ghost" disabled={busy} onClick={reconcile}>Marcar revisado (reconciliar)</button>
        </div>
      </div>

      <div className="card" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
        <h2 style={{ fontSize: 15, marginBottom: 'var(--space-3)' }}>Pagos</h2>
        {detail.payments.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Sin pagos registrados.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-default)' }}>
                {['Fecha', 'Importe', 'Proveedor', 'Estado', 'Método de aprobación'].map((h) => (
                  <th key={h} scope="col" style={{ textAlign: 'left', padding: 'var(--space-2)', color: 'var(--text-muted)', fontSize: 11.5, textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {detail.payments.map((p) => (
                <tr key={p.id} style={{ borderBottom: '1px solid var(--border-default)' }}>
                  <td style={{ padding: 'var(--space-2)' }}>{new Date(p.occurredAt).toLocaleString('es')}</td>
                  <td style={{ padding: 'var(--space-2)' }}>{(p.amountCents / 100).toFixed(2)} {p.currency}</td>
                  <td style={{ padding: 'var(--space-2)' }}>{p.provider}</td>
                  <td style={{ padding: 'var(--space-2)' }}>{p.status}</td>
                  <td style={{ padding: 'var(--space-2)', color: 'var(--text-muted)' }}>{p.approvalMethod ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ padding: 'var(--space-4)' }}>
        <h2 style={{ fontSize: 15, marginBottom: 'var(--space-3)' }}>Historial financiero</h2>
        {detail.timeline.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Sin eventos todavía.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {detail.timeline.map((t, idx) => (
              <li key={idx} style={{ fontSize: 13, borderLeft: '2px solid var(--border-default)', paddingLeft: 'var(--space-3)' }}>
                <strong>{EVENT_LABELS[t.eventType] ?? t.eventType}</strong>
                <span style={{ color: 'var(--text-muted)' }}> · {new Date(t.occurredAt).toLocaleString('es')}</span>
                {t.previousStatus && t.newStatus && (
                  <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{STATUS_LABELS[t.previousStatus] ?? t.previousStatus} → {STATUS_LABELS[t.newStatus] ?? t.newStatus}</div>
                )}
                {t.reason && <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Motivo: {t.reason}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {activeAction && (
        <Modal title={ACTION_META[activeAction].title} onClose={() => setActiveAction(null)}>
          {ACTION_META[activeAction].disclosure && (
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 'var(--space-3)' }}>{ACTION_META[activeAction].disclosure}</p>
          )}
          <label style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginBottom: 4 }}>Motivo (obligatorio)</label>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} style={{ width: '100%', padding: 'var(--space-2)' }} />
          {detail.isSelfApproval && (
            <label role="alert" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, marginTop: 'var(--space-3)', padding: 'var(--space-2)', background: 'var(--warning-bg, #fff7ed)', border: '1px solid var(--warning-border, #fdba74)', borderRadius: 6 }}>
              <input type="checkbox" checked={selfApprovalConfirmed} onChange={(e) => setSelfApprovalConfirmed(e.target.checked)} style={{ marginTop: 2 }} />
              <span>Estás aprobando una membresía o pago para tu propia cuenta. Esta operación quedará registrada en la auditoría administrativa.</span>
            </label>
          )}
          {error && <p role="alert" style={{ fontSize: 12.5, color: 'var(--danger, red)', marginTop: 'var(--space-2)' }}>{error}</p>}
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
            <button className="btn" disabled={!reason.trim() || busy || (detail.isSelfApproval && !selfApprovalConfirmed)} onClick={runAction}>{busy ? 'Aplicando…' : 'Confirmar'}</button>
            <button className="btn btn-ghost" onClick={() => setActiveAction(null)}>Cancelar</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
