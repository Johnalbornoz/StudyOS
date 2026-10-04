import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { requireStudyUSAdmin } from '@/lib/admin/authorization';
import { operationsView } from '@/lib/exam-core/question-bank/admin.service';
import { consumptionSnapshot, loadFactorySettings, raiseConsumptionAlerts } from '@/lib/exam-core/question-bank/runtime-settings.service';
import { isProductionEnvironment } from '@/lib/exam-core/question-bank/runtime-settings';
import { FactoryControlPanel, AcknowledgeAlertButton } from './FactoryControlPanel';
import { PageHeader } from '@/components/ui/PageHeader';
import { AdminSubNav } from '../../AdminSubNav';
import { StatCard } from '../../StatCard';
import { Table, TD, ROW, LIFECYCLE_LABEL } from '../ui';

const STOP_LABEL: Record<string, string> = {
  DISABLED: 'generación bajo demanda no disponible',
  HARD_LIMIT: 'límite técnico diario de la fábrica alcanzado',
  DAILY_BUDGET: 'presupuesto diario orientativo alcanzado',
  MAX_PER_RUN: 'límite por ejecución',
  AI_RESERVE: 'reserva de IA de la plataforma alcanzada (protección técnica)',
};
const LEVEL: Record<string, { label: string; tone: string }> = {
  NORMAL: { label: 'Normal', tone: 'chip-good' },
  INFO: { label: 'Informativo', tone: '' },
  WARNING: { label: 'Advertencia', tone: 'chip-warn' },
  CRITICAL: { label: 'Crítico', tone: 'chip-critical' },
  HARD_LIMIT: { label: 'Límite técnico alcanzado', tone: 'chip-critical' },
};
const fmt = (n: number) => n.toLocaleString('es');
const pct = (n: number) => `${n < 10 ? n.toFixed(1) : Math.round(n)}%`;

