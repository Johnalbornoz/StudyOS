'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface FactoryControlState {
  factoryEnabled: boolean;
  onDemandEnabled: boolean;
  scheduledEnabled: boolean;
  demoMode: boolean;
  killSwitch: boolean;
  isProduction: boolean;
  source: 'PLATFORM_ADMIN' | 'ENVIRONMENT_DEFAULT';
  updatedAt: string | null;
}

type Key = 'factoryEnabled' | 'onDemandEnabled' | 'scheduledEnabled' | 'demoMode';

const ROWS: Array<{ key: Key; label: string; hint: string; on: string; off: string }> = [
  { key: 'factoryEnabled', label: 'Fábrica de preguntas', hint: 'Interruptor general. Apagada, no se generan preguntas nuevas.', on: 'ACTIVA', off: 'DESACTIVADA' },
  { key: 'onDemandEnabled', label: 'Generación bajo demanda', hint: 'Un administrador pide preguntas para una celda concreta.', on: 'ACTIVA', off: 'DESACTIVADA' },
  { key: 'scheduledEnabled', label: 'Generación programada', hint: 'Ejecuciones automáticas sin intervención. Independiente de la anterior.', on: 'ACTIVA', off: 'DESACTIVADA' },
  { key: 'demoMode', label: 'Modo Demo', hint: 'Los límites administrativos pasan a ser avisos. Las protecciones técnicas y la revisión se mantienen.', on: 'ACTIVO', off: 'DESACTIVADO' },
];

/** Runtime Factory controls: each switch applies at once (no redeploy) and is audited. */
export function FactoryControlPanel({ initial }: { initial: FactoryControlState }) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState<Key | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function toggle(key: Key) {
    const value = !state[key];
    setBusy(key);
    setMsg(null);
    const r = await fetch('/api/admin/question-bank/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [key]: value }) }).catch(() => null);
    const body = r ? await r.json().catch(() => ({})) : {};
    setBusy(null);
    if (!r?.ok) {
      setMsg(body?.error === 'DEMO_MODE_NOT_ALLOWED_IN_PRODUCTION' ? 'El Modo Demo no se puede activar en producción.' : 'No se pudo guardar el cambio.');
      return;
    }
    const s = body.data.settings;
    setState((prev) => ({ ...prev, factoryEnabled: s.factoryEnabled, onDemandEnabled: s.onDemandEnabled, scheduledEnabled: s.scheduledEnabled, demoMode: s.demoMode, source: body.data.source, updatedAt: body.data.updatedAt }));
    setMsg('Cambio guardado. Se aplica de inmediato.');
    router.refresh();
  }

  return (
    <section className="card" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-4)' }} aria-labelledby="factory-controls-title" data-testid="factory-controls">
      <h2 id="factory-controls-title" style={{ fontSize: 15, marginBottom: 'var(--space-3)' }}>Configuración de la fábrica</h2>
      {state.killSwitch && (
        <p role="alert" style={{ color: 'var(--danger, #b91c1c)', fontSize: 13, marginBottom: 'var(--space-3)' }}>
          La parada de emergencia del entorno está activa: la fábrica no generará preguntas aunque esté activada aquí.
        </p>
      )}
      <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
        {ROWS.map((row) => {
          const on = state[row.key];
          const blocked = row.key === 'demoMode' && state.isProduction;
          return (
            <div key={row.key} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap', justifyContent: 'space-between' }} data-setting={row.key} data-state={on ? 'ON' : 'OFF'}>
              <div style={{ minWidth: 220, flex: '1 1 260px' }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{row.label}</div>
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{blocked ? 'No disponible en producción.' : row.hint}</div>
              </div>
              <span className={`chip ${on ? 'chip-good' : ''}`} style={{ minWidth: 110, textAlign: 'center' }}>{on ? row.on : row.off}</span>
              <button className="btn btn-ghost" disabled={busy !== null || blocked} onClick={() => toggle(row.key)} aria-pressed={on} style={{ minWidth: 110 }}>
                {busy === row.key ? 'Guardando…' : on ? 'Desactivar' : 'Activar'}
              </button>
            </div>
          );
        })}
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 'var(--space-3)' }}>
        {state.source === 'PLATFORM_ADMIN' && state.updatedAt ? `Última modificación: ${new Date(state.updatedAt).toLocaleString('es')}.` : 'Valores iniciales del entorno (aún sin cambios desde aquí).'} Cada cambio queda en la auditoría de administración.
      </p>
      {msg && <p role="status" style={{ fontSize: 13, marginTop: 'var(--space-2)' }}>{msg}</p>}
    </section>
  );
}

/** Marks one consumption alert as seen (persisted). */
export function AcknowledgeAlertButton({ alertId }: { alertId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn btn-ghost"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch('/api/admin/question-bank/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acknowledgeAlertId: alertId }) }).catch(() => null);
        setBusy(false);
        router.refresh();
      }}
    >
      {busy ? '…' : 'Marcar como visto'}
    </button>
  );
}
