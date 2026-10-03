'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Recompute one version's health snapshot (DB only, no AI). */
export function RefreshHealthButton({ examVersionId }: { examVersionId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
      <button
        className="btn btn-ghost"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await fetch(`/api/admin/question-bank/health/${examVersionId}`, { method: 'POST' }).catch(() => null);
          setBusy(false);
          if (!r?.ok) setError('No se pudo recalcular.');
          router.refresh();
        }}
      >
        {busy ? 'Recalculando…' : 'Recalcular salud'}
      </button>
      {error && <span style={{ color: 'var(--danger, #b91c1c)', fontSize: 13 }}>{error}</span>}
    </span>
  );
}

const ERRORS: Record<string, string> = {
  FACTORY_DISABLED: 'La fábrica está desactivada en este entorno.',
  BUDGET_EXHAUSTED: 'Presupuesto de IA agotado o reserva compartida alcanzada.',
  BATCH_TOO_LARGE: 'Lote demasiado grande.',
  GENERATION_NOT_SUPPORTED_FOR_FAMILY: 'Esta familia no admite generación automática.',
  CELL_NOT_FOUND: 'Celda no encontrada.',
};

/** "Generar lote pequeño" for one blueprint deficit (bounded by the server). */
export function GenerateSmallBatchButton({ examVersionId, cellKey, maxBatch }: { examVersionId: string; cellKey: string; maxBatch: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
      <button
        className="btn btn-ghost"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          const idem = `ui:${cellKey.replace(/[^A-Za-z0-9._:-]/g, '_').slice(0, 50)}:${Date.now()}`;
          const r = await fetch('/api/admin/question-bank/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ examVersionId, cellKey, count: maxBatch, idempotencyKey: idem }) }).catch(() => null);
          const body = r ? await r.json().catch(() => ({})) : {};
          setBusy(false);
          setMsg(r?.status === 202 ? (body?.data?.created ? 'En cola: se procesa en segundo plano.' : 'Ya había una solicitud abierta para esta celda.') : ERRORS[body?.error] ?? 'No se pudo encolar.');
          router.refresh();
        }}
      >
        {busy ? 'Encolando…' : `Generar lote pequeño (${maxBatch})`}
      </button>
      {msg && <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{msg}</span>}
    </span>
  );
}
