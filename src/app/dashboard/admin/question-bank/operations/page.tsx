import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { requireStudyUSAdmin } from '@/lib/admin/authorization';
import { operationsView } from '@/lib/exam-core/question-bank/admin.service';
import { PageHeader } from '@/components/ui/PageHeader';
import { AdminSubNav } from '../../AdminSubNav';
import { StatCard } from '../../StatCard';
import { Table, TD, ROW, LIFECYCLE_LABEL } from '../ui';

const STOP_LABEL: Record<string, string> = { DISABLED: 'fábrica desactivada', DAILY_BUDGET: 'presupuesto diario agotado', MAX_PER_RUN: 'límite por ejecución', AI_RESERVE: 'reserva de IA compartida alcanzada' };

/** Generation operations (read-mostly): budget, queue, runs, candidates. */
export default async function QuestionBankOperationsPage() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');
  const admin = await requireStudyUSAdmin(clerkUserId);
  if (!admin) redirect('/dashboard');
  const ops = await operationsView();
  const b = ops.budget;
  const accepted = ops.runs.reduce((n, r) => n + r.accepted, 0);
  const rejected = ops.runs.reduce((n, r) => n + r.rejected, 0);
  const repaired = ops.runs.reduce((n, r) => n + r.repaired, 0);

  return (
    <div>
      <PageHeader title="Operaciones de generación" subtitle="Cola, ejecuciones y presupuesto de IA de la fábrica de preguntas. La generación es siempre en segundo plano y acotada." />
      <AdminSubNav active="question-bank" />
      <p style={{ marginBottom: 'var(--space-4)' }}><Link href="/dashboard/admin/question-bank" className="btn btn-ghost">← Salud del banco</Link></p>

      <section className="card" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-6)', fontSize: 13.5 }}>
        <div>Fábrica: <strong>{b.config.enabled ? 'activada' : 'desactivada'}</strong>{b.stop ? ` — detenida: ${STOP_LABEL[b.stop] ?? b.stop}` : ''}</div>
        <div>Presupuesto diario: {b.usedToday} / {b.config.dailyBudget} llamadas · por ejecución: {b.config.maxPerRun} · lote máximo: {b.config.maxBatch}</div>
        <div>Reserva de IA compartida: {b.config.minRemainingAiReserve} llamadas · restantes hoy en la plataforma: {b.platformRemaining ?? 'desconocido (la fábrica no arranca)'}</div>
        <div>Exámenes habilitados para la ejecución programada: {b.config.examConfigKeys.length ? b.config.examConfigKeys.join(', ') : 'ninguno'}</div>
        <div>Modo de preparación dinámica: {b.config.readinessMode === 'ENFORCE' ? 'aplicada' : 'sombra (solo comparación)'}</div>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 'var(--space-3)', marginBottom: 'var(--space-6)' }}>
        <StatCard label="Pendientes" value={ops.queue.pending} />
        <StatCard label="En curso" value={ops.queue.running} />
        <StatCard label="Fallidas" value={ops.queue.failed} tone={ops.queue.failed ? 'warn' : 'default'} />
        <StatCard label="Completadas" value={ops.queue.completed} />
        <StatCard label="Aceptadas (piloto)" value={accepted} />
        <StatCard label="Rechazadas" value={rejected} />
        <StatCard label="Reparadas" value={repaired} />
      </div>

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