/** Generation operations (read-mostly): budget, queue, runs, candidates. */
export default async function QuestionBankOperationsPage() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');
  const admin = await requireStudyUSAdmin(clerkUserId);
  if (!admin) redirect('/dashboard');
  await raiseConsumptionAlerts();
  const [ops, resolved] = await Promise.all([operationsView(), loadFactorySettings()]);
  const consumption = await consumptionSnapshot(resolved.settings);
  const b = ops.budget;
  const s = resolved.settings;
  const p = consumption.platform;
  const f = consumption.factory;
  const accepted = ops.runs.reduce((n, r) => n + r.accepted, 0);
  const rejected = ops.runs.reduce((n, r) => n + r.rejected, 0);
  const repaired = ops.runs.reduce((n, r) => n + r.repaired, 0);

  return (
    <div>
      <PageHeader title="Operaciones de generación" subtitle="Cola, ejecuciones y presupuesto de IA de la fábrica de preguntas. La generación es siempre en segundo plano y acotada." />
      <AdminSubNav active="question-bank" />
      <p style={{ marginBottom: 'var(--space-4)' }}><Link href="/dashboard/admin/question-bank" className="btn btn-ghost">← Salud del banco</Link></p>

      <FactoryControlPanel
        initial={{ factoryEnabled: s.factoryEnabled, onDemandEnabled: s.onDemandEnabled, scheduledEnabled: s.scheduledEnabled, demoMode: s.demoMode, killSwitch: resolved.killSwitch, isProduction: isProductionEnvironment(), source: resolved.source, updatedAt: resolved.updatedAt }}
      />

      <section className="card" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-4)', fontSize: 13.5 }} aria-labelledby="consumption-title" data-testid="factory-consumption">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          <h2 id="consumption-title" style={{ fontSize: 15 }}>Consumo de IA</h2>
          <span className={`chip ${LEVEL[p.level].tone}`} data-level={p.level}>Estado: {LEVEL[p.level].label}</span>
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, marginTop: 'var(--space-2)' }} data-testid="ai-today">
          {fmt(p.usedToday)} / {fmt(p.limitToday)} <span style={{ fontSize: 14, fontWeight: 500 }}>llamadas hoy · {pct(p.percent)}</span>
        </div>
        <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p.percent)} style={{ height: 8, borderRadius: 4, background: 'var(--surface-muted, #e5e7eb)', margin: 'var(--space-2) 0', overflow: 'hidden' }}>
          <div style={{ width: `${Math.min(100, p.percent)}%`, height: '100%', background: p.level === 'NORMAL' || p.level === 'INFO' ? 'var(--accent, #1F524D)' : 'var(--danger, #b91c1c)' }} />
        </div>
        <div style={{ color: 'var(--text-muted)' }}>
          Capacidad restante hoy: {fmt(p.remainingToday)} llamadas{p.monthCalls !== null ? ` · llamadas registradas este mes: ${fmt(p.monthCalls)}` : ''}. Avisos al {s.warningThresholds.join(' / ')} %: informan, no bloquean. Al 100 % actúa solo la protección técnica.
        </div>
        <div style={{ marginTop: 'var(--space-2)' }}>
          Fábrica hoy: {fmt(f.callsToday)} llamadas · presupuesto orientativo {fmt(f.softBudget)} ({pct(f.softBudgetPercent)}){s.demoMode ? ' — en Modo Demo no bloquea' : ''} · límite técnico diario {fmt(f.hardSafetyLimit)}
          {b.stop ? <strong> — ahora: {STOP_LABEL[b.stop] ?? b.stop}</strong> : null}
        </div>
        <div style={{ color: 'var(--text-muted)' }}>
          Generación bajo demanda: <strong>{s.factoryEnabled && s.onDemandEnabled && !resolved.killSwitch ? 'Activa' : 'Desactivada'}</strong> · Generación programada: <strong>{s.factoryEnabled && s.scheduledEnabled && !resolved.killSwitch ? 'Activa' : 'Desactivada'}</strong> · Preparación dinámica: {b.config.readinessMode === 'ENFORCE' ? 'aplicada' : 'sombra (solo comparación)'}
        </div>
        {consumption.alerts.length > 0 && (
          <ul style={{ marginTop: 'var(--space-3)', display: 'grid', gap: 'var(--space-2)', listStyle: 'none', padding: 0 }} aria-label="Avisos de consumo de hoy">
            {consumption.alerts.map((a) => (
              <li key={a.id} style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }} data-alert-threshold={a.threshold}>
                <span className={`chip ${LEVEL[a.level]?.tone ?? ''}`}>{a.threshold}% · {LEVEL[a.level]?.label ?? a.level}</span>
                <span>{fmt(a.callsUsed)} de {fmt(a.callsLimit)} llamadas · {new Date(a.raisedAt).toLocaleTimeString('es')}</span>
                {a.acknowledgedAt ? <span style={{ color: 'var(--text-muted)' }}>visto</span> : <AcknowledgeAlertButton alertId={a.id} />}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 'var(--space-3)', marginBottom: 'var(--space-6)' }}>
        <StatCard label="Pendientes" value={ops.queue.pending} />
        <StatCard label="En curso" value={ops.queue.running} />
        <StatCard label="Fallidas" value={ops.queue.failed} tone={ops.queue.failed ? 'warn' : 'default'} />
        <StatCard label="Completadas" value={ops.queue.completed} />
        <StatCard label="Aceptadas (piloto)" value={accepted} />
        <StatCard label="Rechazadas" value={rejected} />
        <StatCard label="Reparadas" value={repaired} />
        <StatCard label="Generadas hoy" value={f.itemsGeneratedToday} />
        <StatCard label="Aceptadas hoy" value={f.acceptedToday} />
        <StatCard label="Rechazadas hoy" value={f.rejectedToday} />
        <StatCard label="Reparadas hoy" value={f.repairedToday} />
        <StatCard label="Fallidas hoy" value={f.failedRequestsToday} tone={f.failedRequestsToday ? 'warn' : 'default'} />
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 'calc(-1 * var(--space-4))', marginBottom: 'var(--space-6)' }}>
        Llamadas por pregunta aceptada (hoy): {f.callsPerAccepted !== null ? f.callsPerAccepted.toFixed(1) : '—'} · coste estimado hoy: {f.costTodayUSD.toFixed(4)} USD
      </p>

      <h2 style={{ fontSize: 15, marginBottom: 'var(--space-2)' }}>Solicitudes de generación</h2>
      <Table head={['Examen', 'Celda', 'Prioridad', 'Motivo', 'Estado', 'Intentos', 'Candidatas', 'Aceptadas', 'Rechazadas', 'Reparadas', 'Último error', 'Creada']}>
        {ops.requests.map((r) => (
          <tr key={r.id} style={ROW}>
            <TD>{r.definitionName}</TD>
            <TD muted>{r.cellKey.split('|').slice(0, 2).join(' · ')}</TD>
            <TD>{r.priority}</TD>
            <TD muted>{r.reason}</TD>
            <TD>{r.status}</TD>
            <TD num>{r.attemptCount}/{r.maxAttempts}</TD>
            <TD num>{r.candidatesCreated}</TD>
            <TD num>{r.accepted}</TD>
            <TD num>{r.rejected}</TD>
            <TD num>{r.repaired}</TD>
            <TD muted>{r.lastError ?? '—'}</TD>
            <TD muted>{new Date(r.createdAt).toLocaleString('es')}</TD>
          </tr>
        ))}
      </Table>

      <h2 style={{ fontSize: 15, marginBottom: 'var(--space-2)' }}>Ejecuciones de la fábrica</h2>
      <Table head={['Inicio', 'Origen', 'Estado', 'Llamadas IA', 'Tokens (ent./sal.)', 'Coste est. USD', 'Candidatas', 'Aceptadas', 'Rechazadas', 'Reparadas', 'Revisión', 'Límites del proveedor']}>
        {ops.runs.map((r) => (
          <tr key={r.id} style={ROW}>
            <TD muted>{new Date(r.startedAt).toLocaleString('es')}</TD>
            <TD>{r.trigger}</TD>
            <TD>{r.status}</TD>
            <TD num>{r.aiCalls}</TD>
            <TD num>{r.inputTokens} / {r.outputTokens}</TD>
            <TD num>{r.estimatedCostUSD.toFixed(4)}</TD>
            <TD num>{r.candidates}</TD>
            <TD num>{r.accepted}</TD>
            <TD num>{r.rejected}</TD>
            <TD num>{r.repaired}</TD>
            <TD num>{r.reviewRequired}</TD>
            <TD num>{r.rateLimitEvents}</TD>
          </tr>
        ))}
      </Table>

      <h2 style={{ fontSize: 15, marginBottom: 'var(--space-2)' }}>Candidatas generadas (últimas)</h2>
      <Table head={['Examen', 'Celda', 'Versión', 'Ciclo de vida', 'Validación', 'Hallazgos', 'Creada']}>
        {ops.candidates.map((c) => (
          <tr key={c.versionId} style={ROW}>
            <TD>{c.definitionName ?? '—'}</TD>
            <TD muted>{(c.cellKey ?? '').split('|').slice(0, 2).join(' · ')}</TD>
            <TD num>v{c.version}</TD>
            <TD>{LIFECYCLE_LABEL[c.lifecycle] ?? c.lifecycle}</TD>
            <TD muted>{c.validation.stage ?? '—'} {c.validation.outcome ?? ''}</TD>
            <TD muted>{c.validation.issueCodes.join(', ') || '—'}</TD>
            <TD muted>{new Date(c.createdAt).toLocaleString('es')}</TD>
          </tr>
        ))}
      </Table>
    </div>
  );
}
