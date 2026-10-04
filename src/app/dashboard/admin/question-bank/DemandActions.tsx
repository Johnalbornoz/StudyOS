'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const ERRORS: Record<string, string> = {
  FACTORY_DISABLED: 'La fábrica está desactivada en este entorno.',
  ON_DEMAND_DISABLED: 'La generación a demanda está desactivada.',
  BUDGET_EXHAUSTED: 'Límite técnico de IA alcanzado.',
  BATCH_TOO_LARGE: 'Lote demasiado grande para la configuración actual.',
  GENERATION_NOT_SUPPORTED_FOR_FAMILY: 'Esta familia no admite generación automática.',
};

/** "Generar N preguntas" from the inventory recommendation, with its difficulty mix (bounded server-side). */
export function GenerateDemandButton({ examVersionId, cellKey, mix, maxBatch }: { examVersionId: string; cellKey: string; mix: { LOW: number; MEDIUM: number; HIGH: number }; maxBatch: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // Never more than the server allows in one request: scale the mix down proportionally (largest bands keep their share).
  const total = mix.LOW + mix.MEDIUM + mix.HIGH;
  const scale = total > maxBatch ? maxBatch / total : 1;
  const m = { LOW: Math.floor(mix.LOW * scale), MEDIUM: Math.floor(mix.MEDIUM * scale), HIGH: Math.floor(mix.HIGH * scale) };
  m.MEDIUM += Math.min(maxBatch, total) - (m.LOW + m.MEDIUM + m.HIGH);
  const count = m.LOW + m.MEDIUM + m.HIGH;
  if (count <= 0) return null;
  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <button
        className="btn btn-secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          const idem = `demand:${cellKey.replace(/[^A-Za-z0-9._:-]/g, '_').slice(0, 50)}:${Date.now()}`;
          const r = await fetch('/api/admin/question-bank/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ examVersionId, cellKey, count, difficultyMix: m, idempotencyKey: idem }) }).catch(() => null);
          const body = r ? await r.json().catch(() => ({})) : {};
          setBusy(false);
          setMsg(r?.status === 202 ? (body?.data?.created ? 'En cola: se genera en segundo plano y queda pendiente de revisión.' : 'Ya había una solicitud abierta para esta celda.') : ERRORS[body?.error] ?? 'No se pudo encolar.');
          router.refresh();
        }}
      >
        {busy ? 'Encolando…' : `Generar ${count} preguntas (${m.LOW} baja · ${m.MEDIUM} media · ${m.HIGH} alta)`}
      </button>
      {total > count && <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Recomendación total: {total}; se encolan {count} por solicitud.</span>}
      {msg && <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{msg}</span>}
    </span>
  );
}
