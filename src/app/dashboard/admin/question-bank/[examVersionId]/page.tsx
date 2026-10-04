import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { requireStudyUSAdmin } from '@/lib/admin/authorization';
import { bankHealthDetail } from '@/lib/exam-core/question-bank/admin.service';
import { effectiveConfigFor } from '@/lib/exam-core/question-bank/runtime-settings.service';
import type { EffectiveFactoryConfig } from '@/lib/exam-core/question-bank/runtime-settings';
import { PageHeader } from '@/components/ui/PageHeader';
import { AdminSubNav } from '../../AdminSubNav';
import { Table, TD, ROW, YesNo, CellState, LENGTH_BASIS_LABEL, cellLabel } from '../ui';
import { RefreshHealthButton, GenerateSmallBatchButton } from '../BankActions';

/** Drill-down of one exam version: readiness with its reasons, then every blueprint cell (gap view). */
export default async function QuestionBankExamPage({ params }: { params: Promise<{ examVersionId: string }> }) {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');
  const admin = await requireStudyUSAdmin(clerkUserId);
  if (!admin) redirect('/dashboard');
  const { examVersionId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(examVersionId)) notFound();
  const detail = await bankHealthDetail(examVersionId);
  if (!detail) notFound();
  let cfg: EffectiveFactoryConfig | null = null;
  try {
    cfg = await effectiveConfigFor('MANUAL');
  } catch {
    cfg = null;
  }
  // Demo Mode: every cell of a supported exam may be requested, 5 questions per request (still validated, still PILOT).
  const batch = cfg ? (cfg.demoMode ? Math.min(5, cfg.maxBatch) : cfg.maxBatch) : 0;
  const snap = detail.snapshot;
  const canGenerate = !!cfg?.enabled && detail.generation.supported;
  const sections = snap ? [...new Set(snap.cells.map((c) => c.componentName))] : [];
  const gates = snap
    ? [
        { label: 'Práctica', gate: snap.readiness.practice },
        { label: 'Simulacro reducido', gate: snap.readiness.reducedMock },
        { label: 'Simulacro completo (FULL_MOCK_READY)', gate: snap.readiness.fullMock },
        { label: 'Simulacro completo calibrado (FULL_MOCK_CALIBRATED)', gate: snap.readiness.fullMockCalibrated },
      ]
    : [];

  return (
    <div>
      <PageHeader title={`${detail.meta.definitionName}`} subtitle={`${detail.meta.versionLabel} · ${detail.meta.family} · contenido ${detail.meta.contentStatus ?? '—'}`} />
      <AdminSubNav active="question-bank" />
      <p style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
        <Link href="/dashboard/admin/question-bank" className="btn btn-ghost">← Salud del banco</Link>
        <RefreshHealthButton examVersionId={examVersionId} />
      </p>
      <section className="card" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-6)', fontSize: 13.5 }}>
        <div>Generación: {detail.generation.supported ? 'admitida' : 'no admitida'} — {detail.generation.note}</div>
        <div>Unidades: {detail.unitPolicy.mode === 'UNIT' ? `por unidad (estímulo compartido, mínimo ${detail.unitPolicy.minItemsPerUnit} preguntas)` : 'por pregunta'}</div>
        {!cfg?.enabled && <div style={{ color: 'var(--text-muted)' }}>La generación bajo demanda está desactivada (Banco de preguntas → Operaciones): solo medición.</div>}
        {cfg?.enabled && cfg.demoMode && <div style={{ color: 'var(--text-muted)' }}>Modo Demo activo: puedes pedir preguntas para cualquier celda; cada pregunta se valida y entra en piloto.</div>}
        {snap && <div style={{ color: 'var(--text-muted)' }}>Calculado {new Date(snap.computedAt).toLocaleString('es')} · contenido oficial: {Math.round((snap.summary.officialContentCoverage ?? 0) * 100)}%</div>}
      </section>

      {!snap ? (
        <p>Sin instantánea de salud. Usa «Recalcular salud».</p>
      ) : (
        <>
          <h2 style={{ fontSize: 15, marginBottom: 'var(--space-2)' }}>Capacidades y motivos</h2>
          <Table head={['Capacidad', 'Disponible', 'Motivos']}>
            {gates.map((g) => (
              <tr key={g.label} style={ROW}>
                <TD>{g.label}</TD>
                <TD><YesNo value={g.gate.ready} /></TD>
                <TD muted>{g.gate.reasons.length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{g.gate.reasons.slice(0, 12).map((r) => <li key={r}>{r}</li>)}{g.gate.reasons.length > 12 && <li>… {g.gate.reasons.length - 12} más</li>}</ul> : '—'}</TD>
              </tr>
            ))}
          </Table>

          <h2 style={{ fontSize: 15, marginBottom: 'var(--space-2)' }}>Componentes</h2>
          <Table head={['Componente', 'Base de longitud', 'Posiciones (reducido / completo)', 'Oficial', 'Reducido ensambla', 'Completo ensambla', 'Formularios completos distintos']}>
            {snap.components.map((c) => (
              <tr key={c.componentId} style={ROW}>
                <TD>{snap.cells.find((x) => x.sectionKey === c.sectionKey)?.componentName ?? c.sectionKey}</TD>
                <TD muted>{LENGTH_BASIS_LABEL[c.lengthBasis] ?? c.lengthBasis}</TD>
                <TD num>{c.reducedPositions} / {c.fullPositions}</TD>
                <TD num>{c.officialItemCount ?? '—'}</TD>
                <TD><YesNo value={c.reducedAssembles} /></TD>
                <TD><YesNo value={c.fullAssembles} /></TD>
                <TD num>{c.fullFormCapacity}</TD>
              </tr>
            ))}
          </Table>

          {sections.map((section) => (
            <section key={section}>
              <h2 style={{ fontSize: 15, margin: 'var(--space-4) 0 var(--space-2)' }}>{section} — huecos del blueprint</h2>
              <Table head={['Requisito', 'Requeridas (form. completo)', 'Objetivo', 'Elegibles', 'Calibradas', 'Piloto', 'En cola', 'Validando', 'Rechazadas', 'Déficit', 'Prioridad', 'Estado', 'Confianza', '']}>
                {snap.cells.filter((c) => c.componentName === section).map((c) => (
                  <tr key={c.cellKey} style={ROW}>
                    <TD>{cellLabel(c)}</TD>
                    <TD num>{c.fullPositions}{c.fullPositions !== c.reducedPositions ? ` (red. ${c.reducedPositions})` : ''}</TD>
                    <TD num>{c.targets.desired}</TD>
                    <TD num>{c.counts.mockEligible}</TD>
                    <TD num>{c.counts.calibratedEligible}</TD>
                    <TD num>{c.counts.pilot}</TD>
                    <TD num>{c.queued}</TD>
                    <TD num>{c.counts.validating}</TD>
                    <TD num>{c.counts.rejected}</TD>
                    <TD num>{c.deficit}</TD>
                    <TD>{c.priority}{c.reducedBlocker ? ' · bloquea reducido' : ''}</TD>
                    <TD><CellState state={c.state} /></TD>
                    <TD muted>{c.calibrationConfidence === 'INSUFFICIENT_DATA' ? 'sin datos' : c.calibrationConfidence}</TD>
                    <TD>{canGenerate && cfg && (c.generationNeed > 0 || cfg.demoMode) ? <GenerateSmallBatchButton examVersionId={examVersionId} cellKey={c.cellKey} maxBatch={batch} /> : null}</TD>
                  </tr>
                ))}
              </Table>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
