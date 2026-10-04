import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { requireStudyUSAdmin } from '@/lib/admin/authorization';
import { bankHealthOverview } from '@/lib/exam-core/question-bank/admin.service';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { AdminSubNav } from '../AdminSubNav';
import { Table, TD, ROW, YesNo, CellState } from './ui';

/**
 * Question Bank Health (Platform Admin / Exam Content). Bank health is not
 * Student readiness: it says whether StudyUs can BUILD practice and forms for
 * each exam version, from the latest precomputed snapshot.
 */
export default async function QuestionBankHealthPage() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');
  const admin = await requireStudyUSAdmin(clerkUserId);
  if (!admin) redirect('/dashboard');

  const rows = await bankHealthOverview();
  const families = [...new Set(rows.map((r) => r.family))];

  return (
    <div>
      <PageHeader title="Salud del banco de preguntas" subtitle="Qué puede construir StudyUs para cada examen: práctica, simulacro reducido y simulacro completo, calculado ensamblando formularios reales." />
      <AdminSubNav active="question-bank" />
      <p style={{ marginBottom: 'var(--space-4)' }}>
        <Link href="/dashboard/admin/question-bank/operations" className="btn btn-ghost">Operaciones de generación →</Link>{' '}
        <Link href="/dashboard/admin/question-bank/review" className="btn btn-ghost">Revisión académica →</Link>
      </p>
      {rows.length === 0 ? (
        <EmptyState title="No hay versiones de examen publicadas." />
      ) : (
        families.map((family) => (
          <section key={family}>
            <h2 style={{ fontSize: 15, margin: 'var(--space-4) 0 var(--space-2)' }}>{family}</h2>
            <Table head={['Examen', 'Versión', 'Catálogo', 'Estructura', 'Práctica', 'Simulacro reducido', 'Simulacro completo', 'Completo calibrado', 'Activas', 'Piloto', 'Revisión', 'Salud de cobertura', '']}>
              {rows.filter((r) => r.family === family).map((r) => (
                <tr key={r.examVersionId} style={ROW}>
                  <TD>{r.definitionName}{r.structureOnly ? ' (solo estructura)' : ''}</TD>
                  <TD muted>{r.versionLabel}</TD>
                  <TD><YesNo value={true} /></TD>
                  <TD><YesNo value={r.structure} /></TD>
                  <TD><YesNo value={r.practice} /></TD>
                  <TD><YesNo value={r.reducedMock} /></TD>
                  <TD><YesNo value={r.fullMock} /></TD>
                  <TD><YesNo value={r.fullMockCalibrated} /></TD>
                  <TD num>{r.activeItems ?? '—'}</TD>
                  <TD num>{r.pilotItems ?? '—'}</TD>
                  <TD num>{r.reviewRequired ?? '—'}</TD>
                  <TD>
                    {r.cellStates ? (
                      <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
                        {Object.entries(r.cellStates).map(([s, n]) => (
                          <span key={s} style={{ display: 'inline-flex', gap: 2, alignItems: 'center' }}><CellState state={s} /> <span className="tabular">{n}</span></span>
                        ))}
                      </span>
                    ) : (
                      <span className="chip">sin calcular</span>
                    )}
                  </TD>
                  <TD><Link href={`/dashboard/admin/question-bank/${r.examVersionId}`} className="btn btn-ghost">Ver</Link></TD>
                </tr>
              ))}
            </Table>
          </section>
        ))
      )}
    </div>
  );
}
